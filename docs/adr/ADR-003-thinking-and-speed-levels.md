# ADR-003：思考强度与速度做成独立的会话档位，由页面用胶囊切换

- 日期：2026-11-09
- 状态：accepted
- 关联：[ADR-001](ADR-001-provider-and-settings-page.md)、[ADR-002](ADR-002-page-host-channel.md)、
  [SPEC 第 3、4 节](../specs/devin-subagent.md)、[实测 2026-11-09](../evidence/measured-20261109.md)

## 背景

Devin 的 ACP 会话在 `session/new` 里给出**四个并列的配置项**：`mode`、`model`、
`thought_level`（medium/high/max）、`speed`（standard/fast）。它们不是嵌套关系，
每一项都能单独 `session/set_config_option`。

而用户能看到的界面只有「模型」一个下拉。于是出现两个问题：

1. **能力缺口**：账号能把思考强度拉到 `max`，插件页却没有入口，用户只能回 Devin App 里改。
2. **表达误导**：`swe-2-high` 这类模型 id 自带 `high` 字样，旁边又有独立的 `thought_level`。
   用户会自然地问「我选了 High 的模型，再把强度设成 Max，到底哪个算数」。
   实测（同一会话内反复切换）：**两者互不影响**——改强度时模型 id 不变，改模型时强度不变。

## 决策

**把 `thought_level` 与 `speed` 提升为插件自己的两个 volatile 配置字段，页面用胶囊单选。**

| 项 | 字段 | 取值 | 空值语义 |
|---|---|---|---|
| 思考强度 | `thought` | `medium` / `high` / `max` | 留空 = 跟随账号默认，**一个请求都不发** |
| 速度 | `speed` | `standard` / `fast` | 同上 |

配套四条硬约束：

1. **空值即沉默**：留空不是「设成 medium」，是不发请求、让账号自己的设置生效。
2. **认证前不报档位**：未通过认证时后端给的是兜底默认值，不是这个账号的可选集。
   报了等于拿「没认证的猜测」冒充账号设置，所以探测只在 `authenticated` 时带这两块。
3. **选中态只来自已保存的值**（`settings.thought` / `settings.speed`）。
   账号当前值只写在「默认」那一段上（`默认 · 高`）。两者搞混就是拿账号默认冒充用户已选。
4. **拿不到选项就整组禁用**，并区分三种原因：还没探测 / 探测过但后端没给 / 有档位。
   第二、三种混用会让页面在检查成功后继续催用户「重新检查」，而那条路走不通。

## 为什么用胶囊而不是下拉

这与套件 UI 的分层一致（ADR-044，见 `docs/guides/implementation.md`）：

- 2–4 档用胶囊，选项多的（模型 132 项）继续用下拉。
- 只有滑块填色，轨道保持描边；颜色编码状态（主文字色底 + 背景色文字，不写字面色值）。
- 满宽分段条是 chrome 级切换用的，内容区的档位不用它。

形状变更属于结构档，设计稿在 `.scratch/settings-capsule/design/settings-page-v4.svg`，已确认。

## 后果

- 用户不必回 Devin App 就能切换强度；下次运行生效（会话级设置，不影响已开始的会话）。
- 页面多两行控件，`probe` 多两个子对象（各含 `current` 与 `options`）。
- 被后端拒绝时只记一条事实（`set_config_option` 拒绝），运行继续、用账号当前值。
- **已证实等价**（2026-11-09 受控实验）：账号可用表里没有 `swe-2-max`，只有基线 `swe-2-high`；
  但设置 `thought_level=max` 后，Devin 会把它自己那条会话记录里的 `model` 改写成 `swe-2-max`
  ——与 App 里选 `swe-2-max` 是同一条记录、同一个值。所以「模型 SWE-2 + 强度 最高」不是近似，
  就是那个模型。机制上也自洽：日志里设档位的调用走的是 `apply_model_change`。
  因此页面**不需要**替 Devin 解释差异，也不该把内部 id 写到界面上。
