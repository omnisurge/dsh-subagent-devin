# ADR-001：自建 provider + 专用设置页承载 Devin 子代理

- 日期：2026-11-07
- 状态：proposed（待用户确认设计稿后实施）
- 目标运行时：DeepSeek Harness 0.2.2-rc.1（桌面版）
- 被测 Devin：`3000.11.238`（App 自带二进制），账号 Devin Free

## 背景

目标：在 DSH 里把 Devin 当成子代理（对标内置 codex / claude 子代理），并且用户不需要手改 YAML、不需要登录 CLI、不弹浏览器窗口。

三条已实测的事实决定了方案形态：

1. **官方 ACP 后端无法认证 Devin。** ACP 模式**故意不使用**落盘的 CLI 凭据（二进制原文："Local CLI credentials are intentionally not used in ACP mode"）；宿主必须在每个子进程里调用 ACP `authenticate`。而 `@deepseek-ai/dsh-subagent-acp@0.2.2-rc.1` 里 `authenticate` 出现 **0 次**。
   实测：CLI 已登录 → 新进程 `session/prompt` 仍 `-32000 Please log in to use Devin`。
2. **浏览器认证会每次弹窗。** `authenticate {methodId:"devin-browser"}` 每次调用都开一个浏览器窗口（用户实测 5–7 个窗口）。作为子代理后端不可接受。
3. **API key 路径无窗口且被服务端接受。** `WINDSURF_API_KEY` 环境变量能让 ACP 进程直接以该身份工作：用户实测零窗口、`stopReason: end_turn`、模型 `SWE-2 Flash Medium`、JSON-RPC 序列里 **0 个 authenticate 帧**。合成 key 也证明 `authenticate + _meta.api_key` 路径**不拉浏览器**（PATH 桩零次 `open`）。
   附：`dsh-subprocess` 的 `SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i` 会擦掉父环境里的 `WINDSURF_API_KEY`，只有显式 `config.env` 能传进去 → 官方后端的 `env: z.dict(z.string())` 只能收字面值，无法收凭据引用。

## 决策

1. **自建 Host provider，不复用官方 ACP 后端。** 由我们自己的 `start()` 负责：`initialize → authenticate{_meta.api_key} → session/new → set_config_option(model/mode) → session/prompt → 流式收集 → 取消/释放`。
   理由：只有 provider 能在运行时把**凭据引用解析成值**并走 ACP 协议送出，从而同时满足「不弹窗」「不把密钥写进配置」「模型/模式可配」三条。
2. **密钥只存官方凭据服务**，作为引用 `WINDSURF_API_KEY`（`CredentialRef`），不使用配置文件字段、不写日志、不进客户端响应。运行时每次操作 `ctx.credentials.resolve(ref)`。
3. **配置（模型/模式/权限/命令）走本插件的 Config**，由官方 `settings` 服务投影成表单；专用页面用 `ctx.remote.settings.update(ns, patch, revision)` 写入，遵循 revision/CAS。
4. **提供一个专用设置页**（`settings.section`，id `devin-subagent`），承载：密钥状态与写入、连接测试、模型选择、会话模式、权限策略。
5. **模型列表来自真实连接**：未认证时 ACP 的 `configOptions.model.options` 为空，只有 `authenticate` 之后才出现该账号可用模型（实测 Free 账号为 `swe-2-flash-medium` / `swe-1-6-slow`）。因此页面必须有一个「测试连接」动作，由 Host 拉起一次握手并回填可选项。

## 后果

- 需要 Host + Client 两半（不是薄 bundle）；工作量约 Host 350 行 + Client 300 行 + 测试。
- 每次子代理运行都要做一次 `authenticate{_meta.api_key}`（无窗口、约 1–2 s 量级的团队设置拉取）；不做跨运行缓存，避免把账号身份缓存进内存而与「按操作解析凭据」的规则冲突。
- 模型名写错时 Devin **静默回落**到账号默认（实测 `--model opus` / 乱写都回落），因此页面只能从探测到的列表里选，且 provider 必须把**实际使用的模型**记入运行日志。
- 不再需要 `devin auth login` 作为运行前提；它只是「用户从哪里拿到 key」的一个来源。
- 仍需 `devin` 可执行文件：默认用 App 自带的绝对路径，找不到时给出可读错误。

## 被否决的方案

| 方案 | 否决理由 |
|---|---|
| 官方 ACP 后端 + 字面 key 写进 `env` | 密钥明文进 profile 配置，违反「配置只存凭据引用」 |
| 官方 ACP 后端 + `!!js process.env.X` | 依赖应用启动环境（launchctl），密钥游离在凭据服务之外；Finder 启动拿不到 |
| 每次运行走浏览器认证 | 每次弹窗，用户已实测确认不可接受 |
| 常驻单进程、只认证一次 | 窗口问题只是降频不是消除；还要管理进程池、崩溃重建、跨会话复用，复杂度高于自建 provider |
| 只做 Config 自动页、不做专用页 | 模型列表只能静态枚举，无法满足「小白配置」 |
