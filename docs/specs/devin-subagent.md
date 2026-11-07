# SPEC：Devin 子代理插件（当前必须是什么）

目标运行时：DSH 0.2.2-rc.1。被测 Devin：`3000.11.238`。决策依据见 [ADR-001](../adr/ADR-001-provider-and-settings-page.md)。

## 1. 身份表

| 项 | 值 | 状态 |
|---|---|---|
| bundle 包名 | `@omnisurge/dsh-subagent-devin` | 定稿 |
| Host 模块 | 同上，`lib/index.js`（`apply(ctx, config)` + `Config`） | 定稿 |
| provider 行 id | `subagent-devin` | 定稿 |
| 工具行 id | `tool-subagent-devin` | 定稿 |
| 工具名 | `subagent_devin`（不得与内置 `subagent` / `subagent_fork` 冲突） | 定稿 |
| Settings ns | 行 id `subagent-devin`（`settings` 服务的 ns 就是 profile entry id） | **待安装后核对** |
| Client factory id | 包名 | 定稿 |
| 页面槽位 | `settings.section`，注册 `{id: 'devin-subagent', order: 25, label}` | 槽位已核实存在（现有 6 个条目） |
| 凭据引用 | `WINDSURF_API_KEY` | 定稿 |
| 凭据记录键（备选） | `devin-subagent/api-key`（`modifyRecord`，仅当引用半边不够时启用） | 备用 |

门禁：`docs/specs/identity.test.mjs`（清单与 patch/package.json 一致性）。

## 2. 用户路径（必须完整可走）

1. 安装 bundle → 插件列表出现「Devin 子代理」卡片（title/description 来自 `locale/*.json` 的 `meta`）。
2. 打开 设置 → Devin 子代理：
   - 未配置密钥时：顶部一条状态「还没有配置密钥」，密钥框为空，模型下拉禁用。
   - 粘贴 key → 保存 → 状态变为「已配置」。
3. 点「测试连接」→ 页面显示账号（名称/套餐）、可用模型、当前默认模型。
4. 在模型下拉里选一个（或保留「跟随账号默认」）→ 保存。
5. 回到会话，模型可调用 `subagent_devin`：给定任务 → 返回子代理最终文本。
6. 出错时页面上出现可读原因 + 下一步（不是错误码）。

门禁：`人工：G5`（真实桌面运行时走完整路径）＋ `test/page.contract.test.mjs`（字段/状态/文案映射）。

## 3. 配置面（Config）

| 字段 | 类型 | 默认 | 语义 |
|---|---|---|---|
| `command` | string | App 自带二进制绝对路径 | 找不到时给出可读错误，不回落到 PATH 猜测 |
| `model` | string \| null | `null`（跟随账号默认，实测为 `swe-2-flash-medium`） | 只允许来自探测列表的值；非法值不写入 |
| `refreshToken` | number | 0 | 页面递增它来要求重新检查连接 |
| `revealToken` | number | 0 | 页面递增它来要求打开凭据文件所在位置 |
| `lastRevealToken` | number（volatile） | 0 | 已处理的打开请求；`revealToken > lastRevealToken` 才执行 |
| `probe` | 对象（volatile） | 空 | 由插件写入的连接检查结果：`at/account/source/command/credentialPath/keyPrefix/revealReason/reason/loosePermissions/ok/models/current/authenticated/error`。**只放机器可读事实，不放成品句子** |
| `mode` | — | 会话默认 `accept-edits` | **M1 不提供**：`session/set_config_option` 的形态未实测，先不暴露一个可能无声失效的开关 |
| `permission` | `'reject' \| 'allow'` | `allow` | ACP 权限请求的自动答复；`allow` = 子代理可直接改文件，无 DSH 审批闸门 |
| `credentialRef` | string | `WINDSURF_API_KEY` | 凭据引用名，**不是**密钥本身 |
| `importFromCli` | boolean | `true` | 库里没密钥时，从本机 CLI 凭据文件导入一次；**不覆盖已有值** |

命令行解析（三平台收口）：配置 > PATH（`devin`/`devin.exe`）> 各平台候选目录
（macOS App 内、Windows `%LOCALAPPDATA%\Programs\Devin\…\devin.exe`、Linux `/usr/share/devin` 与 `~/.local/bin`）。
显式配置指向不存在的文件时**不静默替换**，标 `missing` 让人知道路径是坏的。
Windows 路径用反斜杠自行拼接（`path.join` 用本机分隔符，跨平台拼会得到混合分隔符）。

密钥来源的判定（实测）：CLI 二进制里 `apk_` 出现 0 次，`WINDSURF_API_KEY` 出现 4 次 →
可用的只有 `devin-` 前缀的 CLI 凭据（189 字符），平台页的 `apk_user_` 是 REST API 密钥，不能用于 ACP。

不变量：任何字段都不得承载密钥值；`Config` 的 JSON Schema 由官方 `settings` 服务投影成表单，字段描述即用户看到的帮助文案（因为目前不计划单独写表单渲染）。

门禁：`test/config.schema.test.mjs`（字段白名单、默认值、非法值拒绝）＋ `契约：cordis_inspect_query Config.listConfigs`。

## 4. 运行语义（provider）

- `capabilities`：`{agentOptions: false, agentPreset: false, outputSchema: false, depthLimit: false, ...}`，与官方 ACP 后端保持一致 → 工具行必须 `maxDepth: provider-managed`。
- `inheritsParentContext: false`：子代理看不到父会话。
- 每次 `start()`：解析凭据 → 若无值立即失败（可读错误，不启动进程）→ 启动 `devin acp`（带 `--model`）→ `initialize` → `session/new{cwd}` →（会话报告的模型与请求不符时）`set_config_option`（失败只记录）→ `session/prompt`。
- 认证走**子进程环境变量** `WINDSURF_API_KEY`，不调用 ACP `authenticate`：env 路径实测不拉浏览器、且 JSON-RPC 里 0 个 authenticate 帧。
- 只把 `agent_message_chunk` 的文本拼成结果；`agent_thought_chunk` / `usage_update` 记入运行日志，不进结果。
- 取消：`session/cancel` 后按 ACP 的 `stopReason: cancelled` 映射为 `aborted`。
- 释放阶梯：stdin EOF（grace）→ SIGTERM → SIGKILL → 整棵树退出。
- **实际使用的模型必须落日志**（`turn_stats.model` 或 `configOptions.model.currentValue`），因为写错的模型会静默回落。

门禁：`test/acp-fake.test.mjs`（本地假 ACP server 覆盖：成功/认证失败/取消/超时/进程早退）＋ `人工：G6`（一次真实 turn）。

## 5. 失败语义（用户可见）

| 场景 | 页面/运行表现 |
|---|---|
| 没有密钥 | 运行前失败：「还没有配置 Devin 密钥。请到 设置 → Devin 子代理 粘贴密钥。」 |
| 密钥无效 | 「密钥无效或已失效（Devin 拒绝认证）。请重新粘贴。」并附原始错误码到诊断区 |
| 可执行文件缺失 | 「找不到 Devin CLI。请在设置里填写完整路径；Devin 应用自带的路径是 …」 |
| 团队设置拉取失败 | 「连不上 Devin 服务（网络或账号状态）。」+ 诊断码 |
| 模型写错/无权限 | 不静默：结果是默认模型，日志里记录回落事实 |

## 6. 门槛与现状

| 门槛 | 证据 | 状态 |
|---|---|---|
| G0 契约与范围 | 本文件 + ADR-001 + 实测记录 | 已完成 |
| G1 单元 | 5 个测试文件共 41 例通过（provider / probe / cli / 页面契约 / 页面渲染冒烟）；11 个变异均按预期变红（含 CLI stdin、configOptions 归一化、打开位置去重、页面永远显示未连接） | 已完成 |
| G3 实际产物 | 待写（`npm pack` 后核 `files`） | 未开始 |
| G4 Client 链路 | `lib/client.js` 已注册 `settings.section`，真实客户端出现过该分区；**三态新界面未在真实客户端加载过** | 未验 |
| G5 原生路径 | 待跑 | 未验 |
| G6 平台/账号 | 真实 turn 已验 2 次（认证/key/模型），provider 内路径未验 | 部分 |

## 7. 页面（M2）的数据通路：已核实的结论

1. **密钥**：官方 `ctx.remote.credentials.{describe,set,unset}` 命名空间已存在，页面直接用，不自造 RPC。
2. **模型/权限**：官方 `ctx.remote.{describe,update,replace,mutate}` 按插件 Config 的 ns 读写，带 revision/CAS。
3. **测试连接/模型发现**：本仓已装的套件就是先例——profile 里的三方 bundle 可以 import 官方运行时包（`@deepseek-ai/dsh-tool-subagent`、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-typert-protocol`），并用 typert 协议声明自己的 `remote.<ns>`。M2 走同一条路，不发明第二条 RPC。
4. **已定的做法**：不引 typert 生成链，改为「配置计数 + 行重载」——页面递增 `refreshToken` / `revealToken`，插件行重载时执行并把结果写回 volatile `probe`。决定与代价见 [ADR-002](../adr/ADR-002-page-host-channel.md)。
5. **未验**：`@Remote` 装饰器那条路（需要 typert 编译产物）没有试；如果将来需要真正的双向 RPC 再评估。

说明文档分工：怎么做见 [`docs/guides/`](../guides/implementation.md)，实测事实见
[`docs/evidence/measured-20261107.md`](../evidence/measured-20261107.md)。本文件只写「必须是什么」。
