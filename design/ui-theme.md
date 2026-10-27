# Dashboard 5 暗黑 UI 设计规范

2026-10-27制定，2026-10-28最终审查。分支 `ui-design-update`，仅本地 UI 提交，不推送。

## 方向与依据

以用户最新指定的 [Square UI Dashboard 5](https://square-ui-dashboard-5.vercel.app/) 为主要基准。已实际查看[官方原图](./references/dashboard-5.png)，并核对官方模板的 token、布局与侧栏实现。保留它的中性黑阶、炭灰卡片、细边框、内嵌内容面板、舒适间距和彩色菜单图标。增加的视觉交互集中在卡片聚光、菜单反馈、按钮按压与进行中任务的 Gemini 彩色旋转光圈。

[参考取值与源码位置](./references/dashboard-5-notes.json)。早先的 Habit Tracker、视频和控制台研究保留为背景参考，当前视觉以 Dashboard 5 为准。

会话区采用 Beautiful UI 的平铺消息、紧凑工具 chips、网格活动指示和 shimmer；beUI 提供数字滚动、已有动作的状态切换与低幅卡片倾斜。现有任务流水线通过执行节点扩散环和连接流光表达活动。来源、接入边界与独立验收见 [component-motion.md](./component-motion.md)，Cyberdaddy 固定 MIT 版本见 [来源核对](./references/cyberdaddy-research.md)。

## 范围

仅修改主题、布局样式、视觉 className、装饰标记和动画。已有页面、字段、文字、链接、权限、业务状态、请求、筛选、SSE、事件处理与工作流程保持原样。指针聚光只写卡片局部 CSS 坐标，无网络请求、业务状态或额外操作。

ThemeProvider 固定 dark。用户明确要求持续动效，不跟随系统减少动态效果设置；没有新增开关。

## Token 与布局

| 角色 | 值 |
| --- | --- |
| 页面背景 | `#0a0a0a` |
| 卡片 / Sidebar | `#171717` |
| Hover / 次级表面 | `#262626` |
| 强正文 | `#fafafa` |
| 次文字 | `#a1a1a1` |
| Primary | `#e5e5e5` |
| 边框 / 输入边框 | 白色 10% / 15% |
| Gemini | `#4285f4 → #67d5ff → #9b72ef → #ef78be → #f5ad75` |

全局角色映射到既有 Appica tokens。页面标题24px / 600，统计数字24px / 500，卡片标题14px / 500，辅助信息10–12px。中文使用系统 sans；编号、日志、路径沿用等宽字体。卡片圆角14px，控件圆角6px；桌面内容面板外边距8px，内容通常24px，卡片间距16px。

现有任务实时说明与三类计数合为一条横向统计区，下方保留三列任务；全部原始内容与操作均保留。窄屏沿用既有导航和单列布局。

## 菜单与交互

- 菜单文字保持中性；各功能图标明确区分蓝、青、翠绿、紫、玫红、橙、琥珀与天蓝，active / hover 保留该项颜色。
- 菜单行使用中性 hover 表面，图标轻微位移；顶级导航沿用原滑动选中动画。
- 卡片 hover 的柔和聚光随指针移动；装饰层不接收点击，离开后收回。
- 任务卡随指针倾斜，幅度硬限 2°，离开复位；不额外缩放或平移，不改变链接和日志操作。
- 按钮保留原功能，增加轻微悬停与按压反馈。
- 统计值变化按固定字位滚动；既有复制成功图标与日志收起提示使用短暂状态切换，动画不生成数据。
- 真实运行状态使用 650ms 九宫格波动与文字 shimmer；任务卡活动指示按任务 ID 错峰，任务光圈保持独立周期。
- 真实最新日志变化时上移4px入场；不插入文字、不伪造进度。
- 进行中任务使用连续 Gemini 彩色旋转光圈和柔光。每个任务 ID 派生稳定相位、负延迟和略有差异的周期，重新渲染不随机跳变。其他状态保留 hover 流光，同样错开相位。
- 列表顶端留白16px，原卡片上浮2px后保留14px净距。

## 文件

`square-theme.css` 管理 token 与基础组件，`cyber-command.css` 管理 Dashboard 5 的布局呈现，`border-glow.css` 管理任务基础样式，`BorderGlow.tsx` / `gemini-glow.css` 管理彩色任务光圈，`SurfaceEffects.tsx` / `surface-effects.css` 管理纯视觉指针反馈。

`design/preview/` 的独立 fixtures 与截图工具不连接业务数据库；预览阻止写请求。

## 非任务页面响应式

非任务主区使用命名 `workspace` 容器查询，按导航占位后的可用宽度重排。筛选组可换行，窄屏搜索独占一行；标题、动作和分页保留独立空间。`ResponsiveTable` 透传原表格 props/children，只增加局部横向滚动区域，全部列与操作保持可达。

项目、缺陷、运行详情和APP模拟器面板在内容不足时上下排列，宽屏继续左右分栏；知识目录、文章标题、长路径、个人资料和概览卡片允许收缩与换行。弹窗正文可滚动，分支/提测字段在手机上重排；原DocToc目录保留可见断点，在较窄内容区移到编辑器上方。

`responsive.css` / `responsive-details.css` 负责以上布局；布局与portal规则继续排除任务区。Crepe暗色角色与占位文字按编辑器语义全站生效，也覆盖任务表单和提测Portal，保留原编辑/保存行为。记录见 [响应式适配](./responsive/README.md)。

## 工作台材质与机器人会话

`premium-ui.css` 在既有材质基础上增加实体面板渐层、上沿反射、低亮阴影、指针边缘反射、表头独立表面、行hover细轨、内凹输入与代码轨道、实体按钮的一次性光泽。它不修改响应式宽度、高度和滚动规则。任务看板 `/tasks/list` 与任务概览 `/tasks` 保持原样；机器人列表、编辑、执行器及其他页面使用统一材质。

机器人会话内容区用专属 `ai-conversation.css`，原黑头像加装饰身份框，真实运行中出现彩色细环与正文侧轨；工具chip有状态细线，思考过程有可展开的独立表面，输入dock有聚焦彩边与指针反射。原发送、禁用、问答、复制、中断、重置和所有数据流保持。含会话的main内容区排除全局材质规则，避免覆盖；共用头栏和导航可使用新材质。

细节及交互记录见 [工作台材质](./premium-visual.md)、[会话打磨](./conversation-polish.md)、[独立审查](./premium-scope-review.md)。

## 来源

- [Dashboard 5 Demo](https://square-ui-dashboard-5.vercel.app/)
- [官方全局 token](https://github.com/zerostaticthemes/square-ui/blob/master/templates/dashboard-5/app/globals.css)
- [官方侧栏](https://github.com/zerostaticthemes/square-ui/blob/master/templates/dashboard-5/components/dashboard/sidebar.tsx)
- [官方内容布局](https://github.com/zerostaticthemes/square-ui/blob/master/templates/dashboard-5/components/dashboard/content.tsx)
- [Gemini 官方动效设计](https://design.google/library/gemini-ai-visual-design)
- [Hyperframer Border Glow](https://www.hyperframer.com/next-js-border-glow-animation/)
