# 项目管理平台 · Dashboard 5 暗黑视觉更新

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
