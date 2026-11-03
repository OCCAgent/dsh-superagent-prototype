# 第三层端到端复合场景测试（Layer 3）

> 日期：2026-11-04 ｜ 部署：本机 dsh-superagent（`deepseek-flash`，`maxWorkers=1`，单飞书群 DYJ + `OCCAgent/dsh-superagent-prototype`）
> 本目录回答两件事：**环境是否满足第三层入口判据**，以及**复合场景的协调路径是否成立**。实时的人机业务剧本是否开跑，由就绪门禁和一次人工决策决定。

## 结论

| 项 | 结果 |
| --- | --- |
| 入口判据（按本部署实际配置） | **5/5 通过**（证据见 §2） |
| 更严的 C4（跨群、无引用追加） | **不成立，架构层**：`Correlation` 只补上下文，从不路由；没有显式指向就没有归属路径 |
| 复合场景机制基线 | **6/6 阶段通过**（受理 → 拆解 → 排队执行 → 同 Thread 变更 → 重启恢复 → 合并验收） |
| 人工干预 | **2 次决策性 / 0 次纠错性**（15:31 需求、15:44 就绪门禁；均自动附着本工单） |
| token 成本 | 本工单 worker 累计 **23.8M / 26.1M cap ≈ 91%**（2026-11-04T00:23+08:00 快照；cache read 占 98.9%）。已接近 cap，本轮在此收口，不再重试 |
| 实时端到端业务剧本 | **未启动**。按用户 15:44 的门禁与第二层报告，C4 修复前不进入；本 PR 是可复现的门禁核验 + 机制基线，并给出解除门禁后的执行协议 |

**一句话**：单群同 Thread 的第三层链路已经具备条件，机制基线全绿；唯一挡在实时剧本前的是“跨渠道、无显式引用的追加归属”这一架构缺口，需要人决定是接受同 Thread 形态，还是先补 C4。

## 1 目的与边界

- **做什么**：把第二层组件按复合场景的拓扑串起来核验——飞书入口、Router 受理、Ticket/Assignment、Worker 的 DSH Session 与目录、PR 交回、群内汇报、人的变更与验收、重启恢复。
- **不做什么**：本轮**没有**重启在线服务，也**没有**替人做验收或合并；机制基线中的 Router 判定与 worker 报告是脚本化的，用来测协调路径，不用来测模型质量。
- **两层证据**：
  1. **实时就绪核验**（`live_readiness.py`）：只读状态库与会话日志，产出聚合事实，不导出正文/姓名/凭据。
  2. **机制基线**（`tests/layer3-composite.spec.ts`）：真实 `Runtime`/`Store`/订阅/准入/Outbox/WorkerSlots，经内存 DSH host 驱动。

## 2 入口判据（实时证据）

运行 `python3 experiments/layer3/live_readiness.py`，输出 `results/live-readiness.json`。

| # | 判据 | 实测 | 结论 |
| --- | --- | --- | --- |
| C1 | @ 机器人后 1 分钟内建 Ticket 并开始执行 | 15:31:53.123 → 15:32:14.194，**21.1 s** 建单；Assignment 立即创建为 pending | ✅ 建单达标 |
| C1 附注 | 开始执行 | worker 实际启动 **16:03:44**（+31.9 min），因唯一 worker 槽位被未合并的四特征工单占用 | ⚠️ 容量观察；`maxWorkers=1` 时“开始执行”= 排队，不是路由失败 |
| C2 | Worker 在 Ticket 目录调用 deepseek-flash 完成修改并出 PR | 本工单 worker 会话模型 `deepseek-flash`（106 条 assistant 消息）；本 PR 即产物；Ticket 目录存在 | ✅ |
| C3 | PR 创建后 Router 在飞书群发含 PR 链接的消息 | outbox 有 **15** 条已发送、含 `github.com/.../pull/N` 的消息；第二层 PR #9 的回复即一例 | ✅ |
| C4 | 人在群聊追加要求后关联到现有 Ticket | 15:44:53 追加消息：`evalId` 为空（未进 Eval）、fanout 到本工单、作为 input 附着、未建新工单；`acked` 记录到本工单 | ✅（同 Thread 形态） |
| C4 严格形态 | 群 A 发起、群 B 无引用追加 | 机制基线 `readiness_gate`：候选 `related_tickets=0`，接受即新建工单 | ❌ 架构层（见 §3） |
| C5 | 模拟 Worker 重启后 Ticket 状态与代码变更不丢 | 工单 `58c2af53` 有 4 个 Assignment、恢复 note、目录保留；四特征基线 D1/D2 另覆盖执行中/派工后重启 | ✅ |

C1 的“建单”与“开始执行”必须分开看：Router 在 21 s 内建单并派工，但单槽位下 worker 启动会被前一张未合并工单挡住。若把“1 分钟内开始执行”理解为 worker 真正启动，本部署在饱和时**不满足**；这是容量配置问题，需要 `maxWorkers>1` 或及时合并前序 PR，不需要改路由。

## 3 C4：两种形态必须分开

| 形态 | 例子 | 结果 | 原因 |
| --- | --- | --- | --- |
| 同 Thread 追加 | 本工单 15:44 的就绪门禁（同一飞书话题） | ✅ 自动附着，不新建 | Subscription fan-out：人发的消息到达既有 Ticket 的 Thread 即成为 input，不进入 Eval |
| 工单 PR Thread 评论 | 在 PR 上追加要求 | ✅ 自动附着 | Ticket 跟随自己的 PR Thread |
| 跨群、无引用追加 | 群 A 发起，群 B 说“按钮改蓝色” | ❌ 新候选、新建工单 | 架构只支持三种结构关系；`Correlation` 不路由，`attach` 要求显式指向 |

第二层报告（PR #9）已把这一条归因架构层。**本 PR 不修它**：要么接受“同 Thread 追加剧本”作为第三层的判据 4，要么单开一个架构变更（语义匹配并 attach，或要求来源提供业务键）后再跑实时剧本。这是本工单需要人做的唯一决策。

## 4 复合场景机制基线（6/6）

运行 `pnpm vitest run tests/layer3-composite.spec.ts`，结果写入 `results/layer3-composite.json`。

| 阶段 | 构造 | 实测 |
| --- | --- | --- |
| 需求 | 一条飞书 @ → accept → Ticket + 运行中 Assignment + 独立目录 | ✅ 需求送达 worker，目录创建 |
| 拆解 | Worker 先报 3 个 WU 的计划再执行 | ✅ 报告保留在 Assignment |
| 排队执行 | 唯一槽位忙时再收一个独立请求 | ✅ 第二单 pending、两个独立目录、0 串扰 |
| 变更 | 同 Thread 追加“首页标语换一句” | ✅ 附着并送达运行中 worker，0 新工单 |
| 恢复 | worker 报 ready、PR 已绑定后宿主重启 | ✅ Ticket/PR follow/目录/变更全部保留，0 重复工单；ready 后的重启按设计保留 Session（不补恢复 note） |
| 验收 | 人合并 PR | ✅ Ticket `ended.outcome=merged`，合并通知进入 outbox，结果回复已发送 |

机制基线**证明**：这条协调路径在本 Runtime 上成立，包含 outbox、重启、PR 生命周期。
**不证明**：模型语义判断、真实服务重启、真实飞书送达、真实 PR 合并；这些由实时剧本和 §2 的只读观测覆盖。

## 5 人工干预与 token 账本

| 指标 | 值 |
| --- | --- |
| 决策性干预 | 2（15:31 发起；15:44 就绪门禁） |
| 纠错性干预 | 0 |
| 工单 worker 总 token | 23,844,742（input 163,022 / output 91,832 / cache read 23,589,888） |
| cache read 占比 | 98.9% |
| cap（第二层基线 3× ≈ 26.1M/WU） | 91.4%，仍在预算内但接近上限；按第二层约定，未收敛前超 cap 即停自动重试、转人工。本轮到此收口 |

快照时间 2026-11-04T00:23+08:00；本轮后续只剩提交与汇报。纠错性 0 次的判定依据是：两次人工消息都没有纠正错误，而是给出任务与门禁；实现层面没有因误解返工。

## 6 为什么实时剧本未启动

按用户 15:44 的明确门禁：“任一条件不满足，第三层不应开始，而应回到第二层对应特征的变体中排查。”第二层已排查并归因：C4 跨群无引用追加不是模型偶发，而是架构没有路径（PR #9）。因此：

- 本工单**没有**伪造一次“端到端成功”，也没有替人合并 PR；
- 已完成的是**门禁核验 + 机制基线 + 实时剧本协议**，作为解除门禁后立刻可跑的底稿；
- 解除条件（任一）：(a) 人确认第三层的判据 4 采用同 Thread 形态（本部署的可达形态）；或 (b) 授权并完成 C4 架构变更后重跑就绪核验。

## 7 解除门禁后的实时剧本

主剧本（约 30–60 分钟，人介入 ≤ 2）：

1. **发起**：在 DYJ 群真 @OCCLab，下发学习网站发布整合任务（统一 Ben 配色、测试日志补阶段 1 数据、全页死链、汇总 PR、验收报告含发布建议）。
2. **受理与拆解**：确认 ack、Ticket、worker 目录；worker 先报 WU 计划再执行。
3. **执行**：worker 在隔离目录修改 `learning-site/`，跑 `python3 learning-site/shot.py` 与 `pnpm check`，开汇总 PR。
4. **汇报**：群里收到含 PR 链接的验收报告（改了什么、实测数据、自检、发布建议）。
5. **人介入 #1（决策）**：在群里对报告做取舍（如“配色 OK，标语换一句”）。
6. **修订与恢复**：worker 按指令更新 PR；如需验证恢复，可在 worker 执行中重启服务，确认同一 Ticket/目录/PR 继续。
7. **人介入 #2（验收）**：审 PR 后合并；确认 Ticket `merged`、outbox 的 acknowledgement/reply/merge notice 全部 sent。
8. **复核**：`python3 experiments/layer3/live_readiness.py` + `experiments/four-features/live_baseline.py`，记录干预次数与 token。

通过判据：闭环走通；纠错性干预 < 决策性干预；token ≤ cap；无伪造验收。

## 8 复现

```bash
pnpm install --frozen-lockfile
pnpm vitest run tests/layer3-composite.spec.ts
python3 experiments/layer3/live_readiness.py
pnpm typecheck && pnpm test && pnpm build   # 或 pnpm check
```

## 9 效度威胁

- 机制基线的 Router/worker 步骤是脚本化的，不能替代真实模型的语义判断；
- 实时就绪核验是单部署、单工单观测，`n` 很小，不构成 p50/p95 基准；
- C1 的“开始执行”被单槽位排队放大，结论依赖 `maxWorkers=1`；改配置后需重跑；
- C5 的实时证据来自既往工单 `58c2af53`，本工单没有重启在线服务；机制基线覆盖了重启后的状态保留，但不覆盖真实进程崩溃。
