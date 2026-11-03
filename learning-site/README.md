# Super-agent 学习站（learning-site）

阶段 2 的静态学习站：5 个页面加本 README，按「概念 → 进化 → 费曼拆解 → 测试日志」的路线阅读两篇论文。

**当前进度：WU-1 站点骨架、WU-2 首页正文、WU-3 概念页。** 概念页已补齐四特征、五模块与架构示意；其余页面正文由后续逐条下发的 WU 填充。

## 页面

| 页面 | 文件 | 内容 |
| --- | --- | --- |
| 首页 | [index.html](index.html) | 全站入口、Super-agent 一句话定义、三层测试导航与项目背景 |
| 概念(A论文) | [concept.html](concept.html) | 四特征、五模块、架构示意与设计动机 |
| 进化(B论文) | [evolution.html](evolution.html) | *Self-Harness* 的三步闭环与证据 |
| 费曼拆解 | [feynman.html](feynman.html) | 费曼学习法与苏格拉底式问答的拆解路线 |
| 测试日志 | [test-log.html](test-log.html) | 阶段 0 / 阶段 2 的执行记录与 WU 验收 |

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
└── SuperAgent三层四阶段测试-阶段0执行报告.md
```

## 自检

需要本机装有 Google Chrome（或用 `CHROME=/path/to/chrome` 指定）。

```bash
python3 learning-site/shot.py
```

`shot.py` 会检查每个页面的文件、`title`、viewport、内联样式、统一导航、相对链接与 TODO 标记，并用无头 Chrome 在 1280×800 下截取每页。报告写入 `learning-site/.shot/report.md` 与 `report.json`，截图写入 `learning-site/.shot/shots/`；有 error 或 blocker 时返回非零退出码。

## 内容来源

- 阶段 0 执行报告：[SuperAgent三层四阶段测试-阶段0执行报告.md](SuperAgent三层四阶段测试-阶段0执行报告.md)
- 费曼拆解底稿：《一个管“组织”，一个管“进化”》（阶段 1 交付物）
- 论文：*Exploring Super-agent Design: Towards a More Autonomous Agent System*（A）；*Self-Harness: Harnesses That Improve Themselves*（B）

## 工作单元

| 单元 | 范围 | 状态 |
| --- | --- | --- |
| WU-1 | 站点骨架：5 页 + README + 统一导航 + 视觉 token | 完成 |
| WU-2 | 首页正文：一句话定义、三层测试导航卡片、项目背景 | 完成 |
| WU-3 | 概念页：四特征、五模块、架构示意 | 完成 |
| WU-4 ~ WU-6 | 按逐条下发的单元消息推进 | 待下发 |

每个单元独立成一个 PR；未下发的单元不提前开工。
