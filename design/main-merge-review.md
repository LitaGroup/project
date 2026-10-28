# 主分支合并与 UI 范围审查

2026-10-28；分支 `ui-design-update`。本次从 `f2bea76` 合并配置的 `origin/main`：`ac49bd2581249cdf4c20a02268e56b63521d8b7d`。

## 结论与合并处理

相对上述主分支，所有差异限于前端 UI 与 design。后端、API 客户端及类型、鉴权、路由、依赖清单和锁文件与主分支完全一致。主分支带入的业务更新保留在合并提交中。

Layout 保留新导航、全局搜索和快捷键；知识文章保留主分支的面板内滚动修复。旧知识搜索页与旧脚本页按主分支删除。任务对话保留主分支全部发送、分配、验收、返工、失败处理及自动回答；任务侧栏以主分支的信息和事件面板为准。调试页继续使用主分支共享 Markdown/链接/Mermaid 渲染。

调试页的 pending 问题按主分支规则可继续回答；任务页仍要求“待反馈且问题属于当前任务”。请求、SSE、会话上下文、回答内容、跳过内容及所有操作条件保持主分支实现。消息排序、去重、确认卡位置和状态光效均为只读呈现。

## 审查中修正的 UI 问题

- 历史助手回复改用中性边框，当前轮才显示执行、确认和完成光效；历史消息不再一起重播绿色闪烁。
- 禁用确认卡显示“暂不可回答”，避免把活跃任务误标为已结束。
- 通用响应式样式不再覆盖弹窗自身最大宽度；搜索框在1440px视口宽672px，390/360px视口分别宽366/336px。
- 脚本详情复用已有响应式双栏、操作换行和表格滚动包装；390px正文恢复340px宽，侧栏纵排。
- 修复任务类型弹窗的按钮嵌套与脚本 GitHub 链接按钮的组件属性。原回调和请求表达式保持。
- 主分支新增的任务类型、脚本库入口补齐图标配色；任务区7个图标颜色可区分。

任务看板原数据、状态、回调和既有布局保持；保留 Gemini 彩环、三次720ms状态提示、工作头像星标及数字转轮。已移除的装饰扫光保持关闭。

## 验证证据

- [源码范围审计](./main-merge-scope.json)：**24/24**。逐字比较调试请求/SSE/发送/回答/重置、消息转换、QuestionCard 提交代码、任务操作和分配；所有修改页面的 API 调用表达式与主分支一致。
- 消息展示投影：**7/7**，覆盖不可变性、轮次、去重、排序及 task/sender 关联。
- [对话浏览器回归](./daylight-verification.json)：**21/21**，包含当前轮边框、历史中性、真实 pending 可用性、任务原 guard、原请求内容、失败重试、继续追问及360–1920px。
- [全站页面与状态](./daylight-pages.json)：**69/69**。无页面异常、未匹配 API、意外控制台错误或业务写请求；主题均为 light。新增搜索、任务类型、规范库、脚本库与窄屏已覆盖。
- 前端 TypeScript 6、oxlint、Vite 构建、后端类型检查和 `git diff --check` 通过。Vite 保留已有的大分包提示。
- [当前截图与视频](./daylight.html)已刷新；[17.17秒对话录屏](./conversation-video-verification.json)完整解码和黑屏检查通过。

浏览器验证使用隔离虚构 fixtures，未调用实际业务数据库或执行器。后端在本次仅作类型检查，其源码与主分支一致。

## 复现与资源

```sh
node design/preview/merge-scope-check.mjs ac49bd2581249cdf4c20a02268e56b63521d8b7d
node --test design/preview/conversation-presentation.test.mjs
node design/preview/daylight-check.mjs
node design/preview/capture.mjs --report=design/daylight-pages.json --output=design/screenshots/daylight/pages
```

当前正式截图、MP4、设计定义与报告保留。临时截图副本、原始WebM、一次性报告、构建产物与增量编译缓存清理，详见 [清理记录](./main-merge-cleanup.json)。之前暗黑阶段的图库和旧录制/响应式脚本是对应提交的历史资料；本次验收入口为上面列出的脚本。
