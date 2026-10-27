# UI Theme Implementation Plan

**Goal:** 以用户最新指定的Square UI Dashboard 5为主要视觉基准，增加Gemini彩环与纯视觉交互并完成页面截图，全部本地保留。

**Architecture:** 通过 CSS 覆盖 Appica 角色 token 与稳定 data-slot，布局只增加视觉 className；动画配置按用户要求固定启用。TasksPage 的既有内容包裹纯展示 BorderGlow。截图脚本独立于应用，在浏览器拦截全部 API，以示例快照验证展示。

**Tech Stack:** 现有 React 19、Appica、Tailwind v4、Framer Motion；使用本机已有 Playwright / Chromium，无新增产品依赖。

## 约束

- 不修改 backend、API 客户端、路由、鉴权、业务状态、事件处理与文案。
- 不新增产品功能或操作步骤。
- 按最终授权在 `ui-design-update` 创建本地 UI/design 提交；不推送、不发布。
- 复用浏览器运行时；仅后台执行；所有截图数据为 fixtures。

## 实施

- [x] 创建独立 worktree，最终分支重命名为 `ui-design-update`，核对干净基线。
- [x] 调查官方主题与 Border Glow 原实现，先保存 `design/ui-theme.md`。
- [x] `frontend/src/styles/square-theme.css`：中性暗色角色token和彩色菜单图标token、基础表面与排版。
- [x] `frontend/src/styles/cyber-command.css`：Dashboard 5内嵌主面板、舒适间距、卡片、菜单和任务呈现。
- [x] `frontend/src/components/gemini-glow.css`：1.5px连续Gemini彩环、平滑渐变、每任务独立相位与周期。
- [x] `frontend/src/index.css`：导入主题，兼容 pnpm hoisted 组件扫描路径。
- [x] `frontend/src/main.tsx`：通过现有 ThemeProvider forcedTheme="dark" 统一暗黑展示。
- [x] `frontend/src/components/MotionProvider.tsx` / `frontend/src/lib/motion.ts`：仅修改动画和原生滚动的展示偏好。
- [x] `frontend/src/components/Layout.tsx`：仅视觉 className、装饰品牌图形及SurfaceEffects挂载点。
- [x] `frontend/src/pages/TaskCenterPage.tsx`：统计卡视觉 className 与既有数字 DigitSwap 展示。
- [x] `frontend/src/components/BorderGlow.tsx` / `border-glow.css` / `frontend/src/pages/TasksPage.tsx`：呈现层描边与任务卡片视觉。
- [x] `frontend/src/components/SurfaceEffects.tsx` / `surface-effects.css`：指针聚光、菜单图标与按钮反馈，无业务状态或网络操作。
- [x] `frontend/src/components/ai-ui/`：Beautiful UI 运行网格、shimmer、紧凑工具 chips、思考轨迹和输入区；任务对话及调试页保留原有 assistant-ui runtime 和事件逻辑。
- [x] `frontend/src/components/motion-ui/`：beUI DigitSwap / ActionSwap / TiltCard，复用现有 framer-motion；用于既有数字、复制反馈、日志展开提示和任务卡。
- [x] `frontend/src/components/task-detail/task-pipeline.css`：现有流水线的连线、执行节点与独立相位，无新阶段或模拟数据。
- [x] `frontend/THIRD_PARTY_NOTICES.md`：保留实际适配来源的完整 MIT 版权及许可。
- [x] `ResponsiveTable.tsx` 与28个非任务页面：仅调整import/className，表格props/子节点、所有原操作完整保留。
- [x] `responsive.css` / `responsive-details.css`：基于内容宽度的筛选、表格、分栏、目录、长文本和弹窗适配；排除任务区。
- [x] `design/preview/responsive.mjs`：独立fixtures下的六尺寸矩阵，核对实际遮挡、末列可达与编辑器对比度。
- [x] `premium-ui.css`：既有工作表面的材质、反射、行hover、控件聚焦与单次按钮光泽，任务看板/概览保持。
- [x] 机器人会话：装饰身份框、真实运行细环、思考trace、工具托盘与聚焦输入dock，保留所有原数据和操作。
- [x] `design/preview/*.mjs`：拦截全部 API 的独立截图验证；`design/screenshots/` 保存最终图。

## 验证与收尾

- [x] 使用前端既有TypeScript 6.0.3、Vite 8.2.1和oxlint验证通过。
- [x] TS AST 核对原业务函数 / hook / 事件处理均未改，新增聚光仅写局部CSS坐标，检查 backend 与 API 等文件零 diff。
- [x] 桌面、窄屏、系统浅色下强制暗黑、减少动态效果、菜单和日志展开；检查控制台与横向溢出。
- [x] 检视实际截图，修正样式后更新截图与 report。
- [x] 关闭临时测试浏览器、清理 build/work 中间产物；按用户要求保留实时预览服务与其所需缓存；保留源码、设计、截图及验证脚本。
- [x] 核对提交只含本次 UI/design，保留原工作区状态。
