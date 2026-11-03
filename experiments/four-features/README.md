# 四特征逐项验证实验（第二层）

**结论（2026-11-03，本机部署）**：四个特征中 **3 个成立，1 个不成立**，满足“至少三个成立”的退出判据；不成立项有明确的**架构层**归因。

| 特征 | 结果 | 判据与归因 |
| --- | --- | --- |
| 连续 Continuity | **不成立（部分）** | 同一 Thread、工单 PR Thread 的追加要求能正确归属；**无结构关联的跨渠道追加要求不会自动归属**（架构层：Correlation 只补上下文、不路由；attach 需要显式指向） |
| 高效 Productivity | 成立 | 5 个独立任务、1 个 worker 槽位时，Router 仍立即接单并排队；运行中工单的插话不被槽位阻塞；0 串扰 |
| 主动 Proactivity | 成立 | 有规则授权的 CI 失败在无 @ 下建单；中性讨论 0 误触发；CI 成功等扰动事件 0 建单 |
| 持久 Persistence | 成立 | worker 执行中断、Router 已派工未回收两种中断均可从持久状态恢复；0 人工步骤、0 重复工单 |

> 这是**第二层**（架构承诺）验证，不复制外部 p50/p95 数字，也不替代第三层端到端复合场景。下面分别给出可复现的机制基线和真实运行观测基线。连续性的进一步拆解见 [continuity-deep-dive.md](continuity-deep-dive.md)。

---

## 1 目的与边界

- **不做什么**：不声称复现文章中的 300 条消息 × 20 个工作请求 × 5 次重复的基准；本环境没有单 Session 对照组，也没有正式基准。
- **做什么**：建立**本环境可复现的基线**，并逐项检验四个特征在“真实操作条件”下是否成立。
- **两层证据**：
  1. **机制基线**（`tests/four-features.spec.ts`）：真实 `Runtime`/`Engine`/`Store`/订阅/准入/Outbox/WorkerSlots，经内存 DSH host 驱动；Router 判定与 worker 报告由脚本给出，用来测**协调机制**，不用来测模型质量。
  2. **观测基线**（`live_baseline.py`）：只读采集本机部署的 SQLite 状态库与 DSH Session 日志，给出真实任务耗时、token 成本、跟进归属与恢复记录；是 observational baseline，不是受控实验。
- **模型依赖项**（无结构关联的跨渠道语义归属、真实 CI 规则触发、真实重启）另给人类可执行的现场协议，见第 7 节；本轮不把它们伪装成已验证。

## 2 环境基线

| 项 | 值 |
| --- | --- |
| 仓库 / 提交 | `OCCAgent/dsh-superagent-prototype`，基线提交 `0f9be20`（实验分支另开） |
| 运行时 | Node `v22.23.2`，pnpm `11.7.0`，vitest `4.1.8` |
| 部署 | 本机 dsh-superagent 服务，`maxWorkers=1`，eval/executor 均为 `deepseek-flash` |
| 状态库 | `~/.dsh/state/superagent/orchestrator.sqlite`（实验全程只读） |
| Session 日志 | `~/.dsh/sessions/**/session.v4.jsonl.zstd`（只取 token 计数，不导出正文） |
| 观测快照 | 2026-11-03T23:36+08:00（`results/live-baseline.json` 的 `generated_at`） |

## 3 方法

每个特征至少 **2 个用例（典型 + 扰动）**；连续性和主动性各加 **1 个“不应发生”的负向用例**。

| 概念 | 定义 |
| --- | --- |
| 典型用例 | 特征在正常路径上应发生的正向行为 |
| 扰动用例 | 并发、插话、噪声、非故障事件等压力下，正向行为仍成立且不误伤 |
| 负向用例 | 不该发生的归属或行动；发生即失败 |
| ground truth | 机制基线由状态库的 Ticket/Input/Decision/Assignment 事实给出；观测基线由 trigger → disposition → decision → ticket 链人工核对 |
| 重复 | 机制基线每次运行确定；观测基线为单部署、小样本，报告 `n` 与 min/p50/p95/max，不声称置信区间 |
| 指标 | 正确归属率、人工澄清次数、p50/p95、并行上限、串扰率、误触发率、恢复成功率、人工介入步骤、token 成本 |

**退出判据（本轮采用）**：四个特征中至少三个成立；失败项必须给出架构层或实现层归因，不接受“效果不好”。

## 4 机制基线（可复现）

运行：

```bash
pnpm vitest run tests/four-features.spec.ts
```

结果写入 `experiments/four-features/results/four-features.json`。本轮 4 个实验场景的断言全部通过；退出判定为 **3/4 特征成立**（连续性的 C4“无显式引用跨渠道”用例按观测记录为失败）。

### 4.1 连续 Continuity

> 深挖：跨会话、跨应用、完成后续接、多任务隔离与显式 attach 的七层分析见 [continuity-deep-dive.md](continuity-deep-dive.md)。

| 用例 | 类型 | 构造 | 期望 | 实测 |
| --- | --- | --- | --- | --- |
| C1 | 典型 | 工单已开 PR #42；需求追加在 PR 评论，不引用原飞书消息 | 归到同一工单，不新建 | ✅ 1/1，0 新决策、0 新工单 |
| C2 | 扰动 | 群 B 的无关闲聊；随后群 A 原 Thread 的正常追加 | 正常追加进入 | ✅ 1/1 归属 |
| C3 | 负向 | 群 B 的无关闲聊 | 不进入群 A 的工单 | ✅ 0 泄漏 |
| C4 | **规范指定** | 群 A 发起任务；群 B 追加需求，无显式引用 | 自动识别为同一任务的更新 | ❌ 0/1；候选 `related_tickets=0`，接受后新建工单 |

同一基础环境：两个飞书群 + 一个 GitHub 仓库，只改变用例输入，不重建系统。

**架构层归因**：实现只用三种结构关系建立归属——发起 Thread、工单跟随的 PR Thread、同一 Trigger 同属多个 Thread（Correlation）。`docs/001-domain.md` 明确“Correlation 只补上下文，从不路由”，`docs/002-authorization.md` 要求主 Session 只在消息**显式指向**工单时 attach。因此 C4 不是模型偶然失败，而是当前架构没有“无显式引用的跨渠道归属”这条路径；要让 C4 成立，需要新增“按语义匹配并 attach”的机制，或要求来源提供可关联的业务键（如 issue/PR 编号）。

**连续性深挖（C5–C8）**：PR 合并、Ticket ended 后，人在 PR 评论追加要求 → 同一 Ticket 恢复（Mandate 不变，0 新工单）；契约相同的 CI 事件不恢复 ended Ticket；完全删除 worker Session 后重启，Ticket/目录/progress 报告保留、Session 重建；两个 Ticket 的跟进 0 串任务；群 B 更新在 router 显式 attach 时才进入群 A 工单。结论：**Ticket 是持久实体，但跨 Thread/跨应用/跨端的自动实体解析不存在**。完整分析见 [continuity-deep-dive.md](continuity-deep-dive.md)。

### 4.2 高效 Productivity

| 用例 | 类型 | 构造 | 期望 | 实测 |
| --- | --- | --- | --- | --- |
| P1 | 典型 | `maxWorkers=1`；连续提交 5 个独立任务；饱和时再收新请求 | 立即接单、排队；并行上限 1 | ✅ 4 个排队、1 个运行；Router 未等待 |
| P2 | 扰动 | 队列满时，运行中工单收到人的插话 | 插话立即进入运行中工单 | ✅ 1/1，无需等槽位 |

- 5 个工单使用 5 个独立工作目录；人工抽检 worker 输入 **0 串扰**（无其他工单 ID/目录）。
- 本基线只证明协调机制；p50/p95 与 token 成本见第 5 节，不能由 fake worker 计时推出。

### 4.3 主动 Proactivity

| 用例 | 类型 | 构造 | 期望 | 实测 |
| --- | --- | --- | --- | --- |
| A1 | 典型 · observe | 打开默认分支 CI 接收 + 准入表 `ci=inferred` + `ci-fix` 规则；CI 失败、无 @ | observe log 记录候选与 would-accept，不建工单 | ✅ 1 候选 / 1 would-accept / 0 工单 |
| A2 | 典型 · auto | 同一环境切到 auto，重复同一 CI 失败 | 建 inferred 工单 | ✅ 1 工单，matched `ci-fix` |
| A3 | 负向 · observe | 中性讨论、未 @、无匹配规则 | 不行动 | ✅ 0 误触发 |
| A4 | 负向 · auto | 同上，auto 模式 | 不行动 | ✅ 0 误触发 |
| A5 | 扰动 | 同一规则下，另一分支 CI **成功** | 不建单 | ✅ 0 工单 |

同一基础环境（Sources 不变），只切换 `eval.mode`；另测同一 CI 失败在规则缺失时被 ignore（`noRuleMatched`），说明“主动”确实受规则准入约束。

### 4.4 持久 Persistence

| 用例 | 类型 | 构造 | 期望 | 实测 |
| --- | --- | --- | --- | --- |
| D1 | 典型 | worker 执行中，宿主停止后重启 | 旧 assignment ended，新 assignment 带 recovery note 继续；Ticket 目录与 Session 保留 | ✅ 同工单/同 Session/同目录，目录存在，0 人工步骤 |
| D2 | 扰动 | 派工后、worker 尚未回报时重启；另有一个排队工单 | 在途 assignment 恢复；排队工单不丢；并行仍受 1 槽限制 | ✅ 2/2 工单保留，仅 1 个运行，0 重复 |

## 5 真实运行观测基线

数据来自本机部署的状态库与 Session 日志；只保留聚合数字，不导出飞书正文、参与者姓名或凭据。

### 5.1 任务耗时

| 指标 | n | min | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- |
| 已完成工单（创建→结束） | 4 | 154 s | 528 s | 10,551 s | 10,551 s |
| 活跃 assignment（≤2 h） | 14 | 122 s | 658 s | 2,073 s | 2,073 s |
| 全部 assignment（含跨夜） | 16 | 122 s | 663 s | 45,523 s | 45,523 s |

说明：n=4 的 p95 就是最大值，等于“learning-site 6 个 WU 的总工期”（10,551 s ≈ 175.8 min，约 29.3 min/WU）；单任务 p50 为 8.8 min。跨夜 assignment 是等待/中止造成的长尾，不应与执行时延混为一谈。**样本太小，不能作为 p50/p95 基准，只作为本环境的第一份可复现观测。**

### 5.2 Token 成本（与延迟同等重要）

| 对象 | 总 token | cache read | cache read 占比 | assistant 消息 |
| --- | --- | --- | --- | --- |
| learning-site 6 个 WU | 52,284,551 | 51,922,304 | 99.3% | 288 |
| — 折算每 WU | ≈ 8,714,092 | ≈ 8,653,717 | ≈ 99.3% | 48 |
| 单任务 A（评审文章） | 4,971,675 | 4,774,144 | 96.0% | 48 |
| 单任务 B（费曼拆解） | 3,788,508 | 3,650,944 | 96.4% | 51 |
| 单任务 C（通道测试） | 312,612 | 285,952 | 91.5% | 13 |
| Router Session（累计） | 2,259,963 | 2,210,432 | 97.8% | 63 |

结论：本环境的成本主要是**读缓存 token**，占 worker 总 token 的 98–99%。因此“高效”不能只看时长；第三层必须把 token 成本与延迟并列验收。

**第三层成本上限（设计，待现场执行）**：

- 记 `B` 为同一工作单元在本基线的总 token（默认取 learning-site 每 WU ≈ 8.71M）。
- 预设 `cap = 3 × B ≈ 26.1M total tokens / 工作单元`；cache read 单列，估算约 8.65M / WU。
- 若端到端任务在未收敛前累计 token 超过 cap：**停止自动重试，转人工复核**，附当前 PR/diff、已花 token 与剩余预算；不得靠继续重试“撞”出结果。
- 该 cap 是**暂定值**：本环境缺单 Session 对照，无法直接验证“2–3 倍”比例；第三层开始前应由操作者确认是否改用单 Session 基线校准。

### 5.3 连续与主动的观测记录

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Thread 跟进被扇出到既有工单 | 20 | 同 Thread 追加进入工单，未新建 |
| 共属多个 Thread 的 Trigger | 0 | 本部署未出现 Correlation 路由场景 |
| 未 @ 的人工消息 | 12 | 4 条走 Eval 后 `no_mention` ignore；7 条作为既有 Thread 上下文；1 条评估超时 |
| 未 @ 消息新建工单 | 0 | 中性场景误触发率 0.0 |
| 真实跨渠道追加 | 0 | 本部署未出现“另一渠道追加到既有工单”的人工事件，C1/C4 仍以机制基线为准 |

本工单自身提供了一个**真实同 Thread 连续**样本：初始 trigger `d9d762d6…` 建单后，追加消息 `10d4b1e6…` 在 2 分钟内进入同一工单，未新建、未要求人工转述。PR #9 打开后，reviewer 在 GitHub PR 评论提出连续性深挖要求，该评论经 PR Thread 订阅进入同一工单并由本 worker 继续处理——真实跨应用续接。

### 5.4 持久观测记录

- 工单 `58c2af53…` 记录到 4 个 assignment 与 1 条 recovery note，说明真实重启路径会把“执行中断”落为 `ended` + 新 assignment，并在输入里写明 `host restarted`。
- 机制基线 D1/D2 另外覆盖了“派工后未回报”的严格变体；真实环境本轮**未再主动重启服务**（会中断正在进行的验证），因此只把它记为观测样本，不声称已完成受控重启实验。

## 6 归因与退出判定

| 特征 | 成立？ | 层 | 说明 |
| --- | --- | --- | --- |
| 连续 | 否（部分） | 架构 | 只支持 Thread/PR/显式指向的结构化归属；无显式引用的跨渠道语义归属没有实现路径 |
| 高效 | 是 | — | 协调机制成立；真实 p50/p95 与 token 已给出首份观测基线，样本不足以宣称基准 |
| 主动 | 是 | — | 有规则则动、无规则则静；中性讨论 0 误触发 |
| 持久 | 是 | — | 两种中断均恢复，0 人工步骤、0 重复 |

**退出判定：3/4 成立，满足“至少三个成立”；连续性的失败已定位到架构层（Correlation 不路由 + attach 需显式指向），不是笼统的效果问题。**

## 6.1 第三层入口就绪判据（按最新要求核对）

| 判据 | 状态 | 依据 |
| --- | --- | --- |
| 飞书 @ → Router 1 分钟内建 Ticket 并开始执行 | 观测通过 | 本工单 trigger 15:21:24 → Ticket 15:21:34（10 s）；实际 Ticket/Assignment 时间见状态库 |
| Worker 在 Ticket 目录完成代码修改并创建 PR | 观测通过 | learning-site 工单 `8f6f1d62…` 的 6 个 WU 各开 PR #3–#8 |
| PR 创建后飞书群收到含 PR 链接的消息 | 观测通过 | outbox `reply sent` 记录（PR #3–#8 的交付消息） |
| 群聊追加要求关联到现有 Ticket，而非新建 | **不满足** | 连续 C4：无显式引用的另一群追加，`related_tickets=0`，接受后新建工单；显式 attach 可以做到（C8），但不是自动 |
| Worker 重启后 Ticket 状态与代码变更不丢 | 机制与观测通过 | D1/D2 目录/Session 保留；真实工单 `58c2af53…` 有 recovery note |

**结论（操作者已决策）**：按实时剧本，**同一 Thread 追加**可作为判据 4 先行接受，第三层可以开跑；C4 的“无显式引用跨渠道自动归属”列为后续改进（语义匹配/业务键），不应表述为已满足。其余入口判据已有机制或观测证据。

## 7 效度威胁、未验证项与现场协议

**效度威胁**

1. 机制基线用 fake DSH host，Router/worker 的模型步骤是脚本；它验证系统编排，不验证模型语义判断。
2. 观测基线是单部署、小样本、非受控；token 总量随当前工单增长，表内为快照值。
3. 没有单 Session 对照组，无法计算“2–3 倍缓存读取”的比例，也无法复现外部 p50/p95。
4. 真实环境未做受控重启；C1/C4 未在真实飞书/GitHub 双渠道上重放。

**仍需人类执行的现场协议**（建议在第三层前完成，结果写回本文件）

- **连续 C4 真实验证**：在 GitHub Issue 发起任务 → 合并前在**另一个飞书群/私聊**追加一条不引用 Issue 的修改要求 → 观察是否自动归属到同一 Work Item；记录归属结果与人工澄清次数。
- **主动 A1 真实验证**：配置 `CI 失败 → 修复` 规则并打开默认分支 CI 接收 → 在默认分支制造一次失败（不要用生产分支）→ 观察无 @ 是否在合理时间内建单。
- **持久真实重启**：在一个长任务执行中重启服务 → 检查在途 assignment 是否带 recovery note 恢复、人工步骤数与恢复后继续产出时间。
- **高效尾延迟**：至少 20 个工作请求 × 3 次重复，分别记录 p50/p95 与每任务 token；没有单 Session 对照就只报告本环境数字。

## 8 复现

```bash
# 机制基线（确定性）
pnpm vitest run tests/four-features.spec.ts

# 观测基线（只读；默认读 ~/.dsh/state/superagent 与 ~/.dsh/sessions）
python3 experiments/four-features/live_baseline.py

# 产物
experiments/four-features/results/four-features.json
experiments/four-features/results/live-baseline.json
```

## 9 学习站素材

本文件的用例表、指标与归因已整理进学习站「测试日志」页的「第二层 · 四特征逐项验证」一节；页面保持单文件、无外部依赖，可直接 `file://` 打开。
