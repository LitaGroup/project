# AI 会话与组件动效更新

2026-10-27制定；最终分支 `ui-design-update`，按2026-10-28授权创建本地 UI 提交，不推送。

## 本轮方向

用户要求采用 Beautiful UI、beUI 等真实组件，并替换目前不喜欢的 assistant-ui 默认外观。全局仍以已选 Dashboard 5 为底，彩色菜单和进行中任务 Gemini 细环保留。

- 会话：以 Beautiful UI Chat、Thinking、Tool Chips 的视觉组织为主，明确发送者与头像、平铺正文、紧凑工具调用、细线思考轨迹和清楚的输入区。
- 数字：仅任务态势/任务概览顶部6个大号KPI复用 beUI DigitSwap。首次出现和数值变化时，每位数字沿0–9转轮完整滚过一圈，再减速落到原目标值；单轮动效0.28秒、每位10ms错峰，稳定后静止。列头徽标、工作概览机器人数量以及图片/变更记录等括号计数直接显示并更新。原数值表达式、字体、颜色与布局保持。
- 看板：采用同一 DigitSwap 展示既有统计值变化；低幅 TiltCard 让卡片随指针产生轻微深度；ActionSwap 用于已有复制成功等状态反馈。
- 活动指示：Beautiful UI Loading State 的像素网格和 shimmer，只表现已有的运行状态，不附加模拟计时、示例进度、音视频或控制按钮。
- 流水线：沿现有阶段顺序显示连接轨迹，真实执行中的节点出现扩散环和向下流光；任务 ID 决定稳定相位，保留原有阶段链接与交付物入口。
- 其他来源：Transitions.dev 用于内容展开和状态衔接的节奏研究，Rare UI / shadcn 用于组件结构核对；只引入适合现有界面的部分，不批量替换基础库。

## 范围

保留现有 API、SSE、消息转换、任务和机器人状态、条件、权限、按钮行为、问答提交以及输入保存逻辑。assistant-ui runtime 继续承接现有会话数据，本轮替换呈现层，避免牵动业务。

不新增页面、指标、入口、确认步骤、设置或演示数据。按用户先前要求持续启用动效，不读取系统减少动态效果。

## 实现边界

- `components/ai-ui/`：Beautiful UI 免费 MIT 原件的本地展示适配，以及原创 AiEnergy/AiWaveform 装饰。
- `components/motion-ui/`：beUI 免费 MIT 组件的本地适配；使用现有 framer-motion，不增产品依赖。
- 任务详情与机器人调试只调整 JSX 呈现和专属 CSS；原业务函数、事件与数据处理保持不变。
- 菜单/看板保留现有目标与内容，动画幅度受列内留白约束，装饰不拦截操作。
- 第三方版权和 MIT 许可保留在 `frontend/THIRD_PARTY_NOTICES.md`，源码注释记录具体来源。

## 验证

构建、类型、lint；AST 复核原业务；会话流式内容、思考/工具展开、问答、输入和原操作的展示；数字变化、微倾斜、真实点击、首卡净距及窄屏。更新受影响页面截图和索引，正式成果接替后清理临时产物。

组件独立验证：DigitSwap 的 9→10 位数变化、ActionSwap 的复制成功切换、TiltCard 的 2° 硬限和离开复位，真实按钮及链接有效；系统减少动态效果开启时继续运行动画。正式页面与当前截图结果见 `verification.md`。

## 来源

- https://www.beautifului.dev/ · https://github.com/slev12397/beautiful-ui
- https://beui.dev/ · https://github.com/starc007/ui-components
- https://transitions.dev/
- https://www.rareui.com/
- https://ui.shadcn.com/

Cyberdaddy 的来源、历史 MIT 版本与当前许可见 `references/cyberdaddy-research.md`；不引入它的模拟业务数据。


## 当前会话验证

采用隔离的浏览器上下文与既有虚构快照，所有 API/SSE 均由验证路由拦截，非 GET 请求被阻止。覆盖机器人空闲、回复中、空状态、任务执行、待反馈与问答回执；检查展开/收起、输入和禁用、真实点击命中、装饰穿透、六尺寸布局以及光谱与波形实际变化。

当前呈现和边界见 [conversation-polish.md](./conversation-polish.md)，最终结果集中保留在 [verification.md](./verification.md)、[premium-interaction-report.json](./premium-interaction-report.json) 和正式截图，避免保留失效版本的参数记录。
