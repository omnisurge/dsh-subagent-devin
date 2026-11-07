# Devin 子代理

把 Devin 接成 DeepSeek Harness 的子代理：当前会话把任务交给 Devin 执行，结果回到会话里。

## 怎么用

1. **设置 → Devin 子代理**，确认右上角是绿色「已连接」。
2. 显示「未连接」时，按页面上的命令在本机登录一次 Devin，或直接粘贴 `devin-` 开头的密钥；然后点「重新检测」。
3. 回到对话，让 `subagent_devin` 去做事。

第一次启动会自己检查本机 Devin 的登录状态并把密钥收进系统凭据库，通常不需要手动配置。

## 密钥

- 页面**不回显**密钥，配置里只存引用名，值只存在系统凭据库。
- 只有 `devin-` 开头的 CLI 密钥可用；`apk_user_` 开头的是 Devin 平台接口密钥，不能用来登录子代理。
- 「打开凭据文件位置」会定位到 `credentials.toml`，方便你自己复制。

## 常用设置

| 设置 | 默认 | 说明 |
|---|---|---|
| 模型 | 跟随账号默认 | 写错的名字会被 Devin 静默换成默认模型，所以列表只给可选值 |
| 子代理权限 | 允许改文件 | 选「只读」时 Devin 的写入请求会被拒绝 |

## 出问题

- **改了设置没生效 / 按钮点了没反应**：应用重启后才会加载新版本插件。
- **一直显示「未连接」**：先在本机终端运行一次页面上的登录命令。
- **提示密钥没有被接受**：用的是不是 `devin-` 开头的那把？

## 更多

| 文档 | 内容 |
|---|---|
| [使用与配置](docs/guides/configuration.md) | 全部配置项，含哪些字段不要手改 |
| [实现说明](docs/guides/implementation.md) | 一次运行怎么走、密钥怎么取、怎么释放 |
| [排查指南](docs/guides/troubleshooting.md) | 状态码、常见症状、诊断命令 |
| [开发与测试](docs/guides/development.md) | 本地测试、变异门禁、安装方式 |
| [插件契约](docs/specs/devin-subagent.md) | 身份表、失败语义、验收门槛 |
| [决策记录](docs/adr/ADR-001-provider-and-settings-page.md) | 为什么这样接，以及被否掉的方案（[002](docs/adr/ADR-002-page-host-channel.md)：页面怎么触发 Host 动作） |
| [实测记录](docs/evidence/measured-20261107.md) | 当时在真机上量到的事实 |
