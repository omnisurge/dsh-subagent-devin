# 配置

配置写在插件行的 `cordis.patch.yml`，字段定义在 `lib/index.js` 的 `Config`。
设置页只改用户看得懂的几项，其余留给高级用户。

## 用户可见（设置页里有）

| 字段 | 默认 | 说明 |
|---|---|---|
| `model` | `''`（跟随账号默认） | 例如 `swe-2-flash-medium`、`swe-1-6-slow`。写错的名字会被 Devin 静默换成默认模型，所以页面只提供最近一次检查列出的可选值 |
| `permission` | `allow` | 子代理的权限请求如何答复：`allow` 直接放行（可改文件），`reject` 一律拒绝 |

## 高级（改配置或靠自动发现）

| 字段 | 默认 | 说明 |
|---|---|---|
| `command` | `''` | Devin CLI 的绝对路径。留空自动发现：配置 > `PATH`（`devin`/`devin.exe`）> 各平台常见安装位置。显式配置但文件不存在时不会被静默替换，探测结果会标出来 |
| `credentialRef` | `WINDSURF_API_KEY` | 凭据引用名。**这里只存名字，密钥本身永远不进配置** |
| `importFromCli` | `true` | 凭据库里没有密钥时，从本机 Devin CLI 的登录凭据导入一次。只在库为空时导入，不覆盖已有值 |
| `requestTimeoutMs` | `600000` | 单次子代理运行的上限 |
| `disposeEofGraceMs` | `6000` | 释放阶梯：先关 stdin，等这么久还没退再发 SIGTERM |
| `disposeGraceMs` | `3000` | 释放阶梯：SIGTERM 到 SIGKILL 之间的宽限 |

## 内部字段（不要手改）

这些由页面或插件写入，改它们没有意义，可能把状态弄乱。

| 字段 | 写入方 | 作用 |
|---|---|---|
| `refreshToken` | 设置页「重新检测」 | 递增即请求重新检查。插件行重载后执行，结果写回 `probe` |
| `revealToken` | 设置页「打开凭据文件位置」 | 递增即请求打开凭据文件所在目录 |
| `lastRevealToken` | 插件 | 已处理过哪个 `revealToken`；只有两者不等才执行，避免每次重载都弹文件管理器 |
| `probe` | 插件 | 最近一次检查的结果，见下 |

## `probe` 里有什么

`probe` 是 volatile 字段，只放**机器可读的事实**，给用户看的句子在页面词典里。

| 键 | 含义 |
|---|---|
| `at` | 检查时间（ISO 字符串） |
| `account` | 本机 CLI 报出的账号名 |
| `source` | 密钥来源：`store` / `cli` / `none` |
| `command` | 本次使用的 CLI 完整路径 |
| `credentialPath` | 凭据文件位置（只有路径，没有内容） |
| `keyPrefix` | 密钥前 6 个字符，用于页面显示「devin-…」 |
| `reason` | 为什么不能跑：`cli-not-logged-in`、`cli-no-key`、`cli-not-runnable`、`handshake-failed`、`auth-failed`、`import-disabled`、`import-failed`、`credential-empty`、`no-credential-service` |
| `revealReason` | 打开位置失败的原因：`no-credential-location` |
| `loosePermissions` | 凭据文件是否对同机其他账号可读 |
| `ok` / `authenticated` | 命令端起得来 / 认证是否通过 |
| `models` / `current` | 账号可用模型列表 / 当前模型 |
| `error` | 原始技术诊断，只用于排查 |
