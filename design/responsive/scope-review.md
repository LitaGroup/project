# 非任务区响应式范围审查

基线：Git HEAD `9dc32b8`。范围：本轮新增的 16 个列表页、12 个详情/表单页，共 **28 页**；另核对 Layout、新 ResponsiveTable 与两份响应式 CSS。此前任务视觉变化见上一级 scope-review.md，本报告区分本轮新增范围。

**结论：通过，当前无待修复问题。** 28 页完整 AST 在仅去除 import 与 className 后一致。原请求、hooks、处理函数、数据转换、条件、路由、文本和表格内容保持原样；新增部分负责布局、滚动、换行与原生编辑器暗色 token。

16 个列表页由本 Agent 实施后自查；12 个详情/表单页、Layout 与通用组件/样式进行交叉审查。本轮审查未修改产品源码。

## 精确计数

所有下列原项目与当前逐项一致：

| 检查项 | 16 列表页 | 12 详情/表单页 | 合计 |
| --- | ---: | ---: | ---: |
| hooks 完整调用、回调及依赖 | 133 | 312 | **445** |
| JSX 事件属性 | 89 | 247 | **336** |
| to/href/target/rel 链接属性 | 40 | 71 | **111** |
| 静态 JSX 文案 | 164 | 545 | **709** |
| API/fetch/EventSource/WebSocket 调用表达式 | 53 | 38 | **91** |
| if/三元/逻辑与空值条件表达式 | 316 | 783 | **1099** |
| Table 完整 props 与子节点 | 16 | 15 | **31** |
| 含中文的字符串/模板片段 | 196 | 433 | **629** |

另核对 784 个原变量声明所在的完整语法树；除布局 className 外内容一致。所有原操作的 disabled、readOnly、value、items、render、问答/提交/编辑/删除/运行条件均包含在完整 AST 比较中。

列表页（16）：Projects、Tests、Checks、Exports、Documents、Schedules、Defects、Resources、Milestones、Commits、Scripts、Apps、Repos、UserList、ProjectTests、ProjectDefects。

详情/表单页（12）：CheckRun、DefectDetail、DocumentDetail、ExportRun、KnowledgeBrowser、KnowledgeSearch、Overview、Profile、ProjectDetail、ScheduleDetail、Settings、TestRun。

## 新增实现与任务区隔离

- 28 页仅修改 import/className。22 页将原 Table 命名导入替换为 ResponsiveTable as Table；原 31 个 Table 的 props 与子节点完整一致。
- ResponsiveTable 为一个滚动外壳 div 加原 Appica Table，使用 ComponentProps<typeof Table> 并透传全部 props/children；无 hooks、状态、事件或请求。
- Layout 本轮仅新增 main 的 data-section={activeSection.key}，沿用原已计算的区段；未新增路由判断、状态或导航操作。
- 非任务 workspace 才建立命名容器。toolbar、表格、页头、分栏、Crepe 暗色变量由非任务区或本轮页面专属类限定。
- 任务页面未接入 ResponsiveTable 或本轮页面专属类；新的 portal 样式全部限定为 body 内存在非任务 square-page 时生效。本轮没有新增任务区 JSX/业务或任务光效改动。
- 当前两份响应式 CSS 无 display:none、visibility:hidden 或透明度归零规则隐藏原操作；弹窗内容可滚动，目录与侧栏使用重排。

## 已发现并修复的问题

1. 文档目录原本在 lg 及以上可见，新 CSS 曾在 workspace<=64rem 时额外隐藏。现改为编辑器布局纵排、目录移到上方，目录宽度 100%、最大高度 10rem；保留原 DocToc 的可见断点与点击逻辑。
2. portal 规则原为全局，会改变任务区弹窗。现所有 dialog、alert-dialog、select、dropdown、popover、autocomplete 规则均以 body:has(.square-page:not([data-section='tasks'])) 限定。

后台 Chromium 使用当前响应式 CSS 与隔离基准样式验证上述修复：

- 视口 1100px、workspace 700px：目录 display:block、order:-1、width:700px、max-height:160px；编辑器布局为 column。
- 视口 390px、任务区：弹窗外壳 padding:16px、header padding:24px、title font-size:24px，保留基准。
- 相同视口、非任务区：分别变为 12px、16px、20px，响应式规则生效。

此验证覆盖 CSS 级联与作用域；真实页面截图矩阵由主 Agent 汇总。

## 补查：ApipostDocViewer 组件

此项单独列为 **1 个组件**，保留以上 **28 页**及其统计，不合并为 29 页。

与 HEAD 比较，ApipostDocViewer 仅替换 ResponsiveTable as Table 导入并新增 3 个布局 className；移除 import/className 后完整 AST 一致。组件的 **5 个 hooks、3 个事件属性、3 个链接属性、19 段静态 JSX 文案、95 个条件表达式、40 个变量声明**均一致；**2 个 Table 的全部 props 与子节点**完整一致。parser、schema 展开、搜索、selected 派生和选择事件均保持原样。

新增 CSS 仅在非任务 workspace<=60rem 时将接口目录与详情上下排列，目录宽度 100%、最大高度 18rem，详情最小高度 26rem；未隐藏原目录、接口按钮或正文。组件定向 oxlint 与 git diff --check 通过；本补查未修改产品源码。

## 范围与收尾

backend/、frontend/src/lib/api.ts、frontend/src/context/、frontend/src/App.tsx、根目录/前后端 package.json、pnpm-lock.yaml、pnpm-workspace.yaml 与 HEAD 无差异。此前用户明确要求的 dark/always-motion UI 配置沿用原审查结论。

git diff --check 通过。16 列表页定向 oxlint 已通过；本报告未重复主 Agent 的全量构建与浏览器矩阵。审查用后台 Chromium 已关闭，未创建额外下载、截图或临时文件。
