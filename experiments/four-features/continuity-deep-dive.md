# 连续性深挖：Super-agent 的“连续实体”到底连续了什么

> 触发：PR #9 review 要求针对连续性做深度验证与分析（“从单个会话里的长程任务走向跨会话、跨应用、跨端持续推进多项任务”）。
> 结论先行：**Ticket 是当前实现里真正的持久实体；跨 Thread / 跨应用 / 跨端的“同一个人、同一件事”没有自动实体解析。** 结构化的连续（同 Thread、工单 PR、完成后人工消息）成立；“换一个群/端/应用继续同一件事”不成立，除非主 Session 显式 attach。

## 1 连续性的七层模型

| 层 | 对象 | 存储/机制 | 跨重启 | 跨会话 | 跨应用 | 跨端/新群 | 跨任务 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L0 事件 | Trigger | 按 Source 事件 ID 幂等入库；不可变 | 保留 | — | Source 定义 | 新事件 | — |
| L1 线程 | Thread | Source 定义；订阅 fan-out；Correlation 只补上下文 | 保留 | 保留 | 仅已订阅/关联 Thread | 新群=新 Thread | 不合并 |
| L2 工单 | Ticket | Mandate、Inputs、Assignments、Channels、follows | 保留 | 保留 | 跟随 PR/Issue Thread | 新工单 | 工单隔离 |
| L3 派工 | Assignment | pending/running/ended；可多次 | 中断后重建 | 重建 | — | — | 每工单独立 |
| L4 会话 | DSH Session | session log + 历史；可重建 | 视持久化 | **可丢失/重建** | — | — | 每工单独立 |
| L5 工作区 | Ticket 目录/worktree | 文件与 git 分支 | 保留 | 保留 | GitHub 承载 | — | 每工单独立 |
| L6 外部产物 | PR/Issue | Ticket follows；关闭/合并驱动结束 | 保留 | 保留 | **核心跨应用载体** | — | 可关联多个 PR |
| L7 身份 | 每个 Source 的 actor | 各 Source 白名单；**不跨 Source 映射** | 保留 | 保留 | 不映射 | 不映射 | — |

关键点：**L2 Ticket 是连续性的锚点，不是 L4 Session。** 只要 Ticket、目录、PR 和 Inputs 在，换 Session 可以重建任务；反过来，Session 在而 Ticket 不在，就没有可归属的“同一件事”。

## 2 深挖实验（在同一条机制基线上追加）

运行：`pnpm vitest run tests/four-features.spec.ts`（`continuity deep` 用例）。结果在 `results/four-features.json` 的 `continuity.deep`。

| 用例 | 构造 | 期望 | 实测 |
| --- | --- | --- | --- |
| C5 完成后跨应用续接 | 飞书建单 → 绑定 PR #42 → PR 合并、Ticket ended → 人在 PR 评论追加要求 | 同一 Ticket 恢复，不新建，Mandate 不变 | ✅ resumed，0 新工单，Mandate 版本保留 |
| C5b 结束后 bot/CI | PR #43 合并、Ticket ended → PR CI 事件 | 不恢复 ended Ticket | ✅ 保持 ended、无 Input |
| C6 丢失 Session | 工单执行中 → 停宿主 → 删除 worker Session → 重启 | Ticket/目录/报告保留；Session 重建 | ✅ 目录与 progress 报告保留，Session 重新创建，`orchestrator_read` 可读 Ticket |
| C7 多任务隔离 | 同一基础环境两个 Ticket，各自 Thread 追加 | 各自续接，不串任务 | ✅ 0 跨任务泄漏 |
| C8 显式跨群 attach | 群 A 工单 + 群 B 无引用更新 → 主 Session `attach` | 更新进入同一 Ticket，不新建 | ✅ 1/1 attach，0 新工单 |

配套的 C1–C4（上一轮）：同一 Thread / 绑定 PR 的追加归属成立；群 B 无引用追加**不会自动归属**（C4 失败），无关闲聊不泄漏（C3 通过）。

### 真实运行旁证

- 本 PR 由飞书工单发起；PR #9 打开后，reviewer 在 **GitHub PR 评论**提出“连续实体深挖”，该评论通过 PR Thread 订阅直接进入同一工单，worker 继续推进，没有新建工单——这是 L1/L2/L6 的真实跨应用续接。
- 本机历史工单 `58c2af53…` 在真实重启后留有 recovery note 并重建 Assignment；`learning-site` 工单的 6 个 WU 在**同一 Thread** 下持续 3 小时、开出 6 个 PR，说明同一工单承载多阶段工作的能力成立。
- 真实环境中未出现“群 B/GitHub Issue 无引用追加到既有工单”的人工事件，C4 仍以机制基线为准。

## 3 架构层分析：为什么 C4 不是偶发

1. **Ticket 身份来自“接受哪条 Trigger”，不是“这件事是什么”。** Eval accept 时生成新 Ticket；没有业务键（issue/PR 编号、项目 ID、任务 ID）参与身份判定。两个渠道描述同一件事，系统看到的是两条 Trigger。
2. **归属只有三条结构路径。** 发起 Thread、工单跟随的 PR/Issue Thread、同一 Trigger 同属多个 Thread（Correlation）。`Correlation` 只补上下文、从不路由（`docs/001-domain.md`）；`attach` 要求消息显式指向工单，`docs/001-domain.md` 明确“只有消息显式指向工单时主 Session 才 attach”。
3. **候选上下文只看本 Thread 的 Ticket。** `assessment.ts` 的 `candidate.tickets` 是当前 Thread 上的工单（含 ended）；新群/新 Issue 的候选 `related_tickets=0`，模型即使“猜到”是同一件事，也没有结构化入口把它挂回去，除非主 Session 主动 `attach`。
4. **跨 Source 身份不映射是设计选择。** 同一个人在飞书和 GitHub 是两个 actor；白名单、授权、`actor` 都不跨 Source。于是“跨应用同一个人”只能靠 prompt 文本，不是系统事实。
5. **Session 不是任务状态。** DSH Session 历史可以持久化，但换 Session/换模型后，worker 依赖 Ticket Inputs/Reports/目录/git 重建；计划、推理和未落盘的上下文会丢。真正的连续性要求“工作状态”落盘到 Ticket 或仓库，而不是留在对话历史。
6. **多任务是隔离而非分组。** 每个 Ticket 独立生命周期、独立 Session/目录；没有父子工单、任务组、合并/拆分。一个“项目”的连续性是人在同一 Thread 里连续下发形成的，不是系统建模出来的。
7. **结束后只有人能把 Ticket 唤醒。** bots/CI 不唤醒 ended Ticket（设计如此，防止自动循环）；PR 合并后的 CI 回归需要新工单或人的一条消息。这与“跨应用自动持续推进”有张力。

## 4 结论与边界

- **连续实体成立的部分**：同一 Thread 的长程任务、绑定 PR 的跨应用续接、完成后人工续接、Session 丢失后的任务重建、多任务隔离、显式 attach 的跨群续接。
- **不成立的部分**：无显式引用的跨群/跨端/跨应用自动归属；跨 Source 身份映射；父子任务/任务组；无人工介入的结束后续接（bot/CI）。
- 因此“从单会话长程任务走向跨会话、跨应用、跨端持续推进多项任务”目前是**部分成立**：跨会话靠 Ticket/目录/PR 成立；跨应用靠已订阅 PR/Issue Thread 成立；跨端/新群与自动实体解析不成立。第二层判定仍为 **3/4**，连续性失败归因架构层。

## 5 建议（实现方向，不在本 PR 改代码）

1. **业务键关联**：accept 时记录可选业务键（仓库 + issue/PR 编号、项目/任务 ID），新 Trigger 命中时优先 attach 而不是新建。
2. **受控的跨 Source 身份表**：是否把飞书与 GitHub 的同一人映射为同一 principal，是 Policy 决策；映射只影响授权/归属，不改变 Source 事实。
3. **候选的“相关工单”扩展**：在 Eval 中按业务键/仓库/PR 提供相关工单，不只本 Thread；attach 仍需显式动作，避免误合并。
4. **父子/任务组**：给多 WU 项目一个 TaskGroup/Ticket 父子关系，支持汇总状态与跨任务连续性。
5. **工作状态落盘**：在 Ticket 上增加结构化 work state（计划、已决策、未决问题），新 Session 先读它，而不是依赖旧 Session 历史。
6. **端/群别名**：允许把多个群/设备地址显式绑定到一个任务实体；这比让模型猜更可靠。
7. **第三层门禁（操作者已决策）**：原建议是 C4 未修复前不放行；操作者已明确选择“先按实时剧本接受**同一 Thread 追加**作为判据 4 开跑，再补跨渠道归属（语义匹配/业务键）”。因此第三层可在“同 Thread 追加”口径下开始；C4 的跨渠道自动归属列为后续改进，不当作已实现能力。

## 6 复现

```bash
pnpm vitest run tests/four-features.spec.ts
# 关注 continuity 与 continuity.deep 两节
python3 experiments/four-features/live_baseline.py
```

机制基线的边界：真实 Runtime/Engine/Store，内存 DSH host，Router 与 worker 步骤脚本化；验证编排与持久化契约，不验证模型语义判断。真实双渠道/新端/真实重启的现场协议见 `README.md` 第 7 节。
