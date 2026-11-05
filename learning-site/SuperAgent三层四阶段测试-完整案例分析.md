# SuperAgent 三层四阶段测试 · 完整案例分析

> **案例定位**：用「三层四阶段测试方案」驱动 SuperAgent（OCCLab）真实执行——从环境核对到自主搭建学习网站——全过程的详细复盘与机制解读。
> **日期**：2026-11-03 ｜ **环境**：macOS 本地 / DSH superagent 0.2.1-rc.3 / fork 仓库 OCCAgent/dsh-superagent-prototype / 模型 deepseek-flash
> **可复核性**：所有事件均附 trigger / decision / ticket / PR / worker report 证据；状态库 `~/.dsh/state/superagent/orchestrator.sqlite` 可复查。
> **截至时间点**：WU-1/2/3 合并（PR #3/#4/#5）、WU-4 已出 PR #6（open 待审）、WU-5/6 执行中。
>
> **2026-11-05 补记**：PR #12（2026-11-04 合并）后，评估模型变更可热切换运行中的主会话；执行模型仍只对新建 Session 生效。5.1 的“删主会话”流程是 2026-11-03 的历史记录。

---

## 一、案例摘要

| 项 | 内容 |
|---|---|
| 测试对象 | dsh-superagent（SuperAgent）：Router/Worker 双层架构 + 飞书/GitHub 双通道 |
| 测试方法 | 三层递进（Harness 自改进 → 四特征验证 → 端到端复合场景）× 四阶段门禁（0→1→2→3，不通过不进下一阶段） |
| 测试载体 | 学习网站 `learning-site/`（由 SuperAgent 自主搭建，6 个工作单元，各开 PR） |
| 关键结果 | 阶段 0 六项判据全绿；阶段 2 三个 WU 已合并、第四个已出 PR；实测发现 5 条行为边界（F1–F5） |
| 方法论产出 | ① 阶段 0 九条环境经验；② 阶段 2 五条实测发现；③ Self-Harness 闭环改进提案（已追加为方案 5.4 案例分析剧本） |
| 一句话结论 | SuperAgent 在真实办公链路（飞书 @ 触发 → Router 分派 → Worker 隔离执行 → PR 交回 → 群汇报）上可自主完成多单元搭建任务，并暴露若干值得用 Self-Harness 闭环改进的行为边界 |

---

## 二、案例背景与设计动机

### 2.1 为什么测

依据四份材料构建测试设计：

| 材料 | 角色 | 贡献 |
|---|---|---|
| Self-Harness（B 论文，arXiv:2606.09498） | 阶段 1 骨架 | 「轨迹采集→弱点提案→回归采纳」三步闭环 + held-in/held-out 防自欺规则 |
| Exploring Super-agent Design（A 论文） | 阶段 2 骨架 | 四特征（连续/产出/主动/持久）+ 五模块（双层架构/事件驱动/面向人的交互/存算分离/Watchdog） |
| 阿里云 AgentCore 解读（微信文章 1） | 观测指标基准 | Router 批处理 / 订阅直通 / 双层 vs 单会话的量化参照 |
| LobeHub 产品化（微信文章 2） | 阶段 3 模板 | 主管承接 → 拆 Task → 外部执行 → PR → 验收报告 → 人关键决策；人介入点 ≤ 2 |

### 2.2 设计要点

- **三层递进**：先证 harness 能自改进，再证架构能承载四特征，最后证整条链路在真实办公环境成立——不按功能列表平铺。
- **四阶段门禁**：阶段 0（环境核对）→ 1（Harness 基线）→ 2（四特征验证）→ 3（复合场景）；每阶段硬性验收判据，不通过不进入下一阶段。
- **关键设计决策**：
  - 学习网站与测试对象**同仓零改动**：`learning-site/` 放 fork 仓库，PR 形式交回；
  - 阶段 1 采用「无一采纳也计通过」+ 诚实报告红线（E1-6）：失败本身也是测试产出；
  - 阶段 2 用 **6 个 WU** 拆分建站，逐条下发、每 WU 独立 PR；
  - 四特征矩阵 8 场景（C1/C2/P1/P2/A1/A2/D1/D2），每条对应"特征 + 模块"观测点。

---

## 三、测试环境基线

| 项 | 实配值 |
|---|---|
| 服务面板 | `http://127.0.0.1:3082/?token=…`（重启必变，日志第 3 行提取） |
| 服务脚本 | `NODE_OPTIONS=--dns-result-order=ipv4first ./scripts/dsh-superagent status\|stop\|start` |
| 评估模型（Router 判定） | `deepseek-official/deepseek-flash`（rev8，observe/120s） |
| 执行模型（Worker） | `deepseek-official/deepseek-flash`（maxWorkers=1） |
| 飞书 Source | bot OCCLab；DYJ 群真 @ 触发 |
| GitHub Source | @OCCAgent；repo OCCAgent/dsh-superagent-prototype；observe 三流开启；allowed=[OCCAgent, duyujie2019] |
| Worker 工作目录 | `~/.dsh/state/superagent/work/<ticket-id>/`（隔离执行） |
| 状态库 | `orchestrator.sqlite`（9 表：kv/trigger/disposition/thread/ticket/decision/outbox/trigger_thread/effect） |

> ⚠️ 关键前提（上轮排障结论）：改 settings 模型**不热更新主会话**；换模型必须走「停→备份删 session.v4.jsonl.zstd→重启」。

---

## 四、执行全景（按时间线）

### 阶段 0：环境核对（全部收官）

| 时间 (UTC) | 事件 | 结果 |
|---|---|---|
| 09:50–09:52 | 飞书通道验证：真 @ → `ignore/said` → 回复「在的」（trigger `7a86f32f`） | ✅ E0-4 |
| 09:57 | @ 提问 → 工单 `ab27e4b5`（跨重启自动恢复） | ✅ |
| ~10:30 | **主会话模型切换**：deepseek-v4-pro → deepseek-flash（停→备份→删→重启→验证 `"model":"deepseek-flash"`） | ✅ E0-2 |
| 10:34–11:33 | **GitHub 通道打通**（含两个配置死锁修复，见五-2） | ✅ E0-5 |
| — | 服务 13/13 ready；状态库 9 表；learning-site 占位 push | ✅ E0-1/3/6 |

### 阶段 2：SuperAgent 搭建学习网站（进行中）

| 时间 (UTC) | 事件 | 证据 |
|---|---|---|
| ~12:46 前 | 用户发总纲 @OCCLab → trigger `53c836cc` → accept(explicitRouted) → 工单 `8f6f1d62f6dc` | ✅ |
| 11:56 | WU-1 骨架 → worker `51eab781` → **PR #3**（12:19:43 合并） | ✅ |
| 12:20–12:31 | WU-2 首页 → worker `e1e572a8` → **PR #4**（12:31:35 合并） | ✅ |
| 12:21 | WU-3 概念页（与 WU-2 间隔 43s，P1 并行）→ 投同一 worker | ⚠️ 边界案例（见五-3） |
| 12:32–12:35 | 用户连发 WU-4/5/6 + P2 插话（术语表）→ worker `516f294e` 全部 ack | ✅ 插话直通 |
| 12:45 | **PR #5（WU-3 概念页）自动补齐并合并**（merge 5534eb6） | ✅ 自主补偿 |
| 12:53 | 用户补发 WU-3 → worker `adc1230c` 判定 **dropped/Duplicate**（无群内回执） | ⚠️ F1 |
| 12:55 | 新 worker `f1e916b6` 接手 WU-4/5/6 | 🔄 |
| 13:00+ | **PR #6（WU-4 进化页+术语表）开出（open 待审）**；WU-5/6 执行中 | 🔄 |

---

## 五、关键事件深挖

### 5.1 主会话模型切换（阶段 0 核心操作）

**根因**：`src/app/role-models.ts` 的 `initializeRoleModel` 检测到已有 model/selection 即跳过——面板改了 settings，主会话不热更新，评估仍走旧模型（google/gemini 曾导致 429 RESOURCE_EXHAUSTED）。

**正确流程**（已沉淀为方案 0.3 警告）：
```bash
./scripts/dsh-superagent stop
cp "$HOME/.dsh/sessions/.../orchestrator-57dc1f.../session.v4.jsonl.zstd" /tmp/master_session_backup_flash/
rm "$HOME/.dsh/sessions/.../session.v4.jsonl.zstd"
./scripts/dsh-superagent start
# 验证：zstd -dc 新会话 | grep '"model":"deepseek-flash"'
```
**副作用**：面板 token 重启必变（新日志第 3 行取）；进行中工单跨重启自动恢复（不丢任务）。

### 5.2 GitHub 通道的三个深坑（阶段 0 关键发现）

| # | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | observe 全关 = 三个事件流整体跳过（Source 完全不轮询） | `src/sources/github.ts` 每个流带 `observed()` 门，false 时 `continue` | source:github rev1→2 开 observeIssues/Pulls/Comments |
| 2 | OCCAgent 自己发消息不触发 | 同账号防自触发（sameName → continue） | 测试必须用外部账号 |
| 3 | 外部账号 @ 也 not_a_member（死锁） | allowed 只有 [OCCAgent] | policy rev2→3 加入 duyujie2019 |

**验证**：duyujie2019 评论 @OCCAgent → trigger `f34f9202` → accept(explicitRouted) → 工单 `e40bc9679e10` completed → outbox acknowledgement 回复到 issue。修复前 `14e3ffb4` ignore/not_a_member 作对比证据。

### 5.3 WU-3 的"险情"：PR 合并终止 worker（P1 边界案例）

**过程**：WU-2、WU-3 间隔 43 秒连续派发 → 同一 worker `e1e572a8` 收到两个任务 → 先完成 WU-2 开 PR #4 → **用户合并 PR #4（12:31:35）→ assignment 随之 ended** → 尚未完成的 WU-3 随上下文丢失（不自动重投）。

**结果**：WU-3 后被处理 WU-4/5/6 的 worker `516f294e` **自主补齐**（PR #5，12:45 合并）——"幸运的自动补偿"，非机制保证。

**教训**（已写入经验库）：连续派发时以前一 WU 的 PR 合并为节点的丢单风险真实存在；完成判据以 PR 状态为准，不以群内回执或查询时刻直觉为准。

### 5.4 补发 WU-3 与「被无视」疑云（F1）

用户 12:53 补发 WU-3 → 入库（trigger `7ec255f0`）→ 新 worker `adc1230c` 检查 git 历史/PR 状态 → 发现 PR #5 已于 8 分钟前合并 → 判定 `dropped / Duplicate request` → **不重复开 PR**（遵守 one-PR-per-WU）→ 但**无群内回执**，用户观感"被无视"。

**真相**：不是被无视，是"核实后确认无需执行"；dropped 判定默认不产生可见回复（行为边界，见 F1）。

---

## 六、实测发现汇编（F1–F5）

| # | 发现 | 层次 | 性质 |
|---|---|---|---|
| F1 | 判定为「重复/无新工作」的消息无群内回执，用户误以为被无视 | 交互层 | 弱点（改进提案） |
| F2 | PR 合并终止当前 worker assignment，连续派发时后一单元可能被丢弃 | 编排层 | 弱点（改进提案） |
| F3 | 不 @ 消息也入库 trigger；两级过滤第一级实际在 disposition/Eval 层（A2 判据修正为"不产生新 decision、不建新工单"） | 判定层 | 判据修正 |
| F4 | Worker 能识别重复请求、拒绝无效工作（核实 git 历史 + PR 状态后 dropped，明确 pending 列表） | Worker 自主性 | ✅ 优点 |
| F5 | 同 Thread 后续消息「插话直通」，不碎片化建单（WU-1..6 全落同一总纲工单 `8f6f1d62f6dc`） | 编排层 | ✅ 优点 |

**方法论价值**：F1/F2/F3 是 **held-out 场景**撞出的边界——固定测试集（held-in）测不出来（脚本不会"补发已完成任务"，也不会恰好"在 PR 合并前派发后一单元"）。这正是 Self-Harness 要用"运行轨迹 + 弱点提案"而非固定回归集的原因。

---

## 七、问题与修正记录（元复盘）

| # | 我的操作 | 问题 | 修正 |
|---|---|---|---|
| 1 | 查询时刻 PR #5 未出现 → 判定「WU-3 遗漏」并建议补发 | **误报**（PR #5 实际 12:45 已合并，查询发生在合并前） | 以 `gh pr --state all` + assignments report 交叉验证；向用户澄清 |
| 2 | 用户补发 WU-3 无回执 → 一度需要向用户解释 | 实为 dropped 无回执的正常边界 | 解释机制 + 建议任务模板加"如判定无需新工作请回复原因" |
| 3 | 对"非 @ 消息是否有 trigger"的初判（A2） | 与实现不符（feishu Source admission:{} 拉全量） | 判据修正为"不产生新 decision、不建新工单" |

---

## 八、Self-Harness 闭环映射与改进提案（已入方案 5.4）

**闭环**：轨迹采集（阶段 2 全量 trigger/ticket/outbox/PR）→ 弱点提案（F1/F2/F3 具象为规则改动）→ 回归采纳（held-in 四特征场景 + held-out 重放）。

**三层落地建议**：

| 层次 | 动作 | 内容 |
|---|---|---|
| 短期（不改代码） | 改任务消息模板 | 总纲加"如判定无需新工作，请回复原因"；A2 判据文档修正 |
| 中期（改 harness） | fork 的 prompts/skills 写 Worker 行为规则 | dropped 必回执；PR 合并不立即结束 assignment；丢失单元自动重投 |
| 长期（阶段 3 候选子场景） | 方案 5.4 备选剧本 B | 让 SuperAgent 读阶段 2 报告 → 自提改进 → 自改规则 → 重放验证（E3-A1..A5 判据） |

---

## 九、方法论收获与使用姿势

### 9.1 触发姿势（正确 vs 错误）

| 场景 | 正确姿势 | 错误姿势 |
|---|---|---|
| 确认任务被接住 | 看 trigger 入库 + 等 ack/PR；dropped 无回执是正常的 | 只凭"群里有反应"判断 |
| 连续派发 | 逐条下发，以 PR 出现为准；长时间无 PR 再补发 | 假设所有单元在同一 worker 串行完成 |
| 补充背景/问进度 | 群聊不 @ 直接发（作 Thread 上下文） | 不 @ 却期待触发新任务 |
| 触发新任务 | 必须真 @（名字变蓝） | 手打文本 @（不算 mention） |
| 修改进行中任务 | 同 Thread @ 追加（插话直通） | 换话题/换渠道（上下文断裂） |
| 避免重复工作 | 任务里写明"已完成的不要重做" | 重复下发已完成单元（dropped 且无回执） |

### 9.2 双通道对照（dsh-superagent Feishu Source vs DSH 插件）

- 本案例用的是 **dsh-superagent 自身的 Feishu Source**（Source→不可变 Trigger→Thread→Eval→Ticket→Worker→Outbox 全链路，消息流走四表）；
- 不是 itr-del/dsh-feishu 插件（WebSocket 长连接、不经 Router/Ticket）；
- GitHub 同理：observe 三流轮询 + policy allowed + 防自触发，形成完整事件闭环。

---

## 十、结论与下一步

**结论**：三层四阶段方案在真实环境可执行；阶段 0 六项判据全绿，阶段 2 已证明 SuperAgent 能自主完成多 WU 搭建（3/6 合并、1/6 待审、2/6 执行中），且四特征场景实测产出 5 条行为边界——其中 3 条弱点已映射为 Self-Harness 闭环改进提案（方案 5.4），2 条优点沉淀为使用姿势。

**下一步**：
1. 用户合并 PR #6（WU-4 进化页）→ 继续盯 PR #7（WU-5 费曼拆解）/ PR #8（WU-6 测试日志）；
2. 6 个 WU 全合并 → 阶段 2 判据 E2-1 达成 → 四特征矩阵总验收；
3. 阶段 3 主剧本（5.2）→ 案例分析剧本 B（5.4）验证自改进；
4. 学习素材（本案例 + 阶段 0 报告 + 实测发现）已同步 learning-site 仓库，供学习网站内容复用。

---

## 附录 A · 关键 ID 速查

| 对象 | ID |
|---|---|
| 总纲工单 | `8f6f1d62f6dc` |
| 进行中工单（跨重启恢复） | `ab27e4b5b29c` |
| GitHub 通道验证工单 | `e40bc9679e10` |
| 阶段 2 PR | #3（WU-1）/ #4（WU-2）/ #5（WU-3）/ #6（WU-4） |
| 主要 trigger | 总纲 `53c836cc`；WU-2 `3ed872fa`；WU-3 `68df6638`；补发 `7ec255f0`；GitHub `f34f9202` |
| worker | `51eab781`（WU-1）→ `e1e572a8`（WU-2/3）→ `516f294e`（WU-4/5/6+PR#5）→ `adc1230c`（dropped）→ `f1e916b6`（WU-4/5/6 续） |
| 状态库 | `/Users/opencity/.dsh/state/superagent/orchestrator.sqlite`（只读） |
| 学习素材 | `learning-site/SuperAgent阶段2-实测发现与学习素材.md` |

## 附录 B · 复现命令（摘要）

```bash
# 服务状态
cd "/Users/opencity/Documents/GitHub/DeepSeek Harness/dsh-superagent" && NODE_OPTIONS=--dns-result-order=ipv4first ./scripts/dsh-superagent status

# PR 全景（完成判据第一信源）
gh api "repos/OCCAgent/dsh-superagent-prototype/pulls?state=all&per_page=20"

# 状态库（只读）
python3 -c "import sqlite3,json; db=sqlite3.connect('file:/Users/opencity/.dsh/state/superagent/orchestrator.sqlite?mode=ro',uri=True); [print(json.loads(r[0])['at'], json.loads(r[0])['text'][:60]) for r in db.execute('select value from trigger order by rowid desc limit 10')]"

# 主会话模型绑定
zstd -dc ~/.dsh/sessions/--Users-opencity-.dsh-state-superagent--/orchestrator-*/session.v4.jsonl.zstd | grep -o '"model":"[^"]*"' | sort | uniq -c
```
