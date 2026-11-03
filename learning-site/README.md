# Super-agent 学习站（learning-site）

阶段 2 的静态学习站：5 个页面加本 README，按「概念 → 进化 → 费曼拆解 → 测试日志」的路线阅读两篇论文。

**当前进度：WU-1 ~ WU-6 全部完成。** 五个页面正文与测试日志已补齐，站内导航、视觉 token、自检脚本与本地打开说明均已就位。

## 页面

| 页面 | 文件 | 内容 |
| --- | --- | --- |
| 首页 | [index.html](index.html) | 全站入口、Super-agent 一句话定义、三层测试导航与项目背景 |
| 概念(A论文) | [concept.html](concept.html) | 四特征、五模块、架构示意与设计动机 |
| 进化(B论文) | [evolution.html](evolution.html) | Self-Harness 三步闭环、held-in/held-out 规则与术语表 |
| 费曼拆解 | [feynman.html](feynman.html) | 2×2 地图、两篇论文对照表、10 道苏格拉底式自测题 |
| 测试日志 | [test-log.html](test-log.html) | 阶段 0 六项判据、阶段 2 六个 WU、第一层采纳记录与继续测试说明 |

统一导航：首页｜概念(A论文)｜进化(B论文)｜费曼拆解｜测试日志。

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
├── test-log.html     # 测试日志
├── README.md
├── shot.py           # 自检：结构检查 + 无头 Chrome 截图
├── evidence/         # PR 用的 Before/After 截图
├── SuperAgent阶段2-实测发现与学习素材.md
├── SuperAgent三层四阶段测试-完整案例分析.md
├── SuperAgent三层四阶段测试方案.md
└── SuperAgent三层四阶段测试-阶段0执行报告.md
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
3. **保持规格**：五个页面统一导航、内联 CSS、无外部字体/脚本/图片，`file://` 直接可开；不引入构建步骤。
4. **进入下一层**：阶段 2 的四特征矩阵（测试方案 4.3，每特征 2 个场景）全部通过后，才进入阶段 3。
5. **阶段 1 数据**：Harness 基线的实测与采纳/未采纳记录见 [test-log.html](test-log.html)「第一层 · Harness 自改进实测」；本轮未单独跑脚本实验，零代码级采纳已按方案 E1-6 记录原因。

## 内容来源

- 阶段 0 执行报告：[SuperAgent三层四阶段测试-阶段0执行报告.md](SuperAgent三层四阶段测试-阶段0执行报告.md)
- 阶段 2 实测发现：[SuperAgent阶段2-实测发现与学习素材.md](SuperAgent阶段2-实测发现与学习素材.md)
- 完整案例分析与测试方案：[SuperAgent三层四阶段测试-完整案例分析.md](SuperAgent三层四阶段测试-完整案例分析.md)、[SuperAgent三层四阶段测试方案.md](SuperAgent三层四阶段测试方案.md)
- 费曼拆解底稿：《一个管“组织”，一个管“进化”》（阶段 1 交付物）
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

每个单元独立成一个 PR；未下发的单元不提前开工。
