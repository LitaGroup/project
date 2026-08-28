# AGENTS.md

以 AI 为中心的项目管理平台。AI（agent 会话）是核心参与者而非附属功能，设计时优先考虑 agent 的可操作性。

## 技术栈

- **前端** `frontend/`：Vite + React 19 + Appica UI（`@appica/ui-react`）+ Tailwind CSS v4
- **后端** `backend/`：NestJS（strict TS）+ TypeORM + MySQL（mysql2）
- **集成**：飞书开放平台（自建应用 tenant_access_token，仅读取）
- 包管理：pnpm（pnpm-workspace，成员为 `frontend`、`backend`）

## 命令

根目录封装脚本（等价于 `pnpm -C <dir> <script>`）：

| 操作 | 命令 |
|---|---|
| 起后端（需 MySQL 已启动且有 `.env`） | `pnpm dev:backend` → http://localhost:3000/api |
| 起前端 | `pnpm dev:frontend` → http://localhost:5173（`/api` 已代理到 3000） |
| 构建 | `pnpm build` |
| lint | `pnpm lint` |
| 后端单测（jest） | `pnpm test` |

后端 `.env` 已配置测试 RDS（`lita-test...rds.amazonaws.com` 的 `project` 库），可直接用；格式见 `backend/.env.example`。
TypeORM `synchronize` 仅在非 production 开启，**上生产前必须改 migrations**。

**数据库权限坑**：该 RDS 账号（`feng.hu`）无 `REFERENCES` 权限，`synchronize` 建物理外键会失败，因此 `Document → Project` 关系用了 `createForeignKeyConstraints: false`（无 DB 级外键/级联，删除需应用层处理）。若后续账号获得授权，可移除该选项恢复物理外键。

## 目录结构

- `docs/`：项目文档与资料（现有 `product-overview.md`）
- `frontend/`：前端代码，入口 `src/main.tsx`（ThemeProvider）、路由 `src/App.tsx`（react-router v7）
  - `src/components/Layout.tsx`：顶栏 + 左侧导航（概览/项目/用例/检查/缺陷(占位)/文档/脚本/任务/设置）+ 内容区布局；`StatusBadge.tsx`：状态 → Badge variant 映射；`PageBreadcrumb.tsx`：页面顶部面包屑（全局列表 → 所属项目 → 当前页，详情页统一使用，替代原"返回项目详情"链接）；`RunStats.tsx`：运行统计展示（success 绿 / fail 大于 0 红、为 0 绿 / total 默认色，任务列表与项目详情任务表共用）
  - `src/pages/`：`OverviewPage`（/，SKILL 安装指引（在线地址 + opencode 安装命令 + 免安装用法）+ 常用使用方法 + 核心功能（文档中心/脚本调度/定时任务/缺陷流程）+ 进行中项目）、`ProjectsPage`（/projects，列表 + 新建/删除）、`ProjectDetailPage`（/projects/:id，项目信息 + 文档列表 + 检查列表 + 测试列表 + 任务列表 + 缺陷列表）、`CheckRunPage`/`TestRunPage`（检查/测试运行详情）、`TaskDetailPage`（/projects/:id/tasks/:taskId，任务详情：任务信息 + 该任务触发的运行）、`TestsPage`/`ChecksPage`（/tests、/checks 全局列表：编号/描述/脚本/项目四列，支持编号、描述、脚本名模糊搜索）、`DocumentsPage`（/documents 全局文档列表：标题/类型/来源/项目四列，支持标题模糊搜索 + 类型/来源筛选，来源 `-` 显示为"手写"）、`TasksPage`（/tasks 全局任务列表：标题/计划/脚本/项目/运行五列，运行列展示 success/fail/total 统计，支持标题与脚本名模糊搜索）、`DefectsPage`（/defects 全局缺陷列表：描述/端/状态/人员/项目五列，支持描述模糊搜索 + 状态筛选）、`DefectDetailPage`（/projects/:id/defects/:defectId，缺陷详情：问题描述 + 截图 + 端/状态/测试脚本编辑 + 运行验证）、`ScriptsPage`（/scripts，脚本根目录下全部 .check.ts/.test.ts，脚本/类型/项目三列，支持路径模糊搜索，所属项目取登记了该脚本的检查/用例，未登记显示 —）、`AppsPage`（/apps，agent 包目录安装包列表：APP/环境/平台/版本/文件/操作六列，产品·环境从文件名 `{产品}.{环境}.*.apk` 解析，版本搜索 + 产品/环境/平台筛选，文件名倒序，操作远程安装/卸载到对应模拟器；右侧为受管模拟器面板：agent 动态发现的在线模拟器 × 受管包的已装环境/版本）、`SettingsPage`（/settings，设置：脚本目录 + 运行环境与访问域名 + Appium Agent 连接信息 + 图片与飞书集成）。全局列表数据走 `GET /api/{checks,tests,documents,tasks,defects}`（projectId 均可选，不传返回全部）
  - `src/lib/api.ts`：API 客户端与类型，枚举与后端 `common/enums.ts` 保持同步
- `backend/`：后端代码，入口 `src/main.ts`（全局前缀 `/api`、CORS 全开）
  - **`.md` URL 规范**：路径加 `.md` 后缀返回 Markdown 视图（`text/markdown`）。`GET /api/documents/:id.md`（文档元信息 + 正文）；`GET /api/projects/search.md?q=`（名称模糊搜索，匹配度分级 > 创建时间倒序，前 5）；`GET /api/projects/:id.md`（项目描述 + 文档/检查/测试/任务清单——检查/测试条目含运行命令与最近运行结果/记录链接、任务条目含上次/下次执行时间与上次结果；末尾"AI 操作"小节说明用法）；`POST /api/tasks/:id/run.md`（手动触发任务并流式返回）；`GET /api/{checks,tests}/runs/:runId.md`（单次运行详情：元信息 + 结果 + 输出全文）；`GET /api/settings.md`（设置 Markdown 视图，独立控制器 `SettingsMarkdownController` 挂载单段路径）；`POST /api/settings/scripts/pull.md`（脚本更新流式返回 git 输出 + 结果）。路由须声明在 `:id` 之前避免参数匹配冲突
  - `src/common/enums.ts`：领域枚举（见下，勿改名）
  - `src/common/paths.ts`：`imageWebroot()` 读取全局变量 `DIR_IMAGE_WEBROOT`（图片上传后的本地根目录，默认 `<项目根>/images`）；`main.ts` 将该目录静态挂载到 `/images`（不走 `/api` 全局前缀），经 `http://{host}/images/{image-path}` 访问，前端 dev server 已代理 `/images`
  - `src/feishu/`：飞书只读客户端 + `GET /api/feishu/read?url=` 预览
  - `src/projects/` / `src/documents/`：实体与 CRUD，`POST /api/documents/sync-feishu` 为一键同步入口；文档列表查询（`GET /api/documents`、项目详情的关系数据）用 `DOCUMENT_LIST_SELECT` 排除 longtext 正文，正文仅经 `GET /api/documents/:id` 单独返回
  - `src/checks/`：检查（Check）登记管理，`GET /api/checks/scripts?q=` 扫描脚本目录供自动联想
  - `src/tests/`：测试（Test），与检查结构一致（登记/自动导入/运行/SSE/历史），唯一区别是脚本后缀为 `.test.ts`，表为 `tests` / `test_runs`
  - `src/tasks/`：任务（Task），定时调度检查脚本（见领域模型"任务"）
  - `src/defects/`：缺陷（Defect），与项目设置的飞书多维表格双向绑定（见领域模型"缺陷"）
  - `src/notify/`：运行结果通知。**仅任务（Task）触发的检查运行发通知**，测试与手动检查运行一律不发。`NotifyService` 在任务触发的运行开始前推送"开始执行"卡片（`notifyTaskRunStart`，含触发方式）、终态时推送执行结果（`notifyTaskRun`）到飞书群机器人 webhook（webhook 取项目 `feishuWebhook`——只存群机器人 hook 地址的 secret 部分，发送时拼接完整地址；未配置回退 `FEISHU_WEBHOOK_URL` 环境变量，都为空则跳过；飞书业务失败可能返回 HTTP 200，需看响应体 `code`/`StatusCode`）
  - `src/settings/`：平台设置。`GET /api/settings` 返回 `{scriptsDir, appUrl, apiUrl, agent}` 等（scriptsDir 即 CHECK_SCRIPTS_DIR，appUrl/apiUrl 取 `APP_URL`/`API_URL` 环境变量，默认 `http://localhost:5173` / `http://localhost:{PORT}/api`；`agent` 为 appium-agent 实时连接信息 `{online, name, appiumUrl}`，appiumUrl 是 agent 经 ready 消息上报的 appium 内网地址——agent 侧把 APPIUM_URL 的回环 host 替换为本机内网 IP，离线时为 null）；`POST /api/settings/scripts/pull` 在脚本根目录执行 `git pull`（超时 60s），返回 `{output}`
  - `src/agent/`：appium-agent 连接层（`AgentGateway`，ws 挂 `/api/ws`（挂在 /api 前缀下，生产反代一条 /api 规则即可覆盖，仍需 Upgrade 头），见 docs/APPIUM-AGENT.md）+ APP 包管理端点（`AgentAppsController`，独立 `AgentAppsModule` 挂载以避免与 RemoteRunModule 循环依赖）。拓扑：1 个 appium-server 进程管多个模拟器（实际常驻 Android/iOS 各一），下发 task 携带 `device`（platform）+ `appTarget`（lita/lite，取自 appVersion，无则 null），agent 执行前前置校验（`preflightRunTarget`）：模拟器未启动或 APP 未安装直接回 error 终态（message 即原因），不进脚本执行。`/api/agent/apps`：`GET` 扫描 agent 包目录（AGENT_APPS_DIR，开发环境 `/Users/monkee/workplace/hufeng/files`）下的 .apk/.ipa，返回 `{file, platform, size, updatedAt, packageId, version, installedVersion, simulator}`（apk 包名/版本由 agent 侧 aapt 解析，installedVersion 实时查对应模拟器）；`GET /simulators` 受管模拟器实时状态（agent 经系统命令动态发现在线模拟器：android `adb devices` / ios `xcrun simctl list devices booted`，每平台一台；`AGENT_PACKAGES` JSON 声明 platform/product/packageId 包名映射，返回 在线模拟器 × 受管包 的机型 + 已装版本 + 环境）；`POST /install {file}` 安装（按 platform 路由到对应平台的在线模拟器，记录来源环境到 agent 状态文件，按 平台:包名 记录）；`POST /uninstall {packageId, platform}` 卸载（清除安装记录）；`GET /installed?packageId=&platform=` 查模拟器内已装版本。实现为 WS 请求-响应（`app` 指令 + `app-result` 应答，reqId 关联，`AgentGateway.requestAppOp`，agent 报错映射 502 透传）；与远程任务互斥：任务执行中 409，APP 操作期间 RemoteRunService 暂停派发、完成后 kickDispatch
- `examples/`：调用案例（`feishu-api.md` 有 curl 示例与所需飞书权限清单）
- `skills/project-manage/SKILL.md`：项目管理平台 Agent 技能说明（搜索/详情/运行/设置各 `.md` 端点用法），随代码维护，可安装到 `~/.opencode/skills/`；经 `frontend/public/SKILL.md` 符号链接暴露为 `http://{host}/SKILL.md`（dev 直接服务，build 时拷入 dist），Agent 可直接拉取该地址学习平台用法

## 领域模型（已确认，勿改名）

枚举值直接用中文原文存储，见 `backend/src/common/enums.ts`：

- **文档类型**：需求 / 功能 / 测试 / 技术 / 接口 / 配置
- **文档来源**：飞书（单向：飞书 → 平台，不回写）/ `-`（平台内直接编写）
- **项目类型**：活动 / 功能 / 游戏 / 数据 / 后台 / 技术 / 其它
- **项目状态**：计划中 / 进行中 / 已结束 / 暂停（`ProjectStatus`，默认"计划中"；同步映射见"飞书项目同步"）
- 项目另有 `expectedReleaseAt`（预期发布时间，date 可空）与 `feishuWebhook`（飞书通知群：群机器人 webhook 的 secret，可空，`PATCH /api/projects/:id` 设置，粘贴完整 hook 地址自动截取 secret，在项目详情页右侧"飞书通知群"处编辑）；`PATCH /api/projects/:id` 还可改类型/状态/优先级/迭代周期/预期发布时间（项目详情页右侧默认仅展示，点标题旁「编辑」进入编辑模式后可直接改：类型/状态/迭代/优先级均为下拉选择（迭代/优先级的选项取自 `/projects/page` 的全平台去重取值，选"未设置"清除）、预期发布日期选择即时保存，脚本目录/飞书通知群/缺陷表格的"设置"入口也只在编辑模式出现；注意飞书同步项目的这些字段会在下次同步时被飞书侧覆盖）；删除项目走 `DELETE /api/projects/:id`，应用层级联删文档与检查；删除文档走 `DELETE /api/documents/:id`（204）
- **检查（Check）**：归属项目，本质是一个脚本的登记信息，字段为 `code`（编号，手工定义，项目内唯一）、`description`（脚本检查的内容）、`scriptPath`（相对脚本根目录的 `.check.ts` 路径，拒绝绝对路径与 `..` 穿越）。脚本根目录由 `CHECK_SCRIPTS_DIR` 配置（开发环境 `/Users/monkee/workplace/hufeng/scripts`）；项目另有 `scriptsPath`（相对根目录的子目录，`PATCH /api/projects/:id` 设置，在项目详情页右侧"脚本目录"处编辑），`GET /api/checks/scripts?q=&projectId=` 递归扫描该子目录（未配置则扫整个根目录）下所有 `.check.ts`，返回相对根目录的路径（上限 500），前端用 Autocomplete 联想。删除走 `DELETE /api/checks/:id`（204）
  - **自动导入**：`POST /api/checks/import`（body `{projectId}`）扫描项目脚本目录下全部 `.check.ts`，按 `scriptPath` 过滤已登记的，其余全部导入并返回 `{created, skipped}`；`code` 由文件名生成（去 `.check.ts`，冲突追加 `-2`/`-3`…），`description` 留空待补充。前端在项目详情页"检查"板块提供"自动导入"按钮
  - **运行**：`POST /api/checks/:id/runs` 启动一次运行（立即返回 running 记录，脚本后台异步执行）；`GET /api/checks/runs/:runId/stream`（SSE）实时推送运行快照——先推当前状态，`[start]`/`[act]`/`[check]` 触发的进度变化逐条推送，终态推送后自动完成流（内存 live 快照 + EventEmitter 实现，终态快照保留 5min 供晚订阅；无 live 句柄时读库、running 则 2s 兜底轮询）；`GET /api/checks/runs/:runId` 单次运行详情（REST 兜底）；`GET /api/checks/:id/runs` 运行历史（倒序，上限 50）。**AI 用一步式运行**：`POST /api/checks/:id/run.md` 启动运行并以 text/markdown 流式返回——先头部信息，运行中逐行追加脚本原始输出，终态附"结果"小节（状态/进度/成功失败跳过数/耗时/消息）后结束响应，实现见 `src/common/run-markdown.ts`（客户端断开自动退订）。执行为 `node` 直跑 `.check.ts`（Node 24+ 类型擦除，以脚本根目录为 cwd，超时 120s SIGTERM），逐行解析 stdout 行协议 `[{type}] {json}`（协议见 scripts 仓库 AGENTS.md）。运行记录落 `check_runs` 表（status: running/success/fail/error，含 total/current/success/fail/skip、message、durationMs、items/logs/output JSON、startedAt/finishedAt；output 为脚本原始输出行，运行中实时累积、结束落库），删除检查/项目时应用层级联删除。前端详情页 `/projects/:id/checks/:checkId`：左侧为终端样式面板（Gruvbox Dark 主题，配色集中在 `index.css` 的 `.terminal-gruvbox`，是有意脱离角色 token 的例外；原样打印脚本输出行，按协议类型着色：失败红/跳过黄/start/done 青/日志灰，运行中实时追加并自动滚底），右侧上为运行状态卡（状态/总步数/当前步数/进度/耗时/消息），右侧下为历史记录（最近 5 条，运行时间/结果两列无标题行，点击切换查看，EventSource 订阅 SSE）；检查列表"运行"按钮启动运行并跳转该页
- **飞书项目同步**：`POST /api/projects/sync-feishu` 从"研发项目管理"多维表格增量同步（源链接见 `project-sync.service.ts` 的 `DEFAULT_SOURCE_URL`，可用 `FEISHU_PROJECT_SOURCE_URL` 覆盖）。首次同步取近 15 天更新，后续取近 7 天，按 `sync_states` 表的 `lastSyncAt` 判定；判重按 `projects.feishuRecordId`。同步字段：需求→标题、需求类型→type（`Admin` 别名映射为"后台"）、优先级、理想上线时间→expectedReleaseAt、w→iterationCycle（归一化为 `w{n}: MM/DD-MM/DD`：全角冒号/大写 W/空格变体统一、日期后缀过滤，需求池/待排期等无法识别的一律为 `-`，见 `toIterationCycle`）、前端/后端/测试人员→resources、需求状态→status（✅ 已上线→已结束、正常→进行中、暂停→暂停，有风险/Delay/空值/乱填一律归"计划中"）
- **测试（Test）**：与检查（Check）结构完全一致，唯一区别是脚本后缀为 `.test.ts`。接口与前端交互一一对应：`GET /api/tests/scripts?q=&projectId=` 扫描联想、`POST /api/tests/import` 自动导入、`POST /api/tests/:id/runs` 启动运行、`POST /api/tests/:id/run.md` AI 用一步式运行（同检查，text/markdown 流式返回）、`GET /api/tests/runs/:runId/stream`（SSE）实时进度、`GET /api/tests/runs/:runId` 详情、`GET /api/tests/:id/runs` 历史、`DELETE /api/tests/:id`；删除项目/测试时应用层级联删 `test_runs`。前端详情页 `/projects/:id/tests/:testId`（布局同检查运行页）
- **任务（Task）**：归属项目，按 crontab 表达式定时运行一个已登记的检查脚本。字段：`title`（标题）、`cron`（crontab 表达式，5 段"分 时 日 月 周"或 6 段"秒 分 时 日 月 周"，不支持年；创建/更新时用 cron 包校验，非法 400）、`checkId`（须为本项目已登记检查，否则 400/404）、`enabled`（默认 true，停用不参与调度）、`lastRunAt`（最近触发时间）、`runCount`（已运行次数，触发即累计含失败）；`/api/tasks` 响应附带 `nextRunAt`（下次执行时间，按 cron 实时计算不落库，停用为 null；项目详情的关系数据无此字段，前端任务列表走 `GET /api/tasks?projectId=`）与 `runStats`（运行统计 `{success, fail, total}`，fail 含 error，仅列表接口附带，前端"运行"列展示为 `success/fail/total`）。接口：`POST /api/tasks`、`PATCH /api/tasks/:id`、`DELETE /api/tasks/:id`（204）、`GET /api/tasks/:id`（详情，额外带 `nextRuns` 未来 5 次执行时间）、`GET /api/tasks/:id/runs`（该任务触发的运行历史）、`POST /api/tasks/:id/run`（手动立即触发，不受 enabled 限制）。调度用 `@nestjs/schedule` 的 `SchedulerRegistry` + `cron` 包 CronJob（服务启动时注册全部启用任务，增删改实时同步调度器），到点调用 `ChecksService.startRun(checkId, taskId)`，结果落 `check_runs`（`taskId` 列标记触发来源，手动运行为 null，与手动运行其余字段一致）。**任务触发的运行（含手动触发任务）开始时推送飞书群"开始执行"卡片**（正文 `**[执行]**`（蓝色 font 标签）+ `{任务标题} - {手动 或 计划时间：MMdd HH:mm:ss}` + 项目 + 脚本路径；触发方式由 `TasksService.runNow(source)` 透传，调度为 schedule、手动为 manual），**到终态后推送飞书群结果卡片**（成功/失败/异常/超时都推，见 `src/notify/`）：`**[成功]**`（绿色）/ `**[失败]**`（红色）+ `{任务标题} - {手动 或 计划时间：MMdd HH:mm:ss}`（计划时间按运行开始时间格式化）+ 项目 + 脚本路径 + `**详情**：共计**n**条，成功**x**条，失败**y**条（y=0 绿色 / >0 红色），跳过**z**条` + `**描述**：{成功为"执行成功"，否则为 message}`；异常结束时计数缺失则按已解析明细条数兜底，超时 message 必含"脚本执行超时"字样。前端任务详情页 `/projects/:id/tasks/:taskId`（点击任务标题进入，布局同检查运行页：左侧终端、右侧运行状态 + 该任务的运行历史，"运行"按钮手动触发）。无物理外键：删除检查/项目时应用层级联删任务（先摘除调度）；删除任务保留其已产生的运行记录
- 项目管理下的能力：功能测试（见上）、定时任务（见上"任务"）；线上检查已实现登记管理（见上）
- **缺陷（Defect）**：归属项目，与项目设置的飞书多维表格**双向绑定**（项目字段 `defectBitableUrl`，带 table 参数的 wiki/base 链接，`PATCH /api/projects/:id` 设置，在项目详情页右侧"缺陷表格"处编辑）。字段：`title`（问题描述，单行化截断 500，全文存 `description`）、`platform`（端）、`status`（状态）、`assignee`（人员）、`remark`（备注）、`images`（截图路径数组，同步时把飞书 截图/截图2/截图3 三个附件字段合并下载到 `imageWebroot()/defects/{projectId}/{recordId}/`，经 `/images/...` 访问）、`testScript`（测试脚本，相对脚本根目录的 `.test.ts`，可空，仅存本地）、`feishuRecordId`（同步判重/回写用，与 projectId 联合唯一）
  - **状态枚举**：`DefectStatus` = open/reopen/fixed/closed/invalid。飞书侧对应选项为 new/fixed/close/reopen/invalid + 人工乱填项，同步时映射：new→open、close→closed，其余一律映射为 open（平台侧不存其它状态）。回写时反向还原（open→new、closed→close），避免在飞书表新建选项
  - **端**：平台侧只保留 前端/后端/APP端/未知（默认），同步时飞书单选里除前三者外的值统一映射为"未知"；回写时仅真实端（前三者）写飞书，未知不写
  - **飞书 → 平台（手动全量同步，直接覆盖）**：`POST /api/defects/sync`（body `{projectId}`）按 `feishuRecordId` upsert，返回 `{scanned, created, updated}`；覆盖飞书侧字段（含人员、截图），`testScript` 等本地字段保留，飞书已删的记录本地保留
  - **平台 → 飞书（单条回写）**：`PATCH /api/defects/:id` 改状态/端后异步回写该记录的 状态/端 字段（失败仅记日志不阻断，下次全量同步会以飞书为准覆盖）
  - **fixed 前置校验**：改状态为 fixed 时——有 `testScript` 则须该脚本已在本项目用例中登记且最近一次运行 success（否则 400），无 `testScript` 则允许手动改 fixed。`POST /api/defects/:id/verify` 启动一次验证运行（返回 TestRun，进度走测试的 SSE 端点）
  - 其他接口：`GET /api/defects?projectId=`（列表不含 description/images，同 `DEFECT_LIST_SELECT`）、`GET /api/defects/:id`、`DELETE /api/defects/:id`（204，仅删本地）；删除项目时应用层级联删缺陷并清理截图目录
  - 前端：项目详情页"缺陷"板块（列表 + "同步飞书"按钮 + 删除）、缺陷详情页（问题描述按 Markdown 渲染、状态 Select 直接改、端下拉选择、测试脚本从项目已登记测试中搜索选择、"运行验证"按钮跳转测试运行页）

## 工作约定

- **飞书同步约定**：文档/项目同步永远单向（飞书 → 平台），`FeishuService` 以只读方法为主；**唯一例外是缺陷模块**——缺陷状态/端的变更需回写飞书多维表格（`updateBitableRecord`），这是已确认的双向绑定需求。其他"回写飞书"仍是需求变更，先确认。
- **飞书导入的文档不允许本地修改正文**（`updateContent` 会 403），只能通过"更新同步"从源拉取覆盖；`remark`（备注，供 AI 阅读）任何来源都可编辑。
- **导入内容统一为 Markdown**：docx 块级转换（图片块暂不导入，输出 `*[图片暂不导入]*` 占位）；sheets 只导链接 `?sheet=` 指定的工作表；bitable 只导 `?table=` 指定的数据表（`?view=` 生效）。判重 key 含子标识：`docx:<id>` / `sheets:<token>#<sheetId>` / `bitable:<token>#<tableId>`，同一表格不同 sheet 互不覆盖。
- 缺陷管理：已实现（见领域模型"缺陷"）。
- 飞书链接解析支持 `docx/docs/sheets/base/wiki` 五种路径；wiki 节点先经 `resolveWiki` 转成实际资源（query 参数如 sheet/table/view 会从原链接透传）。
- bitable `records/search` 必须传 `automatic_fields: true`，否则响应没有记录级 `last_modified_time`（增量同步依赖它）。
- **飞书 token 统一从 Lita 平台 API 获取**（`POST {LITA_API_HOST}/admin-ai/v1/auth/platform-token/getToken`，header `L-USER-TOKEN`，测试/生产一致），`FeishuService` 启动预热 + 每 30 分钟定时刷新（`@Cron`）；兜底才是 `FEISHU_APP_ID/SECRET` 自建应用模式。不要再引入静态 token。

## Appica UI 硬性规则（违反会静默出错）

权威参考：https://appica.dev/llms.txt ，每个文档页加 `.md` 后缀取 markdown。

- Tailwind v4：`src/index.css` 中必须同时有 `@import '@appica/ui-react/styles.css'`（token）和 `@source '../node_modules/@appica/ui-react/dist';`（扫类名，路径相对该 CSS 文件，写裸包名会静默失效、组件无样式）。
- 必须 React 19；`ref` 是普通 prop，不要 `forwardRef`。
- 子路径导入，一个组件一个 import：`import { Button } from '@appica/ui-react/button'`。
- 禁止手写色值/圆角/时长字面量和 hue 系类名（`bg-gray-100` 等），用角色 token：`bg-background-muted`、`text-foreground-intense`、`border-border-strong`、`var(--radius-md)`。
- 根节点已包 `ThemeProvider`（`main.tsx`），不要移除。
- 组件库里已有的组件不要手写，先查 llms.txt 组件清单。
- Select 的选项 `value` 与展示文案不一致时（如 `all` → "不限状态"），必须给根组件传 `items` 映射，否则弹层关闭后触发器会显示原始 value。
