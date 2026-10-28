# UI-only 独立范围审查

基线：Git HEAD `9dc32b8`。审查对象：本次 UI 工作区差异；使用 TypeScript AST 对照原文件，并人工核对新增展示组件与 CSS。产品源码未由审查者修改。

结论：已检查的原业务数据、请求、状态、事件、路由、操作条件与文案保持一致。发现的连接状态配色覆盖问题已由主 Agent 修复，修复后独立验证通过。当前无待修复的范围或 React 质量问题。

## 原文件逐项比对

下表计数均为原有与当前同时存在的内容，且 AST 打印结果逐项一致：

| 文件 | hooks | 事件 JSX 属性 | 链接属性 | 静态 JSX 文案 |
| --- | ---: | ---: | ---: | ---: |
| `Layout.tsx` | 3 | 2 | 4 | 5 |
| `TasksPage.tsx` | 20 | 6 | 3 | 20 |
| `TaskCenterPage.tsx` | 10 | 4 | 3 | 17 |
| `LoginPage.tsx` | 2 | 0 | 2 | 4 |
| `TaskChatPanel.tsx` | 3 | 7 | 0 | 15 |
| `TaskSidePanel.tsx` | 3 | 4 | 2 | 7 |
| `WorkerDebugPage.tsx` | 13 | 6 | 1 | 15 |
| **合计** | **54** | **29** | **15** | **83** |

补充核对：

- 172 段含中文字符串/模板片段、149 项无 JSX 的变量声明、26 项原顶层语句、10 处 API 调用表达式均一致；原 hooks 的完整参数、回调、依赖数组一致，涵盖 SSE、请求、状态与派生数据。
- 67 个原有操作属性（含 disabled、value、checked、type 等）全部保留；新增的 2 个 value 属性分别把原统计数值交给 DigitSwap 展示。
- 原 60 个函数的签名、业务计算与转换已核对；AnimatedCount 仅将原数字 JSX 换为 DigitSwap。新增 TaskCardFrame 只选择装饰外壳。
- 244 个原条件表达式的差异逐项人工核对：变化集中于图标、动效 key、外壳和折叠呈现。发送反馈、重新识别、中断、验收、取消、重置会话、复制、问答提交/跳过、日志展开及路由条件保持原有逻辑。
- DebugReasoning 保留原 open 派生与点击状态，仅用 data-open/aria-hidden 和 CSS grid 过渡替代条件挂载；内容为原有纯文本，无新增可聚焦操作。
- 调试消息新增展示已有 worker.name；统计、日志、流水线与交付物均使用原有真实数据。

## 新增展示代码

- SurfaceEffects：1 个独立视觉 useEffect，被动监听局部 pointermove/pointerleave；仅写入命中卡片的 CSS 坐标，卸载时移除监听与坐标，返回 null。
- TiltCard：2 个 useMotionValue、2 个 useSpring、1 个 useMotionTemplate；3 个指针事件只控制旋转，触屏跳过，离开/取消复位。未拦截原点击或改变子节点操作。
- BorderGlow、DigitSwap、ActionSwap、AgentActivity 无业务状态或请求；只呈现已有 children、统计值与状态。task.id 仅用于稳定动画相位/周期。
- 光环、指针高光、运行轨迹与流水线伪元素均使用 pointer-events:none。未发现通过 CSS 隐藏操作或新增入口、步骤、模拟指标/业务数据。
- 用户已明确要求的 UI 配置例外：forcedTheme="dark"、reducedMotion="never"、原生滚动视觉 helper 固定返回 false；不再读取系统减少动态效果偏好。

## 范围与验证

`backend/`、`frontend/src/lib/api.ts`、`frontend/src/context/`、`frontend/src/App.tsx`、根目录/前后端 package.json、pnpm-lock.yaml、pnpm-workspace.yaml 与 HEAD 无差异；对应后端/context 路径无新增未追踪文件。`frontend/src/lib/motion.ts` 仅有上述用户要求的 UI 配置变化。

`git diff --check` 通过。浏览器隔离 CSS 级联验证在后台 Chromium 执行：加载当前主题/看板 CSS 与原状态 utility 规则，核对连接中、重连中、实时的计算样式；三者均保留独立颜色，圆角均为 6px：

| 状态 | 文字颜色 | 背景 |
| --- | --- | --- |
| 实时 | rgb(110, 231, 183) | rgba(52, 211, 153, 0.1) |
| 重连中 | rgb(252, 211, 77) | rgba(251, 191, 36, 0.1) |
| 连接中 | rgb(147, 197, 253) | rgba(96, 165, 250, 0.1) |

已修复的问题原因为 `.task-board-connection` 无条件 success 颜色覆盖原 connectionMeta 的动态状态类；当前规则仅设圆角。

本报告覆盖源码范围、React 展示层与上述独立 CSS 回归验证；全量截图、构建与 lint 的最终结果由主 Agent 记录于 design/verification.md。本轮审查未创建临时下载、截图文件或浏览器标签页，后台 Chromium 进程已关闭。
