# 实现说明

这里讲**怎么实现的**；契约要求见 [SPEC](../specs/devin-subagent.md)，历史决定见 [ADR-001](../adr/ADR-001-provider-and-settings-page.md)。

## 组件

```
会话 → subagent_devin 工具（官方 tool-subagent 行，provider: devin）
        → 本插件 provider（ctx.subagents.registerProvider）
          → 子进程 `devin acp`（ndjson JSON-RPC）
```

插件只有两个 Host 行：provider 行与本插件，以及一个官方工具行。设置页是 Client 半，单独加载。

## 一次运行

1. 从请求里取纯文本；空文本直接拒绝（`DEVIN_EMPTY_PROMPT`），不开进程。
2. 按引用从凭据服务解析密钥；解析不到就不启动，错误码区分「没有凭据服务」「没有值」「值为空」。
3. 起 `devin acp` 子进程，密钥通过环境变量 `WINDSURF_API_KEY` 传给子进程。
4. ACP 握手：`initialize` → `session/new`（`cwd` 为本次子代理目录）。
5. 需要指定模型时补一条会话配置（`--model` 也会传，双重保证）。
6. `session/prompt` 发任务文本，收集流式分片；`stopReason` 映射到结果（`cancelled` → `aborted`）。
7. 结束或取消时走释放阶梯：`session/cancel` → 关 stdin → SIGTERM → SIGKILL，每一档有宽限毫秒数。

## 密钥从哪来

解析顺序只有一条：**凭据服务**。库里没有时，启动阶段会尝试从本机 CLI 的登录凭据导入一次
（`devin auth status` 报出凭据文件位置 → 读 `windsurf_api_key` → 写入凭据服务）。

- 密钥值只在 Host 内存里过一手，不返回给页面、不进日志、不进错误消息。
- 已有值不会被覆盖——**除了两个例外**：库里的值是 `apk_` 开头的平台接口密钥（子代理用不了），或者那把密钥在探测时被后端拒绝、而本机 CLI 有一把能用的。两种情况都只替换一次，并在页面写明来源。
- `importFromCli: false` 可关。
- 页面手工粘贴的密钥写进**同一个**凭据引用，所以两条来源不会打架。

## 环境变量清洗

子进程环境 = 父进程清洗后的环境 + 插件需要的两项。凡是变量名匹配
`KEY|PASSWORD|SECRET|TOKEN` 的、以及所有 `DSH_*`，都不会带进子进程。这样父进程里的
其它凭据不会被顺走。

## 文案与设计稿的对齐记录

已确认的设计稿是 `docs/design/settings-page.svg`（v3，三个状态 A/B/C）。实现里有三处曾与它
不一致，2026-11-08 按设计稿改回，属于订正而不是新决策：

| 位置 | 之前 | 现在（=设计稿） |
|---|---|---|
| 连接卡·模型行 | `2 个可用模型 · 最近检查 …` | `可用模型 2 个 · 最近检查 …` |
| 连接卡·底部行（已连接时） | 重复一次 `最近检查：…` | 已连接时不重复，只留模型行那一处 |
| 模型下拉·跟随默认 | `跟随账号默认 · swe-2-flash-medium`（内部值） | `跟随账号默认 · SWE-2 Flash Medium`（显示名） |

## volatile 字段在运行时是引用对象

`model`、`permission`、`probe`、`lastRevealToken` 声明为 volatile——设置页要能读到当前值
并就地改。代价是**运行时它们不是值，而是宿主维护的引用对象**（带 `.get()`）：

```js
config.model            // { get: f, [Symbol]: f }
config.lastRevealToken  // { get: f, … }，不是 0
```

所以 `revealToken > lastRevealToken` 恒为假，`config.model.trim()` 会直接抛。
插件的做法是**每个操作开始时取一份普通值快照**（`plainConfig(config)`），之后只用快照：

```js
start: (request) => startRun(ctx, plainConfig(config), request, activeSessions)
```

普通字段（`command`、`refreshToken`、`revealToken`…）不受影响。非 volatile 的字段
不会出现在设置页的表单视图里——所以“页面上要显示且能改”的字段必须是 volatile，
反过来想让某字段从页面消失、只做高级配置，就不要标 volatile。

## 读设置时先拆信封

`ctx.remote.settings.describe()` / `ctx.remote.credentials.describe([ref])` 返回的是
`{ok, value}` 信封，**不是裸值**。当裸值读会得到 `undefined`，页面就会把「读到了」
显示成「没有这一行配置」或「没有密钥」，而且写失败也不会抛异常（只回 `ok:false`）。

本插件的做法：所有远端调用经 `unwrap()` 拆封，`ok:false` 抛带 Host 原话的错误；
测试夹具按信封造数据，另有变异「把信封当裸值读」保证这条路径不会退化。

## 页面的四种可见状态

| 看到什么 | 意味着 |
|---|---|
| 「正在获取当前状态…」 | 页面刚挂载，还没读到配置 |
| 灰点「检测中」+「正在检查本机 Devin 的登录状态与密钥…」 | 探测在跑（起进程 + 握手，通常 3～10 秒）。**这时不能说“未连接”**，否则把“还没查”冒充成“查过、没连上” |
| 绿点「已连接」+ 账号/模型数/最近检查 | 探测成功 |
| 黄点「未连接」+ 具体原因句 | 探测确实失败，句子说明下一步；20 秒仍无结果则改为「检查没有返回结果」并放开重试按钮 |

## 设置页与 Host 之间怎么通信

页面调不到 Host 方法（那需要 typert 代码生成链，本仓刻意不引），所以走**配置字段 + 行重载**：

| 动作 | 机制 | 代价 |
|---|---|---|
| 重新检测 | 页面递增 `refreshToken` → 插件行重载 → 启动时探测 → 结果写回 `probe` → 页面轮询到变化 | 界面闪一下 |
| 打开凭据位置 | 页面递增 `revealToken` → 行重载 → 启动时执行系统命令定位文件 | 同上 |
| 保存/替换密钥 | 直接调官方 `remote.credentials.set`，不走重载 | 无 |

`lastRevealToken` 用来保证同一次请求只执行一次：只有 `revealToken > lastRevealToken` 才动作。

## 插件页的「简介」从哪来

插件页的详情文档由官方 `pluginManager.readBundleDetail` 读取：先看 `locale/<语言>.json` 的
`meta.detail` 命名的 Markdown（相对包根，语言链最后一定回落到 `en`），**没有才回退到 README**。
所以 README 会被整段当成简介渲染——想控制简介就写 `meta.detail`，别指望 README 短一点了事。

当前两个语言各自指向 `docs/intro.zh.md` / `docs/intro.en.md`。

## 为什么不用 ACP 自带的浏览器认证

`devin acp` 支持 `authenticate{methodId: "devin-browser"}`，但**每调用一次就弹一个浏览器窗口**
（实测一轮弹出 5～7 个）。所以运行时不认证浏览器，只认环境变量里的密钥，见
[实测记录](../evidence/measured-20261107.md)。

## 模型

- 默认 `swe-2-flash-medium`；免费账号只开放 `swe-2-flash-medium` 与 `swe-1-6-slow`。
- 未认证时后端给的 `currentValue` 是占位值，`options` 为空——所以可用模型列表必须**认证之后**才拿。
- 写错或未授权的模型名会被 Devin **静默换成默认模型**，因此插件在事后比对「请求的模型 vs 实际模型」，不一致时写日志。
