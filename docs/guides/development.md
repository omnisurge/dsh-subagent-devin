# 开发与测试

## 本地准备

```sh
sh scripts/link-dev-deps.sh   # 把 schemastery 链到本仓 node_modules，仅供本地跑测试
npm test                      # 全部单元与契约测试
sh scripts/mutations.sh       # 变异门禁：每条变异都必须让指定用例变红
```

测试不联网、不调用真实 Devin、不读真实凭据、不写生产 profile。

## 测试文件与各自守什么

| 文件 | 守的东西 |
|---|---|
| `test/provider.test.mjs` | provider 契约：环境清洗、能力声明、Config 默认值、成功/认证失败/权限/中途退出/取消 |
| `test/probe.test.mjs` | 连接探测：认证后拿到模型、认证被拒不伪装成功、命令起不来给可读原因 |
| `test/cli.test.mjs` | 与本机 CLI 的边界：账号解析、凭据文件解析与权限判定、三平台命令发现、打开位置 |
| `test/client-contract.test.mjs` | 页面与 Host 的静态契约：词典齐不齐、原因码有没有对应文案、工厂 id 与包名一致 |
| `test/client-render.test.mjs` | 最小渲染冒烟：用假 React 把三态各渲一次，挡住「语法过、一渲染就崩」 |

最后两项**不能替代真实客户端验收**，真实渲染仍需在应用里看。

## 变异门禁

`scripts/mutations.sh` 会逐条改坏实现，要求指定用例变红——只证明「测试是绿的」不够，还要证明
测试真的绑在行为上。当前 27 条，按机制分组：

| 组 | 例子 |
|---|---|
| 密钥与凭据 | 权限写死、跳过凭据检查、空引号当密钥、把平台密钥当可用密钥、只看文件权限不看目录 |
| ACP 协议 | CLI 的 stdin 接成管道、不归一化 configOptions、不收集分片、取消不接线 |
| 模型与档位 | 不传 `--model` 只靠命令行、改完模型不更新会话当前值、档位不提交、档位不传给后端、档位选中态用账号当前值 |
| 页面状态 | 打开位置不去重、页面永远显示未连接、没探测也允许点、检查成功也说没检测、收回的模型不显示 |
| 认证失败 | 认证被拒都算握手失败、没探测成功也标「账号不提供」 |

跑一遍约 10 分钟（每条变异都要跑一次全量测试）。

## 装进 profile

用 DSH 官方的插件安装入口指向本仓目录，**不要手写** profile 的 `package.json` 或 `cordis.patch.yml`。

注意：链接安装（`link:`）下改源码不会换掉已加载的模块——ESM 有模块缓存，**必须重启应用**才加载新代码。
客户端文件在页面刷新后即可拿到新版本。

## 尚未验证

- Windows / Linux：命令行发现与路径拼接已写并测过纯函数，但没有真机跑过。
- 真实 turn 在 provider 内的完整路径（工具调用 → ACP → 回填）在 macOS 上验过多次。
- 暗色主题下的实际观感、触摸与窄屏（本项目未做移动端适配）。
- 胶囊控件没有实现 roving tabindex / 方向键导航：`role=radiogroup` + `radio` + `aria-checked`
  语义正确，但每颗胶囊各占一个 Tab 位。
- 没有打过 tarball 分发（当前以目录/link 形态安装），`npm pack` 后的 `files` 白名单未核。

## CI

`.github/workflows/test.yml` 在 Node 22 / 24 上跑 `npm test`，`main` 上额外跑变异门禁。
CI 里没有官方应用，所以用 npm 上的 `@deepseek-ai/schemastery` 代替本地链接；
本地开发仍走 `scripts/link-dev-deps.sh` 链到已装应用的运行时包。
