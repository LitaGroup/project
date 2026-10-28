# 项目管理平台 · 日间主题与 beUI 对话工作台

2026-10-28；分支 `ui-design-update`。当前交付为日间主题与 beUI 对话呈现。相对合并后的主分支 `ac49bd2`，差异限于前端 UI 和 design；当前规范以本节链接为准。

- [合并主分支与最终 diff 审查](./main-merge-review.md)：24项源码审计、69个页面场景与UI修正。
- [Docker 本地真实对话验证](./local-chat-verification.md)：7轮真实模型交互、草稿恢复与新轮滚动修正、隔离环境入口及停止/恢复说明。
- [审查布局问题修复](./layout-fixes-verification.md)：长失败/拒绝说明内部滚动、脚本库终端限高与 SSE 自动跟随验证。
- [短窗口任务确认区修复](./task-footer-verification.md)：确认卡与待反馈事项叠加时的高度约束、滚动和答案保留，覆盖五种尺寸。
- [大号统计动效验证](./digit-scope-verification.json)：仅顶部6个大号KPI在入场和数值变化时翻滚；小徽标与括号计数直接更新。时长280ms、每位10ms错峰。
- [列表筛选栏规范](./filter-toolbar.md)：统一18个列表页的搜索、筛选控件与响应式布局。
- [日间设计定义](./daylight-plan.md)：主题、状态光效、beUI 组件映射、消息展示与范围。
- [当前截图与录屏](./daylight.html)：运行彩环、黄色确认卡、绿色完成态、继续追问及全站页面。
- [日间验收记录](./daylight-verification.md) · [浏览器机器报告](./daylight-verification.json) · [全站页面报告](./daylight-pages.json)。
- [当前对话总览视频](./screenshots/daylight/conversation-overview.mp4)：真实浏览器 UI，执行 → 确认 → 完成 → 继续追问。
- [卡片扫光清理验收](./quiet-surfaces-verification.json)：表面保持稳定，保留明确指定的状态动效。
- [组件来源及 MIT 许可](../frontend/THIRD_PARTY_NOTICES.md)。

视觉矩阵使用隔离的虚构 fixtures；新增真实对话验证使用独立 Docker 数据库、后端与执行器。产品中的 API、SSE 与会话处理继续使用原实现。两类验证入口分别见对应记录。

## 之前阶段的设计资料

以下为暗黑方案及先前验收的历史存档，不代表当前日间配色。

### Dashboard 5 暗黑视觉更新

设计始于2026-10-27，最终审查：2026-10-28。分支：`ui-design-update`。按最终授权创建本地 UI 提交，不推送。

本次以用户指定的 Square UI Dashboard 5 为主参考，采用中性黑阶、炭灰卡片、独立内嵌内容框和彩色菜单图标；共享品牌与机器人默认头像采用用户指定的 www 项目原始兔子大图标及右上 AI 四芒星图形；结合 Beautiful UI 与 beUI 的会话排版、运行网格、状态切换、数字滚动和卡片微倾斜。进行中的任务保留独立错峰的 Gemini 彩色旋转细环。现有操作、权限、API、数据处理与实时更新行为保持原样。

- [最终 diff 与范围审查](./final-diff-review.md)：仅 UI/design，原业务保持，包含提交前配色修正与验证。
- [核心页面总览录屏](./screenshots/project-ui-overview.mp4)：2026-10-28，42.5秒、1080p/30fps，覆盖7个核心页面及真实动效；[视频验收记录](./overview-video-verification.json)。
- [设计规范](./ui-theme.md)：来源、token、页面映射、动效和边界。
- [会话与组件动效](./component-motion.md)：Beautiful UI、beUI 的实际接入和展示边界。
- [工作台材质](./premium-visual.md) · [会话打磨](./conversation-polish.md)：统一对话工作台、AI 身份标记、局部运行光效、思考展开、输入聚焦及其他页面的反射材质与指针交互。
- [本轮材质范围审查](./premium-scope-review.md)：任务看板/概览与响应式源码保持，原业务逐项复核。
- [Cyberdaddy 来源核对](./references/cyberdaddy-research.md)：SPIDER 作战大屏、可复用的固定 MIT 版本、当前版本许可与原图。
- [实施与验证](./implementation.md)：UI 文件范围与验证步骤。
- [截图索引](./index.html)：55 个页面与状态，含Gemini彩环、首卡悬停、反馈输入、运行中会话与窄屏。
- [独立范围审查](./scope-review.md)：逐项核对原 hooks、事件、API、操作条件与文案。
- [响应式适配与截图](./responsive/README.md)：非任务区360–1920px布局、筛选、表格、详情、编辑器和弹窗；包含独立矩阵与本轮范围审查。
- [大数字动效验证](./digit-motion-verification.json)：全站9处大数字以0.6秒转轮滚动到原目标值，首次入场、位数变化与减值验证；[任务顶部实录](./screenshots/digit-reel-motion.mp4)。
- [会话验证](./ai-deep-verification.json)：36个尺寸状态、指定worker1、空状态、交互和图形运动。
- [工作态录屏](./screenshots/robot-conversation-motion.mp4)：11秒覆盖四芒星慢启、加速、停留和重新启动。
- [验证记录](./verification.md)：构建、样式、动画、范围审查与资源说明。
- `screenshots/`：各页面最终截图与总览图。
- `preview/`：只用于截图的浏览器 fixtures 与捕获脚本；示例数据不会进入产品代码或业务库。

参考：[Dashboard 5 Demo](https://square-ui-dashboard-5.vercel.app/)、[官方源码](https://github.com/zerostaticthemes/square-ui/tree/master/templates/dashboard-5)、[官方原图](./references/dashboard-5.png)、[Gemini官方动效设计](https://design.google/library/gemini-ai-visual-design)、[Hyperframer Border Glow](https://www.hyperframer.com/next-js-border-glow-animation/)。

组件来源：[Beautiful UI](https://www.beautifului.dev/)、[beUI](https://beui.dev/)；完整版权和 MIT 许可保留在 [THIRD_PARTY_NOTICES](../frontend/THIRD_PARTY_NOTICES.md)。Transitions.dev、Rare UI 与 shadcn 作为动效节奏和组件结构研究资料，未拷入其源文件。

## 实时预览

本地只读预览已运行，当前重点页面为 [机器人对话](http://127.0.0.1:5274/tasks/workers/1/debug)，[任务看板](http://127.0.0.1:5274/tasks/list)保持现状；用户浏览器标签继续保留。此服务仅将现有 Vite UI 与虚构 fixtures 组合展示，所有写请求阻止，绝不连接业务后端。样式通过同源 HMR 实时更新。

复现：在此 worktree 运行 `pnpm dev:frontend` 与 `node design/preview/server.mjs`；截图使用 `node design/preview/capture.mjs`。现有本机 Playwright / Chromium 路径已写在工具脚本中，无新增产品依赖。

## 局域网查看

当前局域网地址：[http://10.20.1.130:5274/tasks/list](http://10.20.1.130:5274/tasks/list)。访问者须与此电脑网络互通，且此电脑与预览服务保持运行。预览继续仅使用示例数据、阻止写请求。

本次按用户要求以 `UI_PREVIEW_HOST=0.0.0.0 node design/preview/server.mjs` 运行；不设置该环境变量时仍仅监听本机。

各阶段验收 JSON 保留采集当时的分支与未提交状态，属于历史快照；最终范围和交付状态以 `final-diff-review.md` 为准。
