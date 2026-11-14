# 文档索引

同一件事只在一层写，避免两份互相漂移。

| 目录 | 写什么 | 读者 |
|---|---|---|
| [`specs/`](specs/devin-subagent.md) | 当前**必须**是什么：身份表、用户路径、失败语义、验收门槛 | 开发、审查 |
| [`adr/`](adr/ADR-001-provider-and-settings-page.md) | 一次决定一个文件，只追加；含被否掉的方案（[001](adr/ADR-001-provider-and-settings-page.md) 方案形态、[002](adr/ADR-002-page-host-channel.md) 页面与 Host 的通道、[003](adr/ADR-003-thinking-and-speed-levels.md) 思考强度与速度档位、[004](adr/ADR-004-devin-platform-separate-repository.md) 平台 API 能力另开仓库的边界） | 开发、审查 |
| [`guides/`](guides/implementation.md) | **怎么做**：实现说明、配置、排查、开发与测试 | 使用者、开发 |
| [`evidence/`](evidence/measured-20261107.md) | 某天在真机上量到的事实与复现命令（[2026-11-07](evidence/measured-20261107.md)、[2026-11-09](evidence/measured-20261109.md)）与按批次的验收记录（[release-0.1.0-2](evidence/release-0.1.0-2.md)） | 开发、审查 |
| [`design/`](design/settings-page.svg) | 已确认的界面设计稿（可视设计，不是文案） | 设计确认 |
| `intro.zh.md` / `intro.en.md` | 插件页「简介」显示的短文（由 locale 的 `meta.detail` 指过来） | 安装前的用户 |

## 按需求找

| 我想… | 看 |
|---|---|
| 装上并让它连上 | 仓库根 [README](../README.md) |
| 知道每个配置项是什么 | [配置](guides/configuration.md) |
| 了解内部怎么跑 | [实现说明](guides/implementation.md) |
| 页面报错了 | [排查](guides/troubleshooting.md) |
| 跑测试、装进 profile | [开发与测试](guides/development.md) |
| 知道为什么这么设计 | [ADR-001](adr/ADR-001-provider-and-settings-page.md) |
| 知道哪些还没验 | [SPEC 第 6 节](specs/devin-subagent.md) |

## 约定

- 用户看得懂的说明放 `guides/`，别塞进 README——README 会被插件页整段渲染，太长会占满版面。
- 状态与验收结论放 `specs/` 的门槛表，不在多个文件里各写一份。
- 实测记录带日期与复现命令，随环境变化另行记新文件，不改旧记录。
