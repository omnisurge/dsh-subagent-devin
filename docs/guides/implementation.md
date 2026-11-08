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

## 思考强度与速度：会话级档位，用胶囊切

Devin 把「模型」和「档位」分成不同配置项，ACP 里对应三个：

| 页面 | ACP 配置项 | 取值 | 控件 |
|---|---|---|---|
| 模型 | `model` | 132 项（账号决定） | 下拉 |
| 思考强度 | `thought_level` | `medium` / `high` / `max` | 胶囊（含「默认」共 4 段） |
| 速度 | `speed` | `standard` / `fast` | 胶囊（含「默认」共 3 段） |

- 两项都只能通过 `session/set_config_option` 生效（`--model` 那条路对它们同样不存在）。
- 留空 = 跟随账号默认：**一个请求都不发**，交给账号自己的设置。
- 页面显示的「当前档位」来自探测（`probe.thought` / `probe.speed`），不是页面自己编的默认值。
- **没通过认证就不报档位**：那时后端给的是兜底默认值，不是这个账号的可选集；
  报了等于拿没认证的猜测冒充账号设置。页面在拿不到选项时整组禁用。

### 胶囊的形状与状态（ADR-044 分层，不自创）

- **只有滑块填色**，轨道 1px 描边、不填色——整条填黑会成为页面最重的元素。
- **颜色编码状态**：选中 = `--dsw-alias-label-primary` 底 + `--dsw-alias-bg-layer-1` 文字，
  不写字面色值（暗色主题下这两个 token 互换）。
- **形状编码层级**：内容区档位用胶囊（贴内容宽）；满宽分段条是 chrome 级切换用的，这里不用。
- 几何：高 34、圆角 17、内距 14、滑块内缩 3；单选语义用 `role=radiogroup` + `role=radio` + `aria-checked`。
- 选项**由探测结果决定**：后端给几档就列几档，页面只负责把值翻成中文（`LEVEL_LABELS`）。
  漏了这层映射，用户就会看到后端英文标签 `Medium/High/Max`。

执行者：`test/probe.test.mjs`（探测带回档位）、`test/provider.test.mjs`（两项都发 set_config_option、
留空不发）、`test/client-render.test.mjs`（胶囊选中/点选写设置/未探测禁用）、
`test/client-contract.test.mjs`（档位标签键与取值映射齐全）；
变异「档位不提交」「没探测也允许点」「档位不传给后端」分别撤掉一侧都必红。

## 保存的模型被收回时，下拉要把它显示出来

可用表会变（见上节），所以「配置里记着的模型」和「当前列表里的模型」是两件事：

| 事实 | 下拉里 |
|---|---|
| 已保存值在当前列表里 | 正常一项 |
| 已保存值**不在**列表里，且列表**非空** | 保留该项并标注「（账号当前不提供）」 |
| 列表为空（还没探测成功） | 保留该项但**不加标注** —— 还没问到，不能说人家不提供 |

第三条是必须的：列表为空只代表「还没问到」，冒充「不提供」就是在编事实。
`locale/*.json` 只放 `meta`（插件卡的标题/说明/简介），`t()` 的词典在 `lib/client.js`
内联的 `EN`/`ZH` 里，同一个键**不要**两处都加。

执行者：`test/client-render.test.mjs`「已保存的模型被账号收回后…」与「还没探测成功时…」；
变异「收回的模型不显示」「没探测成功也标不提供」撤掉任一侧都必红。

## 模型：`--model` 是摆设，真正生效的是 `set_config_option`

2026-11-08 亲验（`devin acp`，本机 0.2.x 桌面版自带 CLI）：

| 试法 | 结果 |
|---|---|
| `devin acp --model swe-2-high` | **无效**，会话仍是账号默认模型 |
| `DEVIN_MODEL=swe-2-high` 环境变量 | **无效** |
| ACP `session/set_config_option {configId:'model', value}` | **有效**，`currentValue` 变成新值 |
| 设一个不在账号可用表里的模型 | 被拒：`Invalid params: Invalid value 'x' for config option 'model'` |

所以插件把「设模型」当成**协议内的一次显式设置**，不再依赖命令参数；被拒时运行继续用账号默认模型，
并在运行结束时给一条回落事实（同一事实只出现一次）。

另一个必须知道的：**可用模型表是账号驱动的，会变**。同一天两次握手，先返回 2 个
（`swe-2-flash-medium`、`swe-1-6-slow`），几小时后返回 **132 个**且默认变成 `swe-2-high` ——
权益/灰度在服务端生效，探测那一刻拿到什么就是什么。因此：

- 上限只防异常膨胀（400），不做产品裁剪；能选什么由后端的可用表决定。
- 页面显示「列表来自最近一次检查」，「重新检测」会重新握手拿新表；不要把旧探测结果当永久事实。
- `session.model.actual` 要读会话当前值，不能在握手时拍一张快照就完事——设过模型之后它会变。

执行者：`test/provider.test.mjs`「后端忽略 --model 时，必须改用 set_config_option 设上去」与
「模型回落」；变异「模型不设上去只靠 --model」「改完模型不更新会话当前值」撤掉任一侧都必红。

## 权限提示只说“真的谁能读到”

Devin CLI 自己生成的 `~/.local/share/devin/credentials.toml` 是 644。插件**不去改它**：
那是 CLI 的文件，它下次还会按自己的规则写。页面只据实提示，收不收紧由用户决定。

判定不只看文件自身的权限位，还要看上级目录能不能走进去——`~/.local/share/...` 链条上
只要有一级不让别人进入（Linux 上常见的 700 家目录），文件是 644 也读不到。所以：

| 事实 | 页面 |
|---|---|
| 文件对他人可读 **且** 全链路可进入 | 提示「对本机任何账号可读」 |
| 文件对同组可读 **且** 全链路同组可进入 | 提示「对同组账号可读」（macOS 上普通账号都在 staff） |
| 有一级目录进不去 | **不提示**（读了也是白担心） |

执行者：`test/cli.test.mjs`「凭据暴露判定」用例（注入各档目录模式）；
变异「只看文件权限不看目录」撤掉可达性检查后该用例必红。

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
