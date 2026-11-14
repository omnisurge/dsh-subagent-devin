# ADR-004：Devin 平台 API 能力另开仓库，不并入本插件

- 日期：2026-11-14
- 状态：accepted（仓库所有者本会话委托判定）
- 关联：提案 `~/.omnidsh/chat/devin-security-plugin-proposal.md`（2026-11-14，panhaowei）、[SPEC 第 1 节](../specs/devin-subagent.md)、[README 范围与维护](../../README.md)

## 背景

本仓 `@omnisurge/dsh-subagent-devin` 目前只做一件事：把本机 Devin CLI 通过 ACP 接成 `subagent_devin` 子代理。维护期只修缺陷、不加新功能，版本按 `0.1.0-N` 递增。

提案拟新增第二件事：Devin Security 2.0 的 Code Scans v3 REST API，包括启动扫描、轮询状态、读取 findings、触发修复。提案请求判定：A 并入本仓，或 B 另开仓库。

## 事实核对

提案的方向成立，但有三处事实需要先纠正、另有一条边界需要说明，避免新仓按错误前提设计：

1. **凭据前缀不是 `apk_user_`。** 截至 2026-11-14 的 Devin 文档：v3 API 的 service user API key 与 PAT 都使用 `cog_` 前缀；`apk_user_` / `apk_` 是 v1/v2 legacy key，已弃用，v3 不适用。本仓 SPEC 第 3 节写的“平台页的 `apk_user_` 是 REST API 密钥，不能用于 ACP”是 2026-11-07 针对本仓 ACP 判定的旧事实，不能搬给新仓，也不能当作 v3 的凭据类型。
2. **Remediate 路径带 `scan_id`。** 实际是 `POST /v3/organizations/{org_id}/code-scans/{scan_id}/findings/{finding_id}/remediate`；提案写成了 `.../findings/{finding_id}/remediate`。
3. **官方 Devin MCP 不是现成替代路径。** 当前 `https://mcp.devin.ai/` 的工具覆盖 sessions / playbooks / knowledge / schedules / integrations / repo docs，没有 Code Scans。若未来官方 MCP 增加该能力，另行评估“用现有 MCP 客户端接入”，不在本 ADR 预设。
4. 提案其余关键事实与文档一致：组织/企业双 scope、`UseCodeScans` / `ViewCodeScans` 系列权限、`409` backlog、`waiting → pending → running → completed|failed|cancelled`、`v3` 与 `v3beta1` 同形。

## 决策

**选 B：另开仓库 `omnisurge/dsh-devin-platform`，包名 `@omnisurge/dsh-devin-platform`，归属 Omnisurge 组织、维护者与 `dsh-subagent-devin` 相同（panhaowei）。本仓不并入任何 Devin 平台 REST API 能力。**

`dsh-subagent-devin` 的身份继续是「Devin CLI/ACP 子代理」：单身份、单凭据（`devin-` CLI key）、单传输（子进程 stdin/stdout）。维护期与 `0.1.0-N` 版本线不变。

### 理由

1. **接入面不同**：本仓是本地 CLI + ACP/JSON-RPC；Code Scans 是 `https://api.devin.ai` 的 HTTPS REST。两者没有可复用的运行时代码，只有页面/凭据/测试骨架可借鉴。
2. **凭据语义不同**：本仓只接受 `devin-` 开头 CLI key；新能力只接受 `cog_` service user key/PAT。把两套凭据放同一设置页，会把“哪把钥匙开哪扇门”变成常驻支持问题。
3. **用户与前置条件不同**：子代理在 Devin Free 账号已实测可用；安全扫描要求 Devin Enterprise 且开通 security scans。两者用户群、验收环境、ACU 预算都不同。
4. **版本与维护边界不同**：本仓已冻结 v0.1.0-2 并声明只修缺陷。新功能会打破维护期合同，且安全 API 的 v3/v3beta1 演进会迫使本仓跟着发版。
5. **命名与职责**：`dsh-subagent-devin` 的名字与 SPEC 身份表都限定“子代理”。要并入就得改名/迁移安装身份，代价大于复制少量样板。
6. **失败隔离**：平台 API 的 401/403/409 与 CLI 的认证/进程错误是两套故障域；分仓可独立测试、独立回退，不让安全扫描的回归影响子代理主路径。

### 首期边界（随归属判决一并确定）

| 项 | 决定 |
|---|---|
| 形态 | Host 工具插件，`ctx.tools.register(defineTool(...))`；不是 subagent provider |
| 工具名 | `devin_sec_*`（profiles / start / scans / findings 等） |
| 首期 API | `profiles`、`start`、`list scans`、`findings` 读取；不含 remediate |
| 第二期 | `remediate`（会起 Devin 会话、开 PR、消耗 ACU）另行批准 |
| Ingestion | 不在首期；Snyk/Wiz/GHAS 导入需单独的 attachments / 权限决策 |
| UI | 最小设置分区：凭据引用、`org_id`、organization/enterprise scope、连接测试；不做扫描看板 |
| 凭据引用名 | `DEVIN_PLATFORM_API_KEY`；页面明确只接受 `cog_` 开头，`apk_user_` / `apk_` legacy 不可用 |
| Base URL | 默认 `https://api.devin.ai`；企业专用部署可按官方文档配置自定义 API 域名 |
| 共享代码 | 先复制设置页/凭据/契约测试骨架，不建共享包、不 import 本仓；第三个消费方出现再评估抽取 |
| 明确禁止 | 新仓不得依赖本仓运行时代码；本仓不得依赖新仓；不得把平台密钥写进配置、日志、页面响应 |

### 开工前提

- 所有者先确认 Devin Enterprise + security scans entitlement、ACU 预算与仓库内容出到 Cognition 的数据政策；未确认前只允许 fake fixture 的离线实现，不得宣称 G5/G6 或真实扫描验收。
- 实现前重新核对 `docs.devin.ai` 的 v3 API、权限与 `v3` / `v3beta1` 状态。
- 若官方 Devin MCP 在此之前提供 Code Scans 工具并满足凭据/权限要求，优先评估现有 MCP 客户端接入，不重复造插件。

## 后果

- 用户需要装两个插件（`dsh-subagent-devin` + `dsh-devin-platform`），这是有意的职责分离；若以后在意一键安装，可由 dsh-suite/元包声明两个独立组件来聚合，不合并代码。
- 新仓会复制少量设置页/凭据/测试样板；接受，等第三个 Devin 平台模块出现再抽共享包。
- 本仓的 SPEC、身份表、版本线与维护期不变。
- 提案用 `apk_user_` 论证“恰好只用平台密钥”不成立；正确事实是 `cog_` service user/PAT，但结论仍是 B——凭据族不同只是理由之一，不是唯一理由。

## 被否掉的方案

- **A 并入本仓**：短期最省样板，但会同时改写维护期政策、SPEC 单身份表、设置页凭据合同和发布节奏；子代理主路径回归风险不成比例。
- **不承接**：官方 MCP 当前没有 Code Scans，API 可独立实现；若因 entitlement 未确认而暂缓，是排期问题，不是归属否定。
- **放进 dsh-suite monorepo**：dsh-suite 是分发聚合与套件管理，业务插件按现有实践是独立仓库/独立发行后再声明；把第三方平台集成塞进套件会绑定套件发版。后续可作为组件声明收录，但不在首期。
