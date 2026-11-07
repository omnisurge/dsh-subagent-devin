# Devin 子代理（DSH 插件）

把 Devin 接成 DeepSeek Harness 的子代理：当前会话把任务交给 Devin 执行，结果回到会话里。

- 不弹浏览器窗口、不需要 `devin auth login` 作为运行前提；
- 密钥只存在官方凭据服务里，插件配置只保存**引用名**；
- 模型可指定，实际采用的模型会记进日志（Devin 会把写错的名字静默换成默认模型）。

## 怎么工作

```
会话 → subagent_devin 工具 → 本插件 provider → 子进程 `devin acp`
                                              ├ initialize
                                              ├ session/new（工作目录 = 子代理目录）
                                              ├ session/prompt（任务文本）
                                              └ session/cancel / 释放阶梯
```

认证走子进程环境变量 `WINDSURF_API_KEY`，值在每次运行前从凭据服务解析；父进程里任何
`KEY|PASSWORD|SECRET|TOKEN` 形状的变量都不会带进子进程。

## 密钥从哪来

Devin 有两个长得很像但互不通用的密钥面：

| 前缀 | 来源 | 能用吗 |
|---|---|---|
| `devin-…`（189 字符） | 本机 CLI 登录后写进 `~/.local/share/devin/credentials.toml` 的 `windsurf_api_key` | **能用**（实测跑通过一轮） |
| `apk_user_…` | Devin 平台「API keys (legacy)」页，给第三方调 REST API | CLI 二进制里连 `apk_` 这个前缀都没有，不能用作 ACP 凭据 |

插件默认**自动导入**：启动时如果凭据库里还没有 `WINDSURF_API_KEY`，就通过
`devin auth status` 找到凭据文件、取出 `windsurf_api_key`、写进官方凭据服务。
密钥只在 Host 内存里过一手，不到页面、不进日志；已有值不会被覆盖。
关掉自动导入：配置项 `importFromCli: false`。

也可以在设置页手工粘贴——两条路写进同一个凭据引用。

## 配置

配置在插件行里（`cordis.patch.yml`），字段见 `lib/index.js` 的 `Config`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `command` | Devin 应用自带路径 | CLI 绝对路径，不猜 PATH |
| `model` | 空（跟随账号默认） | 例如 `swe-2-flash-medium`、`swe-1-6-slow` |
| `permission` | `allow` | 权限请求自动答复：`allow` 可改文件，`reject` 一律拒绝 |
| `credentialRef` | `WINDSURF_API_KEY` | 凭据引用名；密钥本身不进配置 |
| `importFromCli` | `true` | 库里没密钥时，从本机 Devin CLI 的登录凭据导入一次 |
| `requestTimeoutMs` | 600000 | 单次运行上限 |
| `disposeEofGraceMs` / `disposeGraceMs` | 6000 / 3000 | 释放阶梯宽限 |

## 安装（开发期）

```sh
sh scripts/link-dev-deps.sh          # 只为本地跑测试
node --test test/provider.test.mjs   # G1
```

装进 profile 用 DSH 的官方插件安装入口指向本目录（`install_bundle`），不要手写 profile
的 `package.json` 或 `cordis.patch.yml`。

## 状态

| 项 | 状态 |
|---|---|
| Host provider + 工具行 | 已实现，G1 13 例通过（含变异撤回验证） |
| 真实 turn | 未验（需要授权的一次真实调用） |
| 设置页（密钥/模型/权限） | 已实现并在真实客户端注册成功（`settings.section` → `devin-subagent`）；页面交互未验 |
| 模式（Ask/Plan/Bypass） | 未实现：`session/set_config_option` 的形态未实测 |

契约与决定：`docs/specs/devin-subagent.md`、`docs/adr/ADR-001-provider-and-settings-page.md`。
