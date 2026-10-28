# 会话与品牌 UI 阶段范围审查

本文件保留会话阶段的审查快照；最终提交范围及编辑器配色修正见 [final-diff-review.md](./final-diff-review.md)。

**阶段结论：通过。** 本轮只调整会话布局、材质与活动装饰，并按用户最新明确授权更新共享兔子 LOGO、机器人 fallback 及右上 AI 四芒星图形。任务看板卡片、光圈和业务逻辑保持原样。未提交。

本报告就地更新为当前版本；全站响应式审查见 responsive/scope-review.md。

## 允许的 UI 改动界限

- 调试页将原身份栏、会话与待办整理为一体布局，收紧头像、消息标题和输入区间距；按宽度改列数与待办区域高度。原组件、文本、操作、状态均保留。
- 会话头像无描边，仅保留运行时低亮局部光；思考/工具活动与输入 focus 光效均为局部呈现，AiEnergy/AiWaveform 仅为 aria-hidden 装饰。
- 共享品牌四格图形改为项目兔子。机器人仅将原黑图 fallback 改为兔子；avatarUrl 图片优先和加载失效后的 AvatarFallback 机制保留。
- 右上 AI 标记是外部静态 SVG 四芒星图形，无字母标记、无新增产品文案。index.css 仅删除已无引用的旧黑图规则与约定注释。
- 不新增功能、入口、设置、流程、业务图表/指标或模拟数据；不改变 API、处理函数、权限、操作条件与数据转换。

## 快照与保护范围

实现前保存 frontend/src 下 **93 个 TS/TSX/CSS 文件** SHA-256及 7 个关键文件 AST 指纹。最终 **84 个原文件完全未变，9 个原文件变化**；新增 AiEnergy.tsx/ai-energy.css、RabbitIdentity.tsx/rabbit-identity.css 共 4 个展示源文件，以及 PNG/SVG 各 1 个授权/原创资产，无原文件删除。

9 个变化文件为 Layout.tsx、SurfaceEffects.tsx、TaskChatPanel.tsx、WorkerDebugPage.tsx、WorkerAvatar.tsx、ai-conversation.css、index.css、WorkersLivePage.tsx、WorkersPage.tsx。后两页仅增加 working 展示映射及头像防裁切样式。

TaskSidePanel、全部 28 个响应式页面、ApipostDocViewer 及以下保护文件均与本轮快照完整哈希一致：

| 文件 | SHA-256 |
| --- | --- |
| pages/TasksPage.tsx | `e85d3fc7d60ff395e9ab4b32b48938e4dbd9ca2505279c532481ff86c8ca7f7a` |
| pages/TaskCenterPage.tsx | `12eb1a60f124b79bfc83b5de0368f744deb5bc5f7c6a71bcb2240b1f08393085` |
| components/BorderGlow.tsx | `2181e52fbf85a2f8a466997c9f7e9051e58ee0b91ec07685713df14e25868bb1` |
| components/border-glow.css | `df49c0b7f70ed26588969d23b57d655a3a3ba28ddffd2c67631d7bf951ff3761` |
| components/gemini-glow.css | `60362d44a881e0143fc8de5586a2ae4fb9ed9a9a8176621953c3e9b3dc98b3c9` |
| styles/premium-ui.css | `d21fd141b7a331930a387722b0c64c04569b0d114561ed60f500f48be5624f24` |
| styles/responsive.css | `d33964906c5ec59e4e5a1af24a8d64bf87794ac165c932f99c8dbb85f5ce826b` |
| styles/responsive-details.css | `b89f2d4db4616f5bda4b04e5b70d7ac713e4dc4ea28e302c97874f12d9e55297` |

Layout 的品牌 import/markup、index 旧黑底规则删除、SurfaceEffects 的 3 个目标选择器扩展，分别在内存逆向后精确匹配本轮原文件哈希，证明其余部分未变。

## 原业务 AST

Layout、TaskChatPanel、TaskSidePanel、WorkerDebugPage、TasksPage、TaskCenterPage 共 **6 个原业务文件**，下列数组与本轮基线逐项一致：

| 检查项 | 数量 |
| --- | ---: |
| hooks 完整调用、回调与依赖 | **52** |
| JSX 事件属性 | **29** |
| to/href/target/rel 链接属性 | **13** |
| 静态 JSX 文案 | **79** |
| API/fetch/EventSource/WebSocket 调用表达式 | **10** |
| disabled/readOnly/value/name/placeholder 等操作属性 | **77** |
| if/三元/逻辑与空值条件（排除纯样式属性） | **243** |
| 无 JSX 的变量声明 | **146** |
| 含中文字符串/模板片段 | **172** |

SSE、assistant-ui runtime、消息转换、问答提交/跳过、发送/重置、日志展开、任务验收/取消、筛选与数据派生均保持原样。data-running/data-status 只映射已有状态。

SurfaceEffects 另有 **1 个原视觉 useEffect**，完整 effect 调用 AST 指纹未变；仅选择器常量追加 .ai-reasoning、.ai-session-header、.ai-tool-chip。passive、坐标写入与卸载清理保留，无新 hooks/请求/定时器。

WorkerAvatar.tsx 与原 HEAD 的完整 AST 在仅移除 import/className、规范化 RobotAvatar 的授权 fallback 子节点后相同。原函数签名、所有 props/default、avatarUrl 条件及 AvatarImage 的 src/alt、用户/系统头像与 SenderLine 保持原样；继续由原 Appica/Base UI 管理图片失败 fallback。

## 兔子来源与图形检查

源图：/Users/jerry/Documents/GitHub/www-lita-cool-original/public/pwa-512x512.png。

交付：frontend/src/assets/lita-rabbit.png。

两图均 **512×512、12,998 字节**，SHA-256 完全一致：

`1f866055c1188b4e453827c63e8e48c0278f12487a7568bfae72fb1ab6e15ecc`

四芒星位于 frontend/src/assets/ai-symbol.svg，为 558 字节静态图形，无 text/script/外部资源。通过 img 引用，SVG 内部 gradient ID 不进入页面 DOM，多实例无 ID 冲突。RabbitIdentity 无 hooks、事件或请求，整体 aria-hidden、img alt 为空且不可拖拽；原品牌链接文本保留。

后台 Chromium 解码验证 PNG/SVG 分别为 512×512、24×24；两个重复标记均无文字子节点，页面内 spectrum ID 数为 0。兔子与符号 pointer-events:none，品牌点击正常收到 1 次事件。

## 用户授权的 working 标记动效

右上 AI 四芒星仅在原有工作状态下执行慢→快的 5 圈旋转，随后停留，再循环。选择器仅为包含 active AiEnergy 的头像框，或 data-working=true 内的机器人兔子头像；共享 LOGO 与 idle 标记静止。

WorkersLivePage 沿用原 working 常量，Card 增加 data-working；WorkersPage 沿用原已展示的 liveStatus，TableRow 增加 data-working，姓名容器仅调整 min-width/padding/overflow，内部姓名 truncate 保留。两页仅去除 className 与新增 data-working 后，完整 AST 与 HEAD 相同；合计 **8 hooks、2 事件属性、4 链接、36 段静态 JSX 文案、6 API 调用**均保持，不合入前述6文件基线计数。

独立 Chromium 检查 animation/effect keyframes：LOGO 与 idle 为 animation:none；工作行与运行会话为 ai-symbol-burst、10s。0/18/35/45/55/68/100% 对应 0/90/450/900/1440/1800/1800deg，最后3.2s保持同角度；装饰 pointer-events:none。未增加状态、计时器、业务计算或操作。

## CSS 与伪层交互验证

作用域仅为会话与新身份组件专属类；新增 :has 只根据原运行消息/fallback 选择呈现，不命中任务看板。display:none 仅用于旧装饰光晕和新波形的多余柱条，不隐藏产品文本或操作。

独立后台 Chromium 使用当前源 CSS 验证：

- reason、send、reset 与品牌四个隔离控件各收到 1 次点击。
- 局部光、兔子/四芒星、composer、reasoning 与会话头的装饰层均 pointer-events:none。
- 头像框和 Avatar 的 border 均为 0px、背景透明、框阴影为 none；局部光 idle opacity=0、active opacity=0.16、filter=blur(8px)、无 mask/边线，focus composer 保留有效渐变。
- disabled 发送按钮保持原生禁用，背景 rgb(38,38,38)、文字 rgb(115,115,115)。
- error/running/success 分别保留 rgb(253,164,175)、rgb(147,197,253)、rgb(52,211,153)。
- 加入本轮会话/身份 CSS 前后，任务看板 header/card 的计算背景、边框、padding、阴影相同；共享品牌图形变化已获用户明确授权。

过程中发现并修复的谱变量缺失/根 padding 误套问题已关闭。最终会话 pane 保留中性边缘，活动集中于低亮局部光、消息与输入焦点。上述隔离检查覆盖 CSS 级联与点击层；真实页面和完整尺寸矩阵由主 Agent 汇总。

最后两项修正仅涉及头像展示组件/CSS及调试页局部高度：<768px 的 main:has(.ai-debug-page) 固定 flex:none/min-height:0 与原 100dvh-164px 高度，<1100px 的原会话区使用显式 clamp 高度、workspace 两行 max-content 保留滚动。360×800 的隔离 CSS 实测 main=636px、flex=0 0 auto、min-height=0px；chat=448px、min-height=0px；两行分别448px/200px、align-content:start。不隐藏待办或输入操作，不修改全局响应式文件。再次核对 15 个原源码/保护文件哈希与上一最终审查一致，业务 AST 结论保留。

## 范围与资源收尾

backend/、frontend/src/lib/api.ts、frontend/src/context/、frontend/src/App.tsx、根目录/前后端 package.json、pnpm-lock.yaml、pnpm-workspace.yaml 与 HEAD 无差异；git diff --check 通过。既有 Beautiful UI/beUI 许可仍保留，新装饰和四芒星无新增依赖。

资源收尾完成：主 Agent 已清理本轮 ai-deep、ai-energy、ai-gallery 共38个临时文件，移除空 work 目录。独立复核 **work 不存在**，frontend/dist 与 tsconfig.app/tsconfig.node 配置指向的两份 tsbuildinfo 均不存在；暂存区为空，HEAD 仍为 9dc32b8，git diff --check 通过。正式来源图/notes、当前截图/矩阵、可复现验证脚本与许可保留，会话图与报告在原路径更新。

最终证据：[会话与交互验证](./ai-deep-verification.json)、[源码审计](./ai-deep-source-audit.json)、[11秒工作态录屏](./screenshots/robot-conversation-motion.mp4)。正式截图55/55、会话矩阵36/36、空状态2/2、指定worker1入口2/2、交互6/6及图形运动6/6均通过。三份证据文件均可读取，两个JSON可解析；录屏独立核对为H.264、1440×1000、30fps、330帧、11秒、457045字节，SHA-256与报告一致。源码审计保留20个保护文件与181个后端文件哈希一致的记录。

本次审查未修改产品源码或提交；后台 Chromium 已关闭，未生成额外下载、截图或临时脚本。
