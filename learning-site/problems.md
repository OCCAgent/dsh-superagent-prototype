# learning-site 持续问题日志

> 记录学习网站与测试运行中遇到的问题。字段固定：**日期 | 现象 | 根因 | 处置 | 状态 | 证据/链接**。
> 本页是问题日志的完整版本；`test-log.html` 的「持续问题日志」区块只渲染最新 5 条。

| 日期 | 现象 | 根因 | 处置 | 状态 | 证据/链接 |
| --- | --- | --- | --- | --- | --- |
| 2026-11-04 | PR #9 一直显示「可合并」但合不了 | main 前进到 `85bd2e3` 后 PR base 仍是 `0f9be20`，`docs/007` 两边各加一行形成冲突 | 合入 main、保留两行、跑测试后合并 | 已解决 | PR #9 / `93504d6` |
| 2026-11-04 | `git push` 报 `could not read Username`，沙箱内 `gh auth status` 失效 | 沙箱进程读不到 macOS 钥匙串，gh 取不到已有凭据（宿主机上凭据有效） | 用宿主机权限执行推送/合并 | 已绕过 | 本次会话日志 |
| 2026-11-04 | `ab27` 工单停在 `LlmError: DeepSeek Messages stream ended` | DeepSeek 流中断；工单进入 idle，`retry` 对 idle 不生效 | 服务重启触发恢复注记，新 Assignment 用 DeepSeek 继续 | 恢复中 | 工单 `ab27e4b5` |
| 2026-11-04 | 部署代码落后 main 21 个提交 | 服务跑在 `Documents/.../dsh-superagent`（`6337fc8`），工作克隆在 `~/src/...` | IPv4 修复走 PR #11；profile 链接切到 fork main；重启生效 | 已解决 | PR #11 / `43c69f4` |
| 2026-11-04 | 全量 `pnpm check` 13 个超时 | 并行/本机负载，单独复跑均通过 | 记录为 flaky，后续补基线对比 | 观察中 | four-features worktree |
