# 验收记录 0.1.0-2

candidate-sha256: 0c8995f7514df02194cd4058d4e8e61b79cd0c7b714ad7a2d4eb08aa530f88fb
adr: ADR-003（思考强度与速度作为独立会话档位）；本批另有 ADR-001/002 的既有决定不变
review: Devin(SWE-2) 独立审查（2026-11-08，另一 agent、只读）→ 4 条 [应修] 全部修复 + 补测试，
不含未处置的阻断项

冻结方式：`node scripts/hash-runtime.mjs` 对**运行时真实加载的字节**取 SHA-256
（`lib/` · `cordis.patch.yml` · `locale/` · `icon.svg` · `package.json`，按相对路径排序）。
docs 不计入：文档不进运行时，改文档不该让候选字节变样，也避免「记录里写哈希」的循环依赖。

## 目标与分发

| 项 | 值 |
|---|---|
| 目标运行时 | DeepSeek Harness 桌面版 **0.2.2-rc.1**（macOS arm64） |
| 平台 | macOS 已验；Windows/Linux **未验** |
| 分发模式 | **独立插件**（非 suite 成员）；安装形态是本仓目录直接作为 profile 的 `node_modules` 条目（symlink） |
| 版本 | `0.1.0-1` → `0.1.0-2` |

身份表：

| 项 | 值 |
|---|---|
| 包名 / Client factory | `@omnisurge/dsh-subagent-devin` |
| Host 模块 | `lib/index.js`（`name = 'subagent-devin'`） |
| row id | `subagent-devin`（`cordis.patch.yml`） |
| Settings ns | 插件行 entry id（实测为 `include:subagent-devin`） |
| Client slot key | `settings.section`（`id = subagent-devin`，`order = 25`） |

## 本批内容清单

1. 已保存的模型被账号收回后，下拉里仍显示它并标「账号当前不提供」（有列表才敢这么说）。
2. 模型改用 `session/set_config_option` 真正设上去（`--model` 是摆设）；上限放到 400，实际 132 项。
3. 思考强度（medium/high/max）与速度（standard/fast）作为两个 volatile 字段 + 页面胶囊控件。
4. review 后修复：锁定提示三态、「默认」段显示账号当前值、去掉未验证的账号断言、测试桩改为
   `saved ≠ current`、补「点默认清空」「档位被拒仍继续」两例。
5. 文案变更：**零**（review 指出「标准档是账号默认」是未验证断言，已删，不新增）。

## 权威事实与路径

| 事实 | 权威 owner | 写入口 | 派生/快照 |
|---|---|---|---|
| 用户选了什么档位 | 插件配置 `thought` / `speed`（volatile） | 页面 `remote.settings.update` → 行重载 | 页面选中态只读这两个值 |
| 账号当前档位与可选项 | 探测结果 `probe.thought` / `probe.speed`（volatile） | 仅 Host 探测写入 | 页面「默认」段显示 `current`；未认证时为空 |
| 账号可用模型 | `probe.models` | 仅 Host 探测写入 | 下拉选项；已保存值不在列表时保留并标注 |

模型 / 档位的实际生效点是 `session/set_config_option`；`--model` 命令行参数**不是**生效路径
（实测被忽略）。留空 = 不发请求，与「设成某个默认值」是两种语义，代码里用 `''` 区分。

## 门槛

| 门槛 | 证据 | 状态 |
|---|---|---|
| G0 契约与范围 | 本文件 + ADR-003 + SPEC §3/§4/§5 + 实测记录 2026-11-07/11-09 | 已完成 |
| G1 单元 | 5 个文件 **63 例通过**；**27 个变异**全部按预期变红（全量输出见下）；新增变异「选中态用账号当前值」「检查成功也说没检测」「档位不提交」「没探测也允许点」「档位不传给后端」 | 已完成 |
| G2 Host 组合 | 真 CLI 真进程：`acp` 握手、`session/new`、`set_config_option`（model/thought_level/speed）、`session/prompt` 全链路亲验 | 已完成 |
| G3 实际产物 | `scripts/hash-runtime.mjs` 产出并绑定上文 SHA；未做 `npm pack`（独立插件以目录形态安装，无 tarball 分发） | 部分（打包形态未验） |
| G4 Client 链路 | 页面在真实桌面客户端加载过（用户可见两行胶囊）；**本批新控件由用户在原位确认可用** | 已完成（本机） |
| G5 原生路径 | 用户手动切换思考强度 → 落盘 → 下次运行生效，全链路走过一遍 | 已完成（本机，单账号） |
| G6 平台/账号 | macOS 单账号；Windows `windows-g6`、Linux **未验** | 部分 |

## 撤回变体（关键项）

| 撤掉什么 | 指定 oracle | 结果 |
|---|---|---|
| `set_config_option('thought_level'/'speed')` 调用 | 「档位也走 set_config_option」 | 变红 |
| 胶囊 `onClick` 写设置 | 「点一下就把档位写进设置」 | 变红 |
| 「默认」段的清空语义 | 「点默认把已选档位清空」 | 变红 |
| 禁用条件 `levelLocked` | 「档位控件禁用」 | 变红 |
| 三点式锁定文案（退回两态） | 「探测成功但后端没给档位」 | 变红 |
| 选中态改用 `probe.current` | 「档位选中态来自已保存的值」 | 变红 |

## 未验边界

- `swe-2-high + thought=max` 与 App 的 `swe-2-max` 是否等价：日志无思考预算计量，**无法比较**。
- 其他账号的可用表可能不同（本账号 132 项，观测到从 2 → 132 的变化）；页面按探测结果渲染，
  不在代码里钉死任何模型。
- Windows/Linux 未验；`npm pack` 分发形态未验。
- 胶囊未做 roving tabindex / 方向键导航（语义正确，键盘体验弱于完整 ARIA 模式），已记入
  `docs/guides/implementation.md` 的已知取舍。

## 结论

Ready for Acceptance（限本机 macOS、单账号）：承诺给用户的路径已交付并亲验，G3 打包形态与
跨平台 G6 未验。不含已知阻断项。
