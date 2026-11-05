# SuperAgent 三层四阶段测试方案

**副题**：Harness 自改进 → Super-agent 四特征 → 端到端复合场景

**基准**：DeepSeek V4.1-flash（模型统一固定为 `deepseek-flash`）
**环境**：OCCAgent/dsh-superagent-prototype fork ｜ DSH 0.2.1-rc.3 ｜ 飞书已连通（DYJ 群 @OCCLab）｜ GitHub 已连通（@OCCAgent，repo OCCAgent/dsh-superagent-prototype）｜ 本机 dsh-superagent 服务

> **文档快照**：2026-11-05 19:15（UTC+8）· DSH 0.2.1-rc.3。2026-11-05 回写的内容见 0.3.1、0.3.2、0.3 的模型说明与文末「文档回写记录」；更早的时间线保留原样。

---

## 0 · 方案总览

### 0.1 三层递进逻辑

测试不按"功能列表"平铺，而是按论文的理论层次递进：先证明**模型侧的工装（harness）能自我改进**（Self-Harness 论文），再证明**系统侧的架构能承载四特征**（Exploring Super-agent Design 论文），最后用**复合场景证明整条链路在真实办公环境（飞书 × GitHub）里成立**（参考 LobeHub 产品化实践）。

| 层 | 依据论文 / 文章 | 验证对象 | 测试载体 | 触发通道 |
|---|---|---|---|---|
| 第一层 · Harness 自改进 | Self-Harness（上海AI实验室，arXiv:2606.09498） | 模型 + harness 的三步改进闭环 | 固定终端任务集（Terminal-Bench 风格） | 本地脚本（不经 Agent） |
| 第二层 · Super-agent 四特征 | Exploring Super-agent Design（DeepSeek Harness 团队）＋ 阿里云 AgentCore 解读 | Router/Worker 双层架构、Trigger 事件驱动、存算分离、Watchdog | **学习网站搭建**（拆成 6 个工作单元，由 SuperAgent 完成） | 飞书 @OCCLab ＋ GitHub @OCCAgent |
| 第三层 · 端到端复合场景 | 有新Newin《LobeHub 已做成产品》＋ Acceptance 验收流程 | 飞书入口 → Router 拆解 → Worker 执行 → PR 交回 → 群聊汇报 → 人关键决策 | 学习网站整合发布综合任务 | 飞书为主，GitHub 承载代码与 PR |

### 0.2 四阶段门禁

每阶段有**硬性验收判据**，不通过则**不进入下一阶段**（失败先修复环境，再重跑本阶段）。

| 阶段 | 内容 | 对应测试层 | 不进下一阶段的判据 |
|---|---|---|---|
| 阶段 0 · 环境核对 | 服务、通道、模型、仓库四样全部就位 | — | 任一红灯 → 先修复 |
| 阶段 1 · Harness 基线 | 第一层自改进闭环跑通 | 第一层 | 无被采纳的 harness 改进 → 停 |
| 阶段 2 · 四特征验证 | 第二层：SuperAgent 搭建学习网站 | 第二层 | 任一特征场景不通过 → 停 |
| 阶段 3 · 复合场景 | 第三层端到端全链路 | 第三层 | 闭环断链或人介入点失控 → 停 |

### 0.3 环境基线（当前实配，测试全程以此为准）

| 项 | 当前值 | 说明 |
|---|---|---|
| 服务面板 | `http://127.0.0.1:3082/?token=gfpE_gRPjwz_kMa3RADHFxPBQAXyjGeDOi6JP7lbAus` | 重启后 token 会变，以日志第 3 行为准 |
| 服务脚本 | `cd "/Users/opencity/Documents/GitHub/DeepSeek Harness/dsh-superagent" && ./scripts/dsh-superagent status\|restart\|start\|stop` | 已注入 `NODE_OPTIONS=--dns-result-order=ipv4first` |
| 评估模型（Router 判定） | `deepseek-official/deepseek-flash`（rev8，observe/120s） | 决策者层；与执行模型统一为 flash（2026-11-05 回写） |
| 执行模型（Worker） | `deepseek-official/deepseek-flash`（rev8，maxWorkers=1） | **测试基准模型：flash** |
| 飞书 Source | bot OCCLab；DYJ 群 `oc_0cdc4d293df9a24813837b35c34111c4` 仅 @ + 私聊开 | 必须成员列表真 @（名字变蓝）才算 mention |
| GitHub Source | @OCCAgent；repo `OCCAgent/dsh-superagent-prototype`（observe 全关 = auto） | issue/PR 评论中 @OCCAgent 触发 |
| Worker 工作目录 | `~/.dsh/state/superagent/work/<ticket-id>/` | 每个工单独立目录，隔离执行 |
| 状态库 | `~/.dsh/state/superagent/orchestrator.sqlite`（只读） | trigger/decision/ticket/outbox 四表 = 证据链 |
| 论文拆解底稿 | `~/.dsh/state/superagent/work/explain-superagent-papers-e1e19d43fa3d/deliverables/Super-agent与Self-Harness-费曼拆解.md`（63.5KB） | 阶段 2 学习网站的内容素材之一 |

> **模型切换（2026-11-05 回写）**：保存新的 eval/executor 模型会热切换主会话的下一次请求（PR #12）；只有主会话内自选过模型时才不跟随。上轮"必须删主会话 `session.v4.jsonl.zstd`"的流程已废弃，仅在排查旧会话自选模型时作为最后手段（先备份）。方案仍全程固定 flash，不为测试切换模型。

#### 0.3.1 三层隔离 Profile（2026-11-05 创建）

| 层 | Profile | 面板端口 | stateDir |
|---|---|---|---|
| 第一层 · Harness 自改进 | `selfharness` | 3083 | `~/.dsh/state/selfharness` |
| 第二层 · Super-agent 四特征 | `superagent-test` | 3084 | `~/.dsh/state/superagent-test` |
| 第三层 · 飞书 + GitHub 复合场景 | `superagent-e2e` | 3085 | `~/.dsh/state/superagent-e2e` |

本机 DSH 0.2.1-rc.3 没有 `dsh profile create`；实际创建命令为 `dsh <name> --from-default-profile web --dump-config > /dev/null`，再执行 `dsh plugin --profile <name> add "link:<dsh-superagent 仓库>"`，最后在 profile 的 `cordis.patch.yml` 中写入独立的 `port` 与 `stateDir`。三个 profile 均未启动；飞书 Source 默认关闭，第三层接入时使用独立 bot，避免与日常 `superagent` profile（3082）竞争。日常 `superagent` profile 不受影响。

#### 0.3.2 各层模型与 e2e 飞书机器人（配置指引）

- **代码版本**：三个 profile 已改链到专用测试 checkout `/Users/opencity/src/dsh-superagent-test`（2026-11-05 从 `origin/main` 90fb8ba 建立，含 PR #21；PR #22 合并后在该 checkout 执行 `git fetch && git checkout --detach origin/main && pnpm install && pnpm build`）。日常 3082 仍用原 checkout，测试不影响它。
- **模型**：每个 profile 的 `cordis.patch.yml` 已写 `agent-default-model = deepseek-official/deepseek-flash`（reasoningEffort high）。Eval/Executor 的模型默认跟随它；改这一项，或启动后在面板的 Eval/Execution 模型字段覆盖。需要 Gemini 等 provider 时，先在该 profile 加 provider 配置与对应 API key。
- **e2e 飞书机器人**：在 open.feishu.cn 开发者后台创建企业自建应用 → 添加“机器人”能力 → 权限加消息收发、群信息/成员读取 → 事件订阅 `im.message.receive_v1`（长连接）→ 发布版本并由管理员审核；把新机器人拉进 e2e 测试群，移除日常 OCCLab。本机已建独立 wrapper `~/.local/bin/lark-bot-e2e`（配置目录 `~/.lark-cli-superagent-e2e`），拿到 App ID 后执行：
  ```sh
  ~/.local/bin/lark-bot-e2e config init --app-id <cli_…> --app-secret-stdin
  ~/.local/bin/lark-bot-e2e config strict-mode bot --global
  ~/.local/bin/lark-bot-e2e api GET /open-apis/bot/v3/info --as bot --format ndjson
  ```
  然后在 `superagent-e2e` 的 `cordis.patch.yml` 启用 `dsh-superagent-feishu`；启动 3085 后在 Source 设置里填 wrapper、测试群和 allowed 用户。e2e 测试群为 `oc_9d5195712a27b205b37e03dd19b1f488`；同一 bot 不能由两个 profile 同时消费，测试前需换成专用 bot 或临时停 3082。e2e bot 群聊读取需 `im:message`（或 `im:message:readonly`）加 `im:message.group_msg`（界面名“获取群组中所有消息”，群历史必需），再补 `im:chat:readonly`、`im:chat.members:read`；`im:message.history:readonly` 是旧版 scope，控制台可能不展示，不需要单独申请。缺少群聊读取会在 history/轮询报 `source message unavailable` 或权限错误。移除 OCCLab 需要 `im:chat` + `im:chat.members:write_only`，OCCLab 未申请，需在群设置手动移除。
- **GitHub**：e2e 建议用独立测试仓库/账号，避免测试 PR 污染 `OCCAgent/dsh-superagent-prototype`。

### 0.4 术语速查

| 术语 | 含义 |
|---|---|
| Trigger | 一条进入系统的外部事件（群消息、issue、PR 评论）；经两级过滤（程序规则 + 模型判定）后才算数 |
| Thread | 同一话题/同一串邮件/同一 PR 下的连续消息；Worker 订阅后直通，不再经 Router 重复判定 |
| Router（主 Session） | 只看路不搬砖：承接入口交互、做 accept/ignore/attach/stop 判定、分派 Worker；决策不等待，单轮 ≤5 秒 |
| Worker | 每个工单一个独立 Session + 独立目录，挂完整工具；不直接对外说话，向 Router 汇报 |
| Outbox | 先存储后发送的消息队列；每条发出的回复留痕 |
| held-in / held-out | Self-Harness 回归的两套题：同分布任务 / 未见过的新任务 |
| Watchdog | 主系统之外的独立控制回路，既查存活也查"任务有没有实质进展" |

---

## 1 · 理论依据：从论文与文章里拆出的测试设计来源

### 1.1 Self-Harness（B 论文）：三步闭环是阶段 1 的骨架

> **Self-Harness: Harnesses That Improve Themselves**，上海人工智能实验室，arXiv:2606.09498，2026-06-08。

模型参数不动，让模型从自己的失败轨迹里改"工装"（提示、工具错误恢复、运行时限制、校验、编排）。阶段 1 直接按三步闭环设计：

1. **轨迹采集**：跑一组任务，记录失败轨迹（错在哪一步、报了什么错）；
2. **改进提案**：模型从轨迹里挖弱点，提出最小 harness 改动（不换模型、不换工具集）；
3. **回归采纳**：held-in（同分布）+ held-out（新任务）两套题对比，**只有"都不退步、至少一边进步"才采纳**。

### 1.2 Exploring Super-agent Design（A 论文）：四特征五模块是阶段 2 的骨架

> **Exploring Super-agent Design: Towards a More Autonomous Agent System**，DeepSeek Harness 团队，2026-11-01（X 长文 / threadnavigator 镜像，约 35 分钟）。

- **四特征**：连续（跨渠道同一件事）、产出/高效（并行不阻塞、可插话）、主动（环境事件触发、该安静就安静）、持久（常驻、异常自恢复）。
- **五模块**：双层架构（Router 轻量模型批处理、Worker 重工具）、事件驱动（两级过滤 → Thread 订阅直通 → 链式召回 → 投机执行）、面向人的交互、计算/状态/环境分离（BYOM：环境不搬、端侧 daemon 只执行）、Watchdog（外部控制回路，查存活 + 查推进）。

阶段 2 的每一个测试场景，都直接对应一个特征 + 一个模块的观测点。

### 1.3 阿里云 AgentCore 解读（微信文章 1）：给阶段 2 的观测指标补量化基准

> 《从长程 Agent 到 Super-agent，解锁更多场景》，阿里云 AgentCore，2026-11-02。链接：https://mp.weixin.qq.com/s/O6NdGGHP_rKAnH9PKrt6iQ

可复用的参考数字（**引用为论文侧基准，不是本方案的验收线**）：

- **Router 批处理**：消息 1→40 条/分钟时，平均每批 1.0→2.8 条，单次请求耗时 2.5→3.9 秒，分摊到每个决定 6.4→1.6 秒；
- **订阅直通价值**：去掉直通，Router 决定数 +30%，读缓存 token 2323 万→3177 万（+37%）；
- **单会话 vs 双层架构**（约 300 条消息混约 20 个工作请求 ×5 次）：单会话 p95 29.5 分钟（0 次委派）；双层架构 p50 12.4 分钟、p95 15.7 分钟。

**设计启示**：阶段 2 的"高效"特征验证，重点观测"多任务并行时是否互不阻塞 + 新消息能否插话"，而非追求压测数字。

### 1.4 LobeHub 产品化（微信文章 2）：给阶段 3 提供验收流程模板

> 《DeepSeek 刚提出的 Super-agent 新架构，LobeHub 已经做成了产品》，有新Newin，2026-11-02。链接：https://mp.weixin.qq.com/s/O5Wx5aylW6rHYtpp8hyvhg

LobeHub 的实践（半年用 LobeHub 开发 LobeHub）：主管 Agent 承接目标 → 拆成 Task（Linear 式保存要求/状态/评论）→ 编程工作交给 Codex/Claude Code 等外部执行工具 → 产出 PR → 用 **Acceptance**（Agent Loop 工具）收集证据、整理成报告 → 回 Discord 给负责人逐项验收 → 不通过则修订再交。

**设计启示**：阶段 3 直接采用"飞书群 = LobeHub 的 Discord、GitHub PR = 代码承载、验收报告 = 群里汇报 + PR 评论"，并且**把"人肉调度员"负担量化**：人在全流程中的介入点必须 ≤ 2 个，且每次介入都有群聊/PR 评论留痕。

---

## 2 · 阶段 0：环境核对（不做完不进阶段 1）

**目标**：服务、双通道、模型、fork 仓库四样全部确认就绪，且状态可查。

### 2.1 前置条件

- 本机 dsh-superagent 服务已启动（主会话绑定 deepseek 系模型）；
- DeepSeek 账户有可用余额（已充最低额度）；
- 飞书应用（OCCLab）已订阅 `im.message.receive_v1`，DYJ 群可真 @；
- GitHub 已登录（gh 认证有效），fork 仓库 `OCCAgent/dsh-superagent-prototype` 存在且可写。

### 2.2 逐步操作

1. **查服务健康**
   ```
   cd "/Users/opencity/Documents/GitHub/DeepSeek Harness/dsh-superagent" && ./scripts/dsh-superagent status
   ```
   预期：`ready`；若 `evals` 红灯（历史评估 error 残留属已知），确认主会话模型绑定后再继续。

2. **查主会话模型绑定（关键，勿跳过）**
   ```
   zstd -dc ~/.dsh/sessions/--Users-opencity-.dsh-state-superagent--/orchestrator-57dc1fd30815e2b701305665ede4d140/session.v4.jsonl.zstd | grep -c 'deepseek'
   ```
   预期：命中 `deepseek-official`（model/selection = deepseek-flash / reasoningEffort high）。若命中旧模型，先确认主会话没有在会话内自选模型；保存 eval 设置会热切换主会话（PR #12），仅在旧会话自选模型时才需要备份后重建。

3. **查状态库四表可读**
   ```
   python3 -c "import sqlite3; db=sqlite3.connect('file:/Users/opencity/.dsh/state/superagent/orchestrator.sqlite?mode=ro', uri=True); print([r[0] for r in db.execute('select name from sqlite_master where type=\'table\'')])"
   ```
   预期：含 `trigger / disposition / thread / ticket / decision / outbox`。

4. **验证飞书通道**：DYJ 群发一条真 @（成员列表点选，名字变蓝）：`@OCCLab 阶段0通道测试，请回复"在的"。` 预期 1 分钟内收到受理/回复。

5. **验证 GitHub 通道**：在 fork 仓库开一条 issue（或对已开 issue 发评论），提及 `@OCCAgent`，内容写"阶段0通道测试"。预期产生 trigger 记录（可查 trigger 表）。

6. **确认学习网站落位**：学习网站代码将放入 fork 仓库新目录 `learning-site/`（与 dsh-superagent-prototype 同仓，PR 形式交回），阶段 0 先建空目录占位（或由阶段 2 WU-1 创建）。

### 2.3 验收判据（全绿才进阶段 1）

| # | 判据 | 状态 |
|---|---|---|
| E0-1 | 服务 health 全部 ready（除已知 evals 历史 error 外） | ☐ |
| E0-2 | 主会话绑定 deepseek（grep 命中，无 google） | ☐ |
| E0-3 | 状态库四表可读 | ☐ |
| E0-4 | 飞书真 @ 有回复（群内可见） | ☐ |
| E0-5 | GitHub @OCCAgent 产生 trigger（trigger 表可查） | ☐ |
| E0-6 | `learning-site/` 目录已在 fork 仓库就位 | ☐ |

---

## 3 · 阶段 1：第一层 Harness 基线（Self-Harness 自改进）

**目标**：证明在**固定模型（deepseek-flash）+ 固定工具环境**下，harness 能走通"轨迹 → 弱点 → 提案 → 回归采纳"的自我改进闭环。本阶段**不经 Agent**，用本地脚本直接驱动 DeepSeek API + harness 配置，为阶段 2/3 立基线。

### 3.1 前置条件

- 阶段 0 全绿；
- 已准备 3 组终端任务（每组 ≥5 个任务）：
  - **H 组（held-in）**：与轨迹同分布的任务，用于回归；
  - **O 组（held-out）**：结构不同、未参与轨迹的新任务，验证泛化；
  - **T 组（轨迹采集）**：初始任务集，用于产出失败轨迹。
- DeepSeek API key 可用（`~/.dsh/.credentials.yaml` 第 3 行），端点 `https://api.deepseek.com/chat/completions`（OpenAI 兼容，实测 200@1.7s）。

### 3.2 逐步操作

1. **T 组轨迹采集**：用 flash 跑 T 组全部任务，逐任务记录：目标、动作序列、错误（工具报错/超时/断言失败）、最终结果。产物：`t1_traces.jsonl`。
2. **弱点提取**：把 T 组失败轨迹喂给 flash，要求输出"可复用的弱点清单"（每条含：现象、根因倾向、对应 harness 改动候选）。产物：`t2_weaknesses.md`。
3. **改进提案**：从弱点清单挑 **1 个最可操作的弱点**，让 flash 给出最小 harness 改动（改提示词 / 加工具错误恢复提示 / 加运行时限制，三选一，不换模型不换工具集）。产物：`t3_proposal.md`（含改动前后 diff）。
4. **回归采纳**：
   - 改动前：H 组 + O 组各跑一遍，记录通过率/耗时/错误数 → 基线；
   - 改动后：H 组 + O 组再各跑一遍 → 对比；
   - 采纳规则：**H 不退步 且 O 不退步 且（H 或 O 至少一项进步）**，才把改动写进 harness 配置（如 `prompts/work.md` 或 executor 配置）。
5. **留档**：三份产物 + 对比表存到 `learning-site/docs/test-logs/` 或独立 `t1-harness-baseline/` 目录，作为阶段 2 学习网站的"测试日志"素材。

### 3.3 验收判据（通过才进阶段 2）

| # | 判据 | 状态 |
|---|---|---|
| E1-1 | T 组失败轨迹 ≥3 条真实失败（有实际报错文本，非空） | ☐ |
| E1-2 | 产出弱点清单 ≥3 条，且每条可映射到具体轨迹 | ☐ |
| E1-3 | 产出 1 份最小改动提案（含 diff，能说清改了什么、为什么） | ☐ |
| E1-4 | 回归完成：H/O 前后各跑完，对比表有数字 | ☐ |
| E1-5 | **至少 1 个改动被采纳**（满足"都不退步 + 至少一边进步"） | ☐ |
| E1-6 | 若无一采纳，产出"为何不采纳"的分析（弱点不成立/改动无效/数据不足），**视为本阶段通过但记零采纳**，注明原因 | ☐ |

> 说明：E1-6 是"诚实报告"原则的体现——自改进测试的合法结果包含"本轮没有有效改进"，只要过程完整、证据充分即可进阶段 2；**伪造采纳率是本方案的红线**。

---

## 4 · 阶段 2：第二层 Super-agent 四特征验证（学习网站由 SuperAgent 搭建）

**目标**：用真实任务（搭建学习网站）验证四特征，同时产出阶段 3 的复合场景底座。**本阶段所有工作单元由 OCCLab 完成**——飞书/GitHub 触发，Router 分派，Worker 在隔离目录执行，PR 交回。

### 4.1 前置条件

- 阶段 1 全绿；
- 学习网站规格已冻结（见 4.2）；
- 飞书 + GitHub 双通道在阶段 0 已验证。

### 4.2 学习网站规格（冻结版，阶段 3 不再改动结构）

**项目名**：`learning-site`（放 fork 仓库 `OCCAgent/dsh-superagent-prototype/learning-site/`）
**形态**：静态 HTML（单文件自包含，内联 CSS/JS，可直接 file:// 打开；不放外部依赖）
**导航**：首页 ｜ 概念（A 论文）｜ 进化（B 论文）｜ 费曼拆解 ｜ 测试日志

**工作单元拆分（每个单元 = 一个可被触发的 PR 级任务）**：

| 单元 | 内容 | 触发方式 | 交回形式 |
|---|---|---|---|
| WU-1 站点骨架 | 建 `learning-site/` 目录；首页/概念/进化/拆解/日志五个 HTML 文件骨架 + 统一导航（Ben 风格 token：#B8734A/#D4A017/#3A2A1A） | 飞书 @OCCLab 或 GitHub issue | PR |
| WU-2 首页 | 一句话定义 Super-agent；三层测试导航卡片；项目背景（fork/DSH/双通道） | 同上 | PR |
| WU-3 概念页（A 论文） | 四特征（连续/产出/主动/持久）+ 五模块（双层架构/事件驱动/面向人交互/存算分离/Watchdog），每个特征给一句人话解释 | 同上 | PR |
| WU-4 进化页（B 论文） | Self-Harness 三步闭环图解 + held-in/held-out 回归规则 | 同上 | PR |
| WU-5 费曼拆解页 | 两篇论文 2×2 对比表 + 十个苏格拉底自测题（含答案，素材直接复用费曼拆解 md） | 同上 | PR |
| WU-6 测试日志页 + README | 阶段 1 实测数据（采纳/未采纳记录）+ 阶段 2 进度表 + README（如何本地打开/如何继续测试） | 同上 | PR |

**验收通用规则**：每单元 PR 需包含：① 文件存在且非空；② HTML 结构完整（title/viewport/内联样式）；③ 内容覆盖规格要点；④ 无死链、无占位"TODO"未说明；⑤ 经 `python3 <html-skill>/scripts/shot.py` 自检无 error/blocker（可要求 OCCLab 附报告摘要）。

### 4.3 四特征验证矩阵（每特征 2 个场景，全部通过才进阶段 3）

| 特征 | 场景 | 触发 | 观测点 | 通过标准 |
|---|---|---|---|---|
| **连续** | C1：WU-1 用飞书发起，WU-1 的 PR 评论里追问（改配色），再在私聊里跟进同一件事 | 飞书 @ + GitHub PR 评论 + 私聊 | Worker/Thread 是否识别"同一件事"（不要求重述背景） | 追问不重述背景即接上；三个渠道的上下文连贯 |
| 连续 | C2：阶段 2 中途插入一条无关话题（群聊闲聊），再回到正题 | 飞书真 @ 同一 Worker 订阅的 Thread | 无关消息不干扰当前 WU（符合"主动"的安静原则） | 闲聊无回复/不打断，正题消息照常处理 |
| **产出（高效）** | P1：连续派发 WU-2、WU-3 两个单元（不等 WU-2 完成就发 WU-3） | 飞书两条 @，间隔 <1 分钟 | maxWorkers=1 时排队；两个 Worker 独立目录互不污染 | 两任务各自产出独立 PR；无上下文串扰 |
| 产出 | P2：WU-4 执行中插入新要求（"页面加一节'术语表'"） | WU-4 进行中发飞书 @ | 新消息进入该 Thread 直通/插话 | 原任务按新要求完成，不重启不丢进度 |
| **主动** | A1：对已合并的 WU-2 首页 PR 评论指出一个错别字并 @OCCAgent | GitHub PR 评论 | GitHub Source 产生 trigger → 判定 → 是否建票修复 | 产生新工单或当场修复，群里有汇报 |
| 主动 | A2：在 DYJ 群发一条与项目无关的消息（不 @） | 普通群消息 | 两级过滤第一级（程序规则） | 不产生 decision/工单；trigger 可入库（Source 记录消息，gate 不接单） |
| **持久** | D1：WU-5 执行期间**不操作** 15 分钟以上，观察是否持续完成并交回 | 时间观测 | Worker 在隔离目录推进，不依赖前台交互 | 任务照常完成、PR 照常开出 |
| 持久 | D2：阶段 2 中途执行一次 `./scripts/dsh-superagent restart` | 重启服务 | 未完成工单是否自动恢复（带"恢复说明"） | 工单恢复继续，或如实报告"被打断"且不丢已落盘产物 |

> **连续场景判据修订（2026-11-03 实时剧本决断，已冻结）**：
> - **判据 4（连续）正式采用「同 Thread 追加直通」**：同 Thread 追加消息直通给订阅 Worker、不碎片化建单（阶段 2 实测 F5 背书，证据充分）。
> - **C4 候选场景「跨群无引用追加」按架构不成立，暂缓**：feishu Source 的 Thread 归属机制 = chat allowlist + trigger→thread 映射，跨群且无引用（无 @、无业务键、无父消息）的消息无法归属到已有 Thread。该场景在现架构下不可验收，从实时剧本移除，不留必然失败的假判据。
> - **跨渠道归属（语义匹配 / 业务键）登记为 harness 改进候选**：作为剧本 B（Self-Harness 闭环）弱点清单的可选第四条，属"后补机制"，不阻塞主剧本开跑。

### 4.4 阶段 2 执行顺序建议

1. 飞书 @OCCLab 发 WU-1（站点骨架）→ 验收 PR → 合并；
2. 依次派发 WU-2/WU-3（触发 P1 并行验证）；WU-4 进行中插话（触发 P2）；
3. 合并 WU-2 后 PR 评论 @OCCAgent 改错字（触发 A1）；群聊发无关消息（触发 A2）；
4. WU-5/WU-6 期间做 D1/D2 观测；
5. 全部 6 个 WU 合并后，跑四特征矩阵总验收。

### 4.5 验收判据（全绿才进阶段 3）

| # | 判据 | 状态 |
|---|---|---|
| E2-1 | 6 个 WU 全部产生 PR 并人工合并，学习网站 file:// 可打开 | ☐ |
| E2-2 | 四特征矩阵 8 个场景全部通过（C1/C2/P1/P2/A1/A2/D1/D2） | ☐ |
| E2-3 | 每个 WU 的验收记录（群聊汇报/PR 评论）留痕于四表 | ☐ |
| E2-4 | 无伪造验收；任一场景不通过则记录失败原因并修复后重跑 | ☐ |

---

## 5 · 阶段 3：第三层端到端复合场景

**目标**：一次"人只介入 2 个关键决策点"的完整业务闭环：飞书入口 → Router 拆解 Task → Worker 用 deepseek harness 执行 → GitHub PR 承载 → 群聊汇报 → 人验收 → 修订 → 合并。

### 5.1 前置条件

- 阶段 2 全绿（学习网站 6 个 WU 已合并）；
- GitHub 对 fork 仓库的 PR 权限正常（可开 PR、可合并）。

### 5.2 复合场景剧本（主剧本，约 30–60 分钟）

**任务**：`把学习网站整合为可发布的正式版：统一 Ben 风格配色、把阶段1实测数据补进测试日志页、检查全部页面无死链、开一个汇总 PR，并在群里给我一份验收报告（含截图证据的说明），报告里请给出"是否需要正式发布"的建议。`

1. **飞书发起**：DYJ 群真 @OCCLab 下发任务（含上述完整要求）。
2. **Router 拆解**：预期 OCCLab 受理（"On it"）→ decision accept → 建工单 → 自行拆成子任务（可以多 WU/多 worker，或单 worker 顺序执行）。
3. **执行**：Worker 在隔离目录修改 `learning-site/`，跑自检，产出汇总 PR。
4. **汇报**：Worker 向 Router 汇报 → 群里给出验收报告（改了什么、实测数据、自检结果、发布建议）。
5. **人介入点 #1（关键决策）**：你在群里对报告做取舍——例如"配色统一 OK，但首页标语换一句"或"不建议发布，先本地验收"。**这是剧本里唯一允许的实质性修改指令。**
6. **修订交回**：Worker 按你的指令修订，更新 PR。
7. **人介入点 #2（验收）**：你审 PR，说"行"→ 合并（或要求再改一轮）。
8. **闭环留痕**：确认 outbox 两条（acknowledgement + reply）均 sent、工单 completed。

### 5.3 备选剧本（可选，验证"主动 + GitHub 承载"）

- 阶段 3 主剧本合并后，在汇总 PR 上 @OCCAgent 评论一条新需求（"给测试日志页加一张阶段2进度表"）→ 验证 GitHub 触发的完整闭环（issue→trigger→ticket→worker→PR→汇报）。

### 5.4 案例分析：Self-Harness 闭环改进（备选剧本 B，验证"自改进"）

**背景与动机**：阶段 2 实测发现三个行为边界问题（素材已入库 `learning-site/SuperAgent阶段2-实测发现与学习素材.md`）：

- **F1**：判定为"重复/无新工作"（dropped）的消息无群内回执，用户误以为被无视；
- **F2**：PR 合并会终止当前 worker assignment，连续派发时后一单元可能被丢弃（阶段 2 靠 worker 自主补齐才未造成缺失）；
- **F3（2026-11-05 已回写）**：飞书 Source 无 mention 过滤，不 @ 消息也入库 trigger；这是 Source 的观察行为，A2 判据已改为「不产生 decision/工单」，不再是「trigger 表无记录」；
- **F6（候选，2026-11-03 登记）**：跨群且无引用的消息无法归属已有 Thread（feishu Source 归属 = chat allowlist + trigger→thread 映射），跨渠道归属需补语义匹配 / 业务键机制（判据 4 已按「同 Thread 追加直通」降级落地，归属改进列为可选提案）。

这些发现（F1/F2/F3 为必提三条，F6 为候选）是 Self-Harness（B 论文）"轨迹采集 → 弱点提案 → 回归采纳"闭环的真实输入。本剧本让 SuperAgent 按 B 论文方法**自我改进**：证明它能"发现问题 → 提改进 → 自改 → 回归验证"。

**闭环映射**：

| 步骤 | 内容 | 输入 |
|---|---|---|
| 轨迹采集 | 阶段 2 全量运行轨迹（trigger/ticket/outbox/PR/worker report） | 状态库 + 仓库素材文档 |
| 弱点提案 | F1/F2/F3 三条（现象 → 根因 → 规则改动建议 → 验证方式） | 已有（素材文档） |
| 回归采纳 | held-in：重跑阶段 2 四特征场景确认不破坏；held-out：重放 F1/F2 原始场景确认修复 | 阶段 2 场景 + 本次重放 |

**剧本（约 40–60 分钟，人介入 1 次）**：

1. **飞书发起**（真 @OCCLab）：
   > `基于仓库 learning-site/SuperAgent阶段2-实测发现与学习素材.md 的 F1/F2/F3，按 Self-Harness 三步闭环自我改进：先读阶段2轨迹与发现，生成弱点提案，在 fork 仓库中修改 Worker 行为规则（prompts/skills）以修复 F1/F2/F3，用 held-in（重放阶段2四特征场景）与 held-out（重放 F1/F2 原始场景）回归验证，开汇总 PR 并在群里给改进报告。`
2. **执行**：Worker 读仓库素材 → 输出提案 → 改规则 → 回归（held-in/held-out）→ 开 PR。
3. **人介入点（唯一一次）**：你审 PR，决定合并或要求修订。
4. **闭环留痕**：确认 outbox（acknowledgement + reply）sent、工单 completed。

**案例验收判据**：

| # | 判据 | 状态 |
|---|---|---|
| E3-A1 | 弱点提案 ≥3 条且对应 F1/F2/F3（现象→根因→改动→验证方式完整） | ☐ |
| E3-A2 | 至少 2 条提案实际落地（规则/配置变更出现在 PR diff） | ☐ |
| E3-A3 | held-in 回归：阶段 2 四特征场景全部仍通过（不破坏既有行为） | ☐ |
| E3-A4 | held-out 重放：F1（补发重复任务 → 有可见回执）/ F2（连续派发 + PR 合并 → 不丢单）至少一条确认修复 | ☐ |
| E3-A5 | 群汇报含提案摘要与回归结果；工单 completed | ☐ |

### 5.5 验收判据（本阶段通过 = 全方案通过）

| # | 判据 | 状态 |
|---|---|---|
| E3-1 | 完整闭环：受理 → 拆解 → 执行 → PR → 群汇报 → 人介入 → 修订 → 合并 | ☐ |
| E3-2 | 人介入点 ≤ 2 个，且每次介入在群聊/PR 评论有留痕 | ☐ |
| E3-3 | 汇总 PR 合并后，学习网站可打开、Ben 风格统一、无死链 | ☐ |
| E3-4 | 群汇报含"是否发布"建议与依据（自检/截图证据说明） | ☐ |
| E3-5 | 工单 ended=completed；outbox 全部 sent | ☐ |
| E3-6 | 备选剧本（如执行）：GitHub 评论触发的第二闭环同样走通 | ☐ |
| E3-7 | 案例分析剧本（如执行）：E3-A1..A5 全部通过 | ☐ |

---

## 6 · 风险与回滚

| 风险 | 现象 | 处置 |
|---|---|---|
| 评估超时 | 消息收到后暂无结论；decision=unavailable/timeout | 评估超时会发一次回执；检查 `evals` 与主会话是否繁忙。超时现在从主会话认领候选卡时开始计时，排队不再消耗评估时限；不要为超时删主会话 |
| 服务重启后 token 失效 | API 401 | 新 token 取新日志第 3 行 `dsh web: http://127.0.0.1:3082/?token=...` |
| 飞书手打 @ 不被识别 | decision=ignore/no_mention | 必须成员列表真 @（名字变蓝）；私聊算 direct |
| 已关闭工单无法重开 | retry 返回 notRetryable | 群内发新消息产生新 trigger，不开旧票 |
| 编辑旧消息不触发 | 无新 trigger | Source 只监听新到达消息；重发新消息 |
| Worker 失败（hostRestarted/模型 429） | assignment ended/failed | 看 report 原因；模型类失败等退避后重发；不改设置不重建会话 |
| 阶段 2 场景不通过 | 特征矩阵红灯 | 记录失败证据 → 修对应配置/提示词 → 重跑该场景（不降级验收标准） |

**回滚原则**：所有改动以 PR 承载，合并前随时可 revert；配置类改动（settings/提示词）先记录旧值（settings-history 有版本），失败可回退；主会话文件删除前必须备份到 /tmp。

---

## 7 · 附录：命令速查

| 用途 | 命令 |
|---|---|
| 服务状态/重启 | `cd "/Users/opencity/Documents/GitHub/DeepSeek Harness/dsh-superagent" && ./scripts/dsh-superagent status\|restart` |
| 面板 | 浏览器开 `http://127.0.0.1:3082/?token=<当前token>` |
| 最新工单 | `python3 /tmp/latest_ticket.py` |
| trigger 表 | `python3 /tmp/triggers.py` |
| 状态库只读 | `python3 -c "import sqlite3; db=sqlite3.connect('file:/Users/opencity/.dsh/state/superagent/orchestrator.sqlite?mode=ro', uri=True)"` |
| 主会话绑定检查 | `zstd -dc ~/.dsh/sessions/--Users-opencity-.dsh-state-superagent--/orchestrator-57dc1fd30815e2b701305665ede4d140/session.v4.jsonl.zstd \| grep -m1 deepseek` |
| DeepSeek 直连探测 | `curl -s https://api.deepseek.com/chat/completions -H "Authorization: Bearer $DS_KEY" -d '{...}'`（key 在 `~/.dsh/.credentials.yaml` 第 3 行） |
| HTML 自检 | `python3 "/Users/opencity/Library/Application Support/Doubao/Default/.doubao/agent_mode/workspace/.skills/html/scripts/shot.py" <html_path>` |
| fork 仓库克隆 | `git clone https://github.com/OCCAgent/dsh-superagent-prototype.git`（学习网站放 `learning-site/`） |

## 8 · 文档回写记录

- **2026-11-05 19:15（UTC+8）**：评估模型由 v4-pro 回写为 flash（rev8）；补充模型热切换（PR #12），废弃「删主会话」常规流程；A2 判据改为「不产生 decision/工单」；评估超时改为从主会话认领候选卡时计时并发送回执；新增三层隔离 Profile（0.3.1）与专用测试 checkout、模型/e2e 飞书机器人配置指引（0.3.2）。
- 更早的 2026-11-03 时间线与阶段 0 证据保留原样；阶段 0 报告顶部与 E0-2 节另有同日回写说明。

**信源**：本方案测试设计依据——Exploring Super-agent Design（DeepSeek Harness 团队，2026-11-01）、Self-Harness（上海AI实验室，arXiv:2606.09498）、阿里云 AgentCore《从长程 Agent 到 Super-agent，解锁更多场景》（mp.weixin.qq.com/s/O6NdGGHP_rKAnH9PKrt6iQ）、有新Newin《DeepSeek 刚提出的 Super-agent 新架构，LobeHub 已经做成了产品》（mp.weixin.qq.com/s/O5Wx5aylW6rHYtpp8hyvhg）；环境事实来自本机 dsh-superagent 状态库、settings 实配与上轮排障结论。
