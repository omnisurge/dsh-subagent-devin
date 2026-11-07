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
| `mode` | `'accept-edits' \| 'ask' \| 'plan' \| 'bypass'` | `accept-edits` | 通过 `session/set_config_option` 设置 |
| `permission` | `'reject' \| 'allow'` | `allow` | ACP 权限请求的自动答复；`allow` = 子代理可直接改文件，无 DSH 审批闸门 |
| `credentialRef` | string | `WINDSURF_API_KEY` | 凭据引用名，**不是**密钥本身 |

不变量：任何字段都不得承载密钥值；`Config` 的 JSON Schema 由官方 `settings` 服务投影成表单，字段描述即用户看到的帮助文案（因为目前不计划单独写表单渲染）。

门禁：`test/config.schema.test.mjs`（字段白名单、默认值、非法值拒绝）＋ `契约：cordis_inspect_query Config.listConfigs`。

## 4. 运行语义（provider）

- `capabilities`：`{agentOptions: false, agentPreset: false, outputSchema: false, depthLimit: false, ...}`，与官方 ACP 后端保持一致 → 工具行必须 `maxDepth: provider-managed`。
- `inheritsParentContext: false`：子代理看不到父会话。
- 每次 `start()`：解析凭据 → 若无值立即失败（可读错误，不启动进程）→ 启动 `devin acp` → `initialize` → `authenticate{_meta.api_key}` → `session/new{cwd}` →（配置了 `model`/`mode` 时）`set_config_option` → `session/prompt`。
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
| G1 单元 | 待写 | 未开始 |
| G2 Host 组合 | 待写 | 未开始 |
| G3 实际产物 | 待写（`npm pack` 后核 `files`） | 未开始 |
| G4 Client 链路 | 待写（真实 slot 注册） | 未开始 |
| G5 原生路径 | 待跑 | 未验 |
| G6 平台/账号 | 真实 turn 已验 2 次（认证/key/模型），provider 内路径未验 | 部分 |

## 7. 待核对（不猜，装好后用运行时自省确认）

1. Client 页如何调用 Host 自定义方法：候选是「Host 服务 + `@Remote` 生成 `ctx.remote.<ns>`」，或复用 `ctx.remote.settings` / `ctx.remote.credentials`（后两者已确认存在）。
2. 本插件的 Config 是否自动出现在设置里（`settings.configure({auto: true})` 的默认行为），以及是否有官方表单可复用。
3. `settings.section` 页面里读写 `ctx.remote.*` 的 inject 前置（AGENTS §5.8：带点的命名空间必须在 `inject` 里声明）。
