# 审查布局问题修复

2026-10-28；分支 `ui-design-update`。

本轮修复两项 P2 问题，仅修改两个现有 JSX `className`：

- 任务对话的失败/拒绝说明：整体限高为 `min(24dvh, 12rem)`，允许内部纵向滚动。拒绝理由和分发建议共用同一滚动区，完整内容保留；输入框、操作按钮及原条件不变。
- 脚本库详情：根容器接入现有 `responsive-run-page` 样式。工作区不超过 64rem 时，终端复用其他运行页的 `20rem` 最小高度和 `65dvh` 最大高度，继续使用原终端滚动、SSE 和自动跟随实现。

## 修复前后验证

使用实际前端构建和独立 Docker 只读 fixtures，在 1280×720 浏览器中验证。失败原因 80 行；拒绝理由与分发建议各 80 行；终端初始 400 行，并通过 SSE 追加输出。未创建业务任务、运行脚本或连接线上环境。

| 场景 | 修改前 | 修改后 |
|---|---|---|
| 长失败原因 | 说明高 1596px，输入框底部位于 1987px | 说明高 173px、内部可滚动，输入框底部约 617px |
| 长拒绝理由及分发建议 | 与失败原因共用未限高的容器 | 3164px 内容收进 173px 滚动区，聊天区保留 105px |
| 脚本长日志 | 终端高 8072px，scrollTop 为 0 | 终端高 468px，scrollTop 为 7604 |
| SSE 新增一行 | 原终端没有内部滚动范围 | scrollHeight 增至 8092，scrollTop 跟随到 7624 |

[机器记录](./layout-fixes-verification.json) · [失败原因截图](./screenshots/layout-fixes/long-failure.jpg) · [终端截图](./screenshots/layout-fixes/long-terminal.jpg)。

12 项浏览器测量断言、24 项指定主分支基线范围检查均通过。TypeScript、变更文件 oxlint、Vite 构建通过；构建仍有既有大分包提示。AST 比对确认两个产品文件去除 className 后与修复前完全一致，hooks、请求、SSE、状态和操作规则未变化。原审查子 Agent 已复核这两项修复，无剩余可操作问题。

只读复现场景位于 `preview/layout-regression-server.mjs`：在官方 Node Docker 镜像中运行，将该目录只读挂载到 `/preview`、前端构建目录只读挂载到 `/web`，入口为 `node /preview/layout-regression-server.mjs`，容器 8080 端口仅发布至宿主 `127.0.0.1:5277`。`/tasks/2` 为长失败原因、`/tasks/3` 为拒绝及分发建议，`/docs/scripts/detail?path=projects%2Fworkspace%2Fcore%2Fhealth.check.ts` 为持续追加的长日志。所有写请求返回 405，接口只返回 fixtures。

本轮临时验证标签和容器在截图、记录留档后关闭；重复构建和临时记录清理，保留现有 Docker 真实运行服务及工具样式验收页。
