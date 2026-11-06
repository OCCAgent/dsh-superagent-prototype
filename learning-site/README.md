# Super-agent 学习站（learning-site）

阶段 2 的静态学习站：8 个页面加本 README 与持续问题日志，按「概念 → 进化 → 费曼拆解 → 学习阶梯 → 测试日志 → 原型 → 实验全记录」的路线阅读两篇论文、实现与完整测试过程。

> 在线预览：<https://occagent.github.io/dsh-superagent-prototype/learning-site/>（合并后自动更新）

**当前进度：WU-1 ~ WU-11 全部完成。** 八个页面、问题日志、站内导航、视觉 token、自检脚本与本地打开说明均已就位；第二层四特征逐项验证、实时双群连续性验证、持续问题日志、完整实验过程与学习阶梯均已上线。2026-11-05 增补《系统全面诊断》：按完整测试方案做可执行子集体检，并剖析 6 类问题；PR #21 合并后已补记 10:50 三阶段方案对齐。

## 页面

| 页面 | 文件 | 内容 |
| --- | --- | --- |
| 首页 | [index.html](index.html) | 全站入口、Super-agent 一句话定义、三层测试导航与项目背景 |
| 概念(A论文) | [concept.html](concept.html) | 四特征、五模块、架构示意与设计动机 |
| 进化(B论文) | [evolution.html](evolution.html) | Self-Harness 三步闭环、held-in/held-out 规则与术语表 |
| 费曼拆解 | [feynman.html](feynman.html) | 2×2 地图、两篇论文对照表、10 道苏格拉底式自测题 |
| 学习阶梯 | [learning-ladder.html](learning-ladder.html) | 五级八项、里程碑、练习与自检；20 小时计划、一页速查、五个资源与费曼回路 |
| 测试日志 | [test-log.html](test-log.html) | 阶段 0 六项判据、阶段 2 六个 WU、第一层采纳记录、第二层四特征逐项验证、实时双群连续性验证、持续问题日志与继续测试说明 |
| 原型 | [prototype.html](prototype.html) | 论文↔原型概念映射、七个阶段、三处偏离、Watchdog 缺口与 L1–L5 掌握路线 |
| 问题日志 | [problems.md](problems.md) | 持续问题日志的完整版本（固定六字段） |
| 实验全记录 | [experiment.html](experiment.html) | 三层四阶段、时间线、六个 WU、四特征验证、发布与证据边界 |

统一导航：首页｜概念(A论文)｜进化(B论文)｜费曼拆解｜学习阶梯｜测试日志｜原型｜实验。

## 打开方式

- 直接双击 `index.html`：每个页面都是单文件自包含（内联 CSS，无外部字体、脚本或图片），`file://` 下可完整浏览。
- 或起一个本地静态服务：

  ```bash
  python3 -m http.server 8000 --directory learning-site
  # 打开 http://localhost:8000/
  ```

## 视觉 token

| Token | 值 | 用途 |
| --- | --- | --- |
| 主色 | `#B8734A` | 品牌标记、强调、链接悬停 |
| 金色 | `#D4A017` | 分隔线、眉题、注记边框 |
| 深棕文字 | `#3A2A1A` | 正文与标题 |
| 暖纸背景 | `#FBF7F0` | 页面底色 |
| 卡片 | `#FFFDF9` | 内容卡片 |
| 分隔线 | `#E7DCCB` | 边框与表格线 |

## 目录结构

```text
learning-site/
├── index.html        # 首页
├── concept.html      # 概念(A论文)
├── evolution.html    # 进化(B论文)
├── feynman.html      # 费曼拆解
├── learning-ladder.html # 学习阶梯：五级八项、里程碑与自检
├── test-log.html     # 测试日志
├── prototype.html    # 原型：论文到实现
├── experiment.html   # 实验全记录
├── problems.md       # 持续问题日志（完整版）
├── README.md
├── shot.py           # 自检：结构检查 + 无头 Chrome 截图
├── evidence/         # PR 用的 Before/After 截图
├── RELEASE.md        # 发布与验收记录
├── SuperAgent阶段2-实测发现与学习素材.md
├── SuperAgent三层四阶段测试-完整案例分析.md
├── SuperAgent三层四阶段测试方案.md
├── SuperAgent三层四阶段测试-阶段0执行报告.md
├── SuperAgent评估超时-e2e联调记录.md # 2026-11-06 真实飞书端到端超时联调（PR #22）
└── SuperAgent系统全面诊断-2026-11-05.md # 2026-11-05 全面诊断：证据、用例映射与问题剖析
```

## 自检

需要本机装有 Google Chrome（或用 `CHROME=/path/to/chrome` 指定）。

```bash
python3 learning-site/shot.py
```

`shot.py` 会检查每个页面的文件、`title`、viewport、内联样式、统一导航、相对链接与 TODO 标记，并用无头 Chrome 在 1280×800 下截取每页。报告写入 `learning-site/.shot/report.md` 与 `report.json`，截图写入 `learning-site/.shot/shots/`；有 error 或 blocker 时返回非零退出码。

## 如何继续测试

1. **新增或修改页面**后运行 `python3 learning-site/shot.py`，必须 0 error / blocker；报告与 1280×800 截图写入 `learning-site/.shot/`。
2. **推进一个 WU**：一个单元一个分支 / PR，PR 附同视口的 Before/After；同时更新 `test-log.html` 的进度表与本 README 的 WU 表。
3. **保持规格**：八个页面统一导航、内联 CSS、无外部字体/脚本/图片，`file://` 直接可开；不引入构建步骤。新增问题先写 [problems.md](problems.md)，再同步 test-log.html 的最近 5 条。
4. **进入下一层**：第二层四特征逐项验证结果为 3/4 成立，连续性失败归因架构层（无显式引用的跨渠道归属未实现）；先按 [实验 README](../experiments/four-features/README.md) 的现场协议补做真实双渠道/重启验证，再进入阶段 3。
5. **阶段 1 数据**：Harness 基线的实测与采纳/未采纳记录见 [test-log.html](test-log.html)「第一层 · Harness 自改进实测」；本轮未单独跑脚本实验，零代码级采纳已按方案 E1-6 记录原因。
6. **阶段 2 数据**：四特征逐项用例、指标、token 成本与归因见 [test-log.html](test-log.html)「第二层 · 四特征逐项验证」和 [experiments/four-features/README.md](../experiments/four-features/README.md)。

## 内容来源

- 阶段 0 执行报告：[SuperAgent三层四阶段测试-阶段0执行报告.md](SuperAgent三层四阶段测试-阶段0执行报告.md)
- 2026-11-05 全面诊断（证据、用例映射与问题剖析）：[SuperAgent系统全面诊断-2026-11-05.md](SuperAgent系统全面诊断-2026-11-05.md)
- 2026-11-06 评估超时真实飞书端到端联调（PR #22）：[SuperAgent评估超时-e2e联调记录.md](SuperAgent评估超时-e2e联调记录.md)
- 阶段 2 实测发现：[SuperAgent阶段2-实测发现与学习素材.md](SuperAgent阶段2-实测发现与学习素材.md)
- 完整案例分析与测试方案：[SuperAgent三层四阶段测试-完整案例分析.md](SuperAgent三层四阶段测试-完整案例分析.md)、[SuperAgent三层四阶段测试方案.md](SuperAgent三层四阶段测试方案.md)
- 四特征逐项验证（机制基线 + 真实观测 + 现场协议）：[experiments/four-features/README.md](../experiments/four-features/README.md)
- 费曼拆解底稿：《一个管“组织”，一个管“进化”》（阶段 1 交付物）
- 学习阶梯方法：Rahul（@sairahul1），[How To Learn Anything 10x Faster Using Claude](https://x.com/sairahul1/article/2068250224532050089)（五级八项结构；内容事实来自本仓库文档、源码与实验记录）
- 论文：*Exploring Super-agent Design: Towards a More Autonomous Agent System*（A）；*Self-Harness: Harnesses That Improve Themselves*（B）

## 工作单元

| 单元 | 范围 | 状态 |
| --- | --- | --- |
| WU-1 | 站点骨架：5 页 + README + 统一导航 + 视觉 token | 完成 |
| WU-2 | 首页正文：一句话定义、三层测试导航卡片、项目背景 | 完成 |
| WU-3 | 概念页：四特征、五模块、架构示意 | 完成 |
| WU-4 | 进化页：三步闭环、held-in/held-out 规则、术语表 | 完成 |
| WU-5 | 费曼拆解页：2×2 对比表、10 道自测题 | 完成 |
| WU-6 | 测试日志页 + README 本地打开与继续测试说明 | 完成 |
| WU-7 | 原型页：概念映射、七阶段、三处偏离、Watchdog 缺口、L1–L5 | 完成（本 PR） |
| WU-8 | problems.md + 测试日志「持续问题日志」区块 | 完成（本 PR） |
| WU-9 | 费曼页「交叉验证而非自然选择」+ 首页原型入口 | 完成（本 PR） |
| WU-10 | 实验全记录页：三层四阶段、时间线、四特征、发布与证据边界 | 完成（本 PR） |
| WU-11 | 学习阶梯页：五级八项、里程碑与自检；20 小时计划、一页速查、五个资源、费曼回路；全站导航与索引同步 | 完成（本 PR） |

常规单元各自独立成一个 PR；2026-11-04 的 WU-7/8/9 按交接单合并为一个 PR，WU-10 单独一个 PR。未下发的单元不提前开工。
