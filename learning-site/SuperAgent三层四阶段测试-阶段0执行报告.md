# SuperAgent 三层四阶段测试 · 阶段 0 执行报告

> 环境核对与通道验证（2026-11-03 · macOS / 本地 · DSH superagent 0.2.1-rc.3）
> 关联文档：《SuperAgent三层四阶段测试方案.md》
> 用途：作为学习网站「测试日志页 / 进化页」素材，保留全部真实证据（ID、时间戳、命令、判定）
>
> **2026-11-05 补记**：本报告是 2026-11-03 的历史快照。PR #12（2026-11-04 合并）后，评估模型的变更会热切换到运行中的主会话；执行模型仍只对新建 Session 生效。E0-2 的“停→备份→删→重启”仅作为当时的操作记录。

---

## 一、阶段 0 目标与判据

阶段 0 是三层测试的地基：验证环境、绑定基准模型、打通两条交互通道。判据共 6 项，全部通过才允许进入阶段 1（Harness 基线）。

| 判据 | 目标 | 最终结果 |
|---|---|---|
| E0-1 | 服务健康：所有子系统 ready（含 evals） | ✅ 13/13 ready |
| E0-2 | 主会话绑定基准模型 deepseek-flash | ✅ deepseek-flash（本次切换完成） |
| E0-3 | 状态库四表（trigger/decision/ticket/outbox）可读 | ✅ 齐全（共 9 表） |
| E0-4 | 飞书通道：真 @ 触发 → 回复 | ✅ trigger→ignore/said→回复"在的" |
| E0-5 | GitHub 通道：外部 @ 触发 → accept → 工单执行 | ✅ accept(explicitRouted)→工单 completed |
| E0-6 | 学习网站占位目录 learning-site/ 就位 | ✅ 已 push 至 fork 仓库 |

---

## 二、执行总览（按时间线）

| 时间 (UTC) | 事件 | 结果 |
|---|---|---|
| 09:50:33 | 飞书群真 @OCCLab 通道测试消息入库（trigger `7a86f32fdc429a`） | ✅ |
| 09:51:24 | Eval 判定 `ignore / said`（普通问答直接答） | ✅ |
| ~09:52 | OCCLab 在群里回复「在的」（outbox reply sent） | ✅ |
| 09:57:54 | 用户 @OCCLab 提问「删主会话持久化文件是否有意设计」→ 工单 `ab27e4b5` accept(explicitRouted) | ✅ 工单跨重启自动恢复 |
| 10:34:23 | 创建 GitHub 测试 issue #2（@OCCAgent，OCCAgent 账号） | 创建成功但**未触发**（见三-5） |
| 10:40:52 | 服务重启（主会话模型切换流程的一部分） | ✅ 13/13 ready |
| 10:44:47 | issue #2 评论 @OCCAgent（OCCAgent 账号） | 未触发（同账号防自触发） |
| 10:48:08 | 开启 GitHub observe 三流（source:github rev 1→2） | ✅ 轮询开始 |
| 11:16:02 | 用户评论「收到」（OCCAgent 账号） | 未触发（同账号） |
| 11:23:48 | 用户评论「收到」（**duyujie2019** 账号）→ trigger `14e3ffb4` | ✅ 入库 |
| 11:24:03 | Eval 判定 `ignore / not_a_member`（不在 allowed 名单） | ⚠️ 暴露配置死锁 |
| 11:27 | policy 更新：github.allowed 加入 duyujie2019（rev 2→3） | ✅ |
| 11:28:54 | 用户再评论 @OCCAgent（duyujie2019）→ trigger `f34f9202` | ✅ |
| 11:30:28 | Eval 判定 `accept / explicitRouted` | ✅ |
| 11:33:02 | 工单 `e40bc9679e10` completed，确认已回复到 issue | ✅ |

---

## 三、逐项执行记录

### E0-1 服务健康 —— ✅

**命令**：`./scripts/dsh-superagent status`

**证据**（关键节选）：
```json
{ "pids": [61618], "url": "http://127.0.0.1:3082", "errors": {},
  "health": { "runtime":"ready","relay":"ready","notice":"ready","launch":"ready",
    "delivery":"ready","assessment":"ready","reply":"ready","evals":"ready",
    "models":"ready","github":"ready","feishu":"ready","history":"ready","sync:feishu":"ready" } }
```
（首次核验 12/13，`history` 短暂 `starting`；重启后最终 13/13 全 ready）

**要点**：evals 绿灯是阶段 0 通过的关键；`errors: {}` 表示无健康错误。

### E0-2 主会话绑定基准模型 —— ✅（deepseek-v4-pro → deepseek-flash）

**背景根因（前一轮排障已确认）**：改 `settings` 的 eval/executor 模型**不会热更新**已持久化的主会话。源码 `src/app/role-models.ts` 的 `initializeRoleModel` 检测到已有 model/selection 即跳过。因此主会话切换必须走「重建」路径。

**执行序列**：
```bash
# 1. 确认 settings 已配 flash（面板此前已切 eval rev8=deepseek-flash）
curl -s http://127.0.0.1:3082/orchestrator/api/settings -H "x-orchestrator-request: 1"

# 2. 备份主会话（安全网）
cp "$HOME/.dsh/sessions/--Users-opencity-.dsh-state-superagent--/orchestrator-57dc1fd30815e2b701305665ede4d140/session.v4.jsonl.zstd" \
   /tmp/master_session_backup_flash/

# 3. 停服务 → 删持久化主会话 → 启动
./scripts/dsh-superagent stop
rm "$HOME/.dsh/sessions/.../session.v4.jsonl.zstd"
./scripts/dsh-superagent start
```

**验证证据**（新主会话文件 687B）：
```
$ zstd -dc session.v4.jsonl.zstd | grep -o '"model":"[^"]*"' | uniq -c
1 "model":"deepseek-flash"
```

**副作用管理**：
- 面板 token 每次重启必变。新 token 从最新日志第 3 行提取：
  `grep -m1 "dsh web:" .artifacts/dsh-superagent-superagent-*.log`
- 进行中的工单（`ab27e4b5`）**跨重启自动恢复**继续 running，不丢任务。

### E0-3 状态库 —— ✅

**命令**：只读打开 `~/.dsh/state/superagent/orchestrator.sqlite`（`file:...?mode=ro`）

**表清单**（9 张，覆盖测试方案要求的前四张）：
`kv / trigger / disposition / thread / ticket / decision / outbox / trigger_thread / effect`

### E0-4 飞书通道 —— ✅

**链路**（与测试方案 2.2 预期一致）：
```
用户群内真 @（名字变蓝）→ Source 轮询（pollSeconds=60）
→ 不可变 Trigger 入库 → Eval 判定 →（非工单类）直接回复
```

**证据**：
```json
// trigger 7a86f32fdc429a @ 2026-11-03T09:50:33.698Z
{ "text": "@OCCLab 阶段0通道测试，请回复“在的”",
  "channel": { "source": "feishu", "thread": "feishu:oc_0cdc4d293df9a24813837b35c34111c4" } }

// decision @ 09:51:24.297Z
{ "kind": "ignore", "reason": [{"code":"said","values":{"text":"阶段0通道测试，属普通讨论/直接问答，无需创建工单。"}}] }

// outbox reply @ ~09:52（sent）
{ "kind": "reply", "status": "sent", "text": "在的" }
```

**要点**：普通问答（`said`）直接回复不建工单——这是 Eval 的两级过滤设计（先程序规则后模型）。

### E0-5 GitHub 通道 —— ✅（过程暴露 2 个配置问题并修复）

**最终验证链路**：
```
外部账号 duyujie2019 评论 @OCCAgent（60s 轮询）
→ Trigger f34f92021671 @ 11:28:54
→ Eval accept (explicitRouted) @ 11:30:28
→ 工单 e40bc9679e10「阶段0通道测试：回复确认消息已通过白名单送达」
→ Worker（flash）执行 → completed @ 11:33:02
→ outbox acknowledgement sent：「阶段0通道测试确认：消息已通过白名单正常送达，回复通道可用。」
```

**排查中发现的两个关键配置问题（学习网站「进化页」素材）**：

1. **observe 全关 = Source 不接收任何事件**（此前「observe 全关=auto」的认知是错的）
   - 源码 `src/sources/github.ts`：三个事件流（issues/comments/review-comments）各自带 `observed()` 门；`!stream.observed(config)` 时**整体跳过**（`continue`），连轮询都不会发生。
   - `STREAMS = [ issues(observed: observeIssues||observePulls), comments(observeComments), review-comments(observeComments) ]`
   - 修复：PUT `source:github` rev 1→2，`observeIssues/Pulls/Comments = true`。

2. **allowed 名单与防自触发形成死锁**
   - GitHub Source 忽略**同账号**消息（`sameName(item.user.login, login)` → continue，防自触发循环）。
   - policy `sources.github.allowed` 原本只有 `[OCCAgent]`——OCCAgent 自发的被忽略，外部账号又 `not_a_member`，**永远无法产生有效工单**。
   - 修复：PUT policy rev 2→3，`allowed` 加入 `duyujie2019`。
   - 证据对比：11:23 评论（修复前）→ `ignore/not_a_member`；11:28 评论（修复后）→ `accept/explicitRouted`。

**另一次跳过（学习点）**：10:34 创建的 issue #2 未触发——GitHub Source 重启后游标从**启动时刻**开始消费（`since = max(stored.since, round.started)`），重启前创建的事件不重放；修复方式是发一条「重启后」的新事件。

### E0-6 学习网站占位 —— ✅

```bash
git clone --depth 1 https://github.com/OCCAgent/dsh-superagent-prototype.git
mkdir learning-site && touch learning-site/.gitkeep
git add / commit / push   # 6337fc8..1e6d54f HEAD -> main
```

---

## 四、关键发现与经验（按重要度）

| # | 发现 | 影响 | 规避 |
|---|---|---|---|
| 1 | GitHub observe 全关 = 三个事件流全部不轮询 | 通道静默失效，看似配置好实则死 | 开 observe 流；用 `/orchestrator/api/state` 看 health |
| 2 | 同账号消息被防自触发忽略 | OCCAgent 自己发任何 issue/评论都不触发 | 测试必须用外部账号 |
| 3 | allowed 名单过滤 explicit 请求 | 外部账号 @ 也会 `not_a_member` | allowed 要包含实际使用账号 |
| 4 | settings 改模型不热更新主会话 | 面板改了模型，评估仍走旧模型 | 必须重建主会话（停→备份→删→启） |
| 5 | 重建主会话不丢进行中工单 | 重启风险被框架消化（自动恢复） | 可放心重建，无需等任务完成 |
| 6 | GitHub 游标重启后从启动时刻起 | 重启前创建的事件不重放 | 验证时发新事件 |
| 7 | 管理 API 路径是 `/orchestrator/api/...`（不是 `/api/...`） | 路径错误返回 401 误导排查 | 认证只看 host + `x-orchestrator-request: 1`，token 仅面板用 |
| 8 | 面板 token 每次重启变化 | 旧 token 全部失效 | 从最新日志第 3 行提取 |
| 9 | 飞书普通问答走 `ignore/said` 直接回复 | 群聊问答不建票是设计，不是故障 | 判断通道健康看「回复到达」而非「工单创建」 |

---

## 五、命令速查（阶段 0 全量）

```bash
# 服务管理（工作目录：DeepSeek Harness/dsh-superagent）
NODE_OPTIONS=--dns-result-order=ipv4first ./scripts/dsh-superagent status|stop|start

# 管理 API（认证 = host + x-orchestrator-request 头）
curl -s http://127.0.0.1:3082/orchestrator/api/state -H "x-orchestrator-request: 1"
curl -s http://127.0.0.1:3082/orchestrator/api/settings -H "x-orchestrator-request: 1"

# PUT 配置（带 revision 乐观锁）
curl -s -X PUT http://127.0.0.1:3082/orchestrator/api/settings/source:github \
  -H "x-orchestrator-request: 1" -H "Content-Type: application/json" \
  -d '{"value":{...},"revision":1}'

# 状态库只读查询（9 表）
python3 -c "import sqlite3; db=sqlite3.connect('file:/Users/opencity/.dsh/state/superagent/orchestrator.sqlite?mode=ro', uri=True); print(db.execute('select name from sqlite_master where type=\"table\"').fetchall())"

# 主会话绑定检查
zstd -dc ~/.dsh/sessions/--Users-opencity-.dsh-state-superagent--/orchestrator-*/session.v4.jsonl.zstd | grep -o '"model":"[^"]*"' | sort | uniq -c

# 面板 token
grep -m1 "dsh web:" .artifacts/dsh-superagent-superagent-*.log

# GitHub（gh 已登录 OCCAgent）
gh api repos/OCCAgent/dsh-superagent-prototype/issues/2/comments --jq '.[]|{user:.user.login,created_at,body}'
```

---

## 六、遗留与下一步

- **阶段 1（Harness 基线）**：前置条件已全部满足，题目集（T 组轨迹 / H 组 held-in / O 组 held-out）待定稿，可参考测试方案第 3 章结构。
- 学习网站制作时：本报告的「关键发现」进进化页（WU-4），「执行记录」进测试日志页（WU-6），trigger/decision 语义可复用于概念页 A（WU-3）。
- 飞书侧无需配置变更；GitHub 侧两个修复已持久化（rev 2/3），重启后保留。
