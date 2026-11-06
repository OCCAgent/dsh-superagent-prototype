# 评估超时 · 真实飞书端到端联调记录

> **日期**：2026-11-06（UTC+8）｜**被测代码**：PR #22 分支 `393e67d`（`fix: count assessment timeouts from the claim and write back the test docs`，构建后含 `candidatePlanned` / `candidateClaimed` / 5 分钟排队上限 / 超时回执）｜**实例**：隔离 profile `superagent-e2e-timeout`（`127.0.0.1:3086`，stateDir `~/.dsh/state/superagent-e2e-timeout`）

## 1 目的与结论

PR #22 的遗留限制是「没有强制跑过真实飞书端到端超时（需要真实的数分钟等待）」。本记录补齐这项联调：用**真实飞书触发消息**、**真实 E2E 机器人**和**真实飞书回复通道**，在隔离实例里跑完一次评估超时，观察三件事：

1. 评估时限从主 Session **认领候选卡**时开始，而不是从送达时开始；
2. 没有 step 认领的候选卡，按**送达后的 5 分钟排队上限**到期；
3. 连续 3 次到期后，Eval 记为 `unavailable`（`timeout`），真实飞书会话收到**一条超时回执**。

**结论：三件事都在真实飞书链路和真实状态库中观测到**（时间线见 §4；回执见 §5）。

## 2 环境与故障注入

- **代码**：`/Users/opencity/src/dsh-superagent-pr22`，`HEAD = 393e67d270c11ab83a782ca728809398bec36d78`；`pnpm build` 通过，`lib/index.js` 含 `candidateClaimed` 与 `QUEUE_TIMEOUT_MS`。profile 的 `dsh-superagent` 软链到该 checkout。
- **实例**：新建 profile `superagent-e2e-timeout`（面板 `http://127.0.0.1:3086`），从 `superagent-e2e` 复制配置后改端口、stateDir、模型端点与测试用 bot wrapper；独立状态库，不影响 3085 上正在运行的 `superagent-e2e`。
- **设置**：Eval `mode=observe`、`timeoutSeconds=30`（策略最小值，便于在可控时间内看到超时）；飞书 Source 指向 E2E 机器人 `lark-bot-e2e` 与测试群 `oc_9d5195712a27b205b37e03dd19b1f488`，`listen=all`；allowed 与主实例相同（Tester `ou_b74d…`、OCC `ou_cb5a…`）。
- **真实 trigger**：`bb1acadeb3bdf9872513124ffecec912`，Tester 于 2026-11-05 20:22:28（UTC+8）在测试群发的「请帮我测试一下@E2E测试机器人」。该消息与线程是主实例状态库里的真实数据；通过管理 API `POST /orchestrator/api/triggers/bb1…/requeue` 把它重排进隔离实例（消息 id、线程 id、回复地址均未改写）。
- **故障注入**：该 profile 的 `llm-deepseek.baseURL` 指向本机 `127.0.0.1:9011` 的挂起端点（收到请求后永不响应，见 `e2e-evidence/hang.log`）。主 Session 的评估 step 因此无法完成模型调用，只能由真实的 deadline/expiry 机制结束 Eval；**没有改 dsh-superagent 源码或超时常量，也没有改写 timeout/claim 状态**——只把真实 trigger 行复制进隔离实例的状态库用于重排。这替代了「真实忙碌数分钟的主 Session」这一不可控条件，其余链路保持真实。
- **事件流隔离**：测试实例的飞书 Source 使用 test-only wrapper `lark-e2e-no-events`——只向 watch 循环上报 `[event] ready`，不订阅事件，避免与 3085 争同一个 bot 的事件流；**回执发送仍走真实的 `lark-bot-e2e`**。

## 3 复现命令（摘要）

```sh
# 1) 代码与构建
git -C /Users/opencity/src/dsh-superagent-pr22 checkout --detach 393e67d
pnpm -C /Users/opencity/src/dsh-superagent-pr22 build

# 2) 挂起端点（收到请求后不响应，监听 127.0.0.1:9011）
node -e "require('node:http').createServer((q, s) => q.resume()).listen(9011, '127.0.0.1')"

# 3) 启动隔离 profile（cordis.patch.yml 内 port=3086、stateDir=…-timeout、llm-deepseek.baseURL=http://127.0.0.1:9011/anthropic）
dsh --profile superagent-e2e-timeout --no-open

# 4) 用管理 API 配置（source:github/source:feishu/policy/eval=observe,30s），然后重排真实 trigger
curl -s -X POST -H 'x-orchestrator-request: 1' \
  http://127.0.0.1:3086/orchestrator/api/triggers/bb1acadeb3bdf9872513124ffecec912/requeue
```

> 主实例 3085 与日常 3082 均未重启、未改配置。测试结束后停止 3086 实例与挂起端点。

## 4 观测时间线（UTC，真实状态库）

| 时刻 | 事实 | 说明 |
| --- | --- | --- |
| 00:01:35.720 | 第 1 个 Eval：`claimed` | 主 Session 的一个 step 认领候选卡（`delivered=00:01:35.081`） |
| 00:02:05.720 | 第 1 个 Eval：`deadline` | **认领 + 30 s**，不是送达 + 30 s；00:01:36.370 的模型请求挂起，因此到期 |
| 00:02:06.826 | 第 2 个 Eval 启动（`expired=1`） | 第 1 次到期把 trigger 重新排队，重排上限 2 次 |
| 00:02:11.842 | 第 2 个 Eval：`delivered`、`claimed` 为空 | 主 Session 仍卡在上一步，候选卡留在收件箱，没有认领 |
| 00:07:11.842 | 第 2 个 Eval：`deadline` | **送达 + 5 分钟排队上限**，验证未认领分支 |
| 00:07:17.408 | 第 2 次到期（`expired=2`）→ 第 3 个 Eval：`delivered`、`claimed` 为空，`deadline=00:12:17.408` | 到期 tick 后重排；第 3 张卡仍留在收件箱，仍按送达 + 5 分钟 |
| 00:12:17.408 | 第 3 次到期（`expired=3`）→ `unavailable` + 回执 | 00:12:17.470Z 记录 Decision，见 §5 |

> 到期 tick 与记录的 deadline 有数秒偏差（例如第 2 个 Eval 的 `deadline=00:07:11.842`，实际重排在 00:07:17.408），`expired` 计数在同一个 `thread.evaluating` 上递增。

## 5 真实飞书超时回执

第 3 次到期后，Eval 记为 `unavailable`，outbox 生成并发送超时回执（均为隔离实例状态库的真实记录）：

- **Decision**：`4eb97f71ef8bf153d9a7f1edeb318519`，`kind=unavailable`，`reason=[{"code":"timeout"}]`，`at=2026-11-06T00:12:17.470Z`，`strength=explicit`；
- **Outbox**：`95d713d03b02847865cd9264011ceebc`，`kind=notice`，`status=sent`；
- **文本**：`评估超时，本次请求没有得出结论。可以稍后重发，或在面板中重新评估。`
- **目标**：该 trigger 的真实飞书消息 `om_x100b61f31e84d4a4dd1da5ccd22cad5`（会话 `oc_9d5195712a27b205b37e03dd19b1f488`），由 `lark-bot-e2e` 调用 `im +messages-reply` 发出（幂等键为 outbox id）。

`thread` 最后状态：`evaluating` 清空、`pending=[]`，回执已发送；3 次到期后按设计收口。

## 6 证据边界

- **真实**：飞书 trigger 消息与线程、E2E 机器人、飞书回复 API、Eval 状态机、deadline/expiry/重排、`unavailable` 决策与 outbox 回执发送。
- **注入**：主 Session 的模型端点被换成本机挂起端点，用来稳定制造「评估 step 无法完成」；真实环境中的等价条件是模型慢/主 Session 忙。
- **未覆盖**：没有重启或改动 3085 的 `superagent-e2e` 实例；trigger 是从真实状态库重排，不是新到达的事件；没有验证「真实数分钟自然忙碌」下的时序分布，只验证了机制在真实链路上成立。
