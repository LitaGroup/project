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
  - `src/components/Layout.tsx`：顶栏 + 左侧导航 + 内容区布局；`StatusBadge.tsx`：状态 → Badge variant 映射
  - `src/pages/`：`OverviewPage`（/，AI 用法说明 + 进行中项目）、`ProjectsPage`（/projects，列表 + 新建/删除）、`ProjectDetailPage`（/projects/:id，项目信息 + 文档列表 + 检查列表 + 测试列表 + 任务列表）、`CheckRunPage`/`TestRunPage`（检查/测试运行详情）、`TaskDetailPage`（/projects/:id/tasks/:taskId，任务详情：任务信息 + 该任务触发的运行）、`SettingsPage`（/settings，设置：脚本目录 + 访问域名）
  - `src/lib/api.ts`：API 客户端与类型，枚举与后端 `common/enums.ts` 保持同步
- `backend/`：后端代码，入口 `src/main.ts`（全局前缀 `/api`、CORS 全开）
  - **`.md` URL 规范**：路径加 `.md` 后缀返回 Markdown 视图（`text/markdown`）。`GET /api/documents/:id.md`（文档元信息 + 正文）；`GET /api/projects/:id.md`（项目描述 + 文档/检查/测试/任务清单，文档条目链接到其 `.md`，检查/测试条目附运行端点，末尾"AI 操作"小节说明用法）。路由须声明在 `:id` 之前避免参数匹配冲突
  - `src/common/enums.ts`：领域枚举（见下，勿改名）
  - `src/feishu/`：飞书只读客户端 + `GET /api/feishu/read?url=` 预览
  - `src/projects/` / `src/documents/`：实体与 CRUD，`POST /api/documents/sync-feishu` 为一键同步入口
  - `src/checks/`：检查（Check）登记管理，`GET /api/checks/scripts?q=` 扫描脚本目录供自动联想
  - `src/tests/`：测试（Test），与检查结构一致（登记/自动导入/运行/SSE/历史），唯一区别是脚本后缀为 `.test.ts`，表为 `tests` / `test_runs`
  - `src/tasks/`：任务（Task），定时调度检查脚本（见领域模型"任务"）
  - `src/settings/`：平台设置。`GET /api/settings` 返回 `{scriptsDir, appUrl, apiUrl}`（scriptsDir 即 CHECK_SCRIPTS_DIR，appUrl/apiUrl 取 `APP_URL`/`API_URL` 环境变量，默认 `http://localhost:5173` / `http://localhost:{PORT}/api`）；`POST /api/settings/scripts/pull` 在脚本根目录执行 `git pull`（超时 60s），返回 `{output}`
- `examples/`：调用案例（`feishu-api.md` 有 curl 示例与所需飞书权限清单）

## 领域模型（已确认，勿改名）

枚举值直接用中文原文存储，见 `backend/src/common/enums.ts`：

- **文档类型**：需求 / 功能 / 测试 / 技术 / 接口 / 配置
- **文档来源**：飞书（单向：飞书 → 平台，不回写）/ `-`（平台内直接编写）
- **项目类型**：活动 / 功能 / 游戏 / 数据 / 后台 / 技术 / 其它
- **项目状态**：计划中 / 进行中 / 已结束（`ProjectStatus`，默认"计划中"）
- 项目另有 `expectedReleaseAt`（预期发布时间，date 可空）；删除项目走 `DELETE /api/projects/:id`，应用层级联删文档与检查；删除文档走 `DELETE /api/documents/:id`（204）
- **检查（Check）**：归属项目，本质是一个脚本的登记信息，字段为 `code`（编号，手工定义，项目内唯一）、`description`（脚本检查的内容）、`scriptPath`（相对脚本根目录的 `.check.ts` 路径，拒绝绝对路径与 `..` 穿越）。脚本根目录由 `CHECK_SCRIPTS_DIR` 配置（开发环境 `/Users/monkee/workplace/hufeng/scripts`）；项目另有 `scriptsPath`（相对根目录的子目录，`PATCH /api/projects/:id` 设置，在项目详情页右侧"脚本目录"处编辑），`GET /api/checks/scripts?q=&projectId=` 递归扫描该子目录（未配置则扫整个根目录）下所有 `.check.ts`，返回相对根目录的路径（上限 500），前端用 Autocomplete 联想。删除走 `DELETE /api/checks/:id`（204）
  - **自动导入**：`POST /api/checks/import`（body `{projectId}`）扫描项目脚本目录下全部 `.check.ts`，按 `scriptPath` 过滤已登记的，其余全部导入并返回 `{created, skipped}`；`code` 由文件名生成（去 `.check.ts`，冲突追加 `-2`/`-3`…），`description` 留空待补充。前端在项目详情页"检查"板块提供"自动导入"按钮
  - **运行**：`POST /api/checks/:id/runs` 启动一次运行（立即返回 running 记录，脚本后台异步执行）；`GET /api/checks/runs/:runId/stream`（SSE）实时推送运行快照——先推当前状态，`[start]`/`[act]`/`[check]` 触发的进度变化逐条推送，终态推送后自动完成流（内存 live 快照 + EventEmitter 实现，终态快照保留 5min 供晚订阅；无 live 句柄时读库、running 则 2s 兜底轮询）；`GET /api/checks/runs/:runId` 单次运行详情（REST 兜底）；`GET /api/checks/:id/runs` 运行历史（倒序，上限 50）。**AI 用一步式运行**：`POST /api/checks/:id/run.md` 启动运行并以 text/markdown 流式返回——先头部信息，运行中逐行追加脚本原始输出，终态附"结果"小节（状态/进度/成功失败跳过数/耗时/消息）后结束响应，实现见 `src/common/run-markdown.ts`（客户端断开自动退订）。执行为 `node` 直跑 `.check.ts`（Node 24+ 类型擦除，以脚本根目录为 cwd，超时 120s SIGTERM），逐行解析 stdout 行协议 `[{type}] {json}`（协议见 scripts 仓库 AGENTS.md）。运行记录落 `check_runs` 表（status: running/success/fail/error，含 total/current/success/fail/skip、message、durationMs、items/logs/output JSON、startedAt/finishedAt；output 为脚本原始输出行，运行中实时累积、结束落库），删除检查/项目时应用层级联删除。前端详情页 `/projects/:id/checks/:checkId`：左侧为终端样式面板（Gruvbox Dark 主题，配色集中在 `index.css` 的 `.terminal-gruvbox`，是有意脱离角色 token 的例外；原样打印脚本输出行，按协议类型着色：失败红/跳过黄/start/done 青/日志灰，运行中实时追加并自动滚底），右侧上为运行状态卡（状态/总步数/当前步数/进度/耗时/消息），右侧下为历史记录（最近 5 条，运行时间/结果两列无标题行，点击切换查看，EventSource 订阅 SSE）；检查列表"运行"按钮启动运行并跳转该页
- **飞书项目同步**：`POST /api/projects/sync-feishu` 从"研发项目管理"多维表格增量同步（源链接见 `project-sync.service.ts` 的 `DEFAULT_SOURCE_URL`，可用 `FEISHU_PROJECT_SOURCE_URL` 覆盖）。首次同步取近 15 天更新，后续取近 7 天，按 `sync_states` 表的 `lastSyncAt` 判定；判重按 `projects.feishuRecordId`。同步字段：需求→标题、需求类型→type（`Admin` 别名映射为"后台"）、优先级、理想上线时间→expectedReleaseAt、w→iterationCycle、前端/后端/测试人员→resources
- **测试（Test）**：与检查（Check）结构完全一致，唯一区别是脚本后缀为 `.test.ts`。接口与前端交互一一对应：`GET /api/tests/scripts?q=&projectId=` 扫描联想、`POST /api/tests/import` 自动导入、`POST /api/tests/:id/runs` 启动运行、`POST /api/tests/:id/run.md` AI 用一步式运行（同检查，text/markdown 流式返回）、`GET /api/tests/runs/:runId/stream`（SSE）实时进度、`GET /api/tests/runs/:runId` 详情、`GET /api/tests/:id/runs` 历史、`DELETE /api/tests/:id`；删除项目/测试时应用层级联删 `test_runs`。前端详情页 `/projects/:id/tests/:testId`（布局同检查运行页）
- **任务（Task）**：归属项目，按 crontab 表达式定时运行一个已登记的检查脚本。字段：`title`（标题）、`cron`（crontab 表达式，5 段"分 时 日 月 周"或 6 段"秒 分 时 日 月 周"，不支持年；创建/更新时用 cron 包校验，非法 400）、`checkId`（须为本项目已登记检查，否则 400/404）、`enabled`（默认 true，停用不参与调度）、`lastRunAt`（最近触发时间）、`runCount`（已运行次数，触发即累计含失败）；`/api/tasks` 响应附带 `nextRunAt`（下次执行时间，按 cron 实时计算不落库，停用为 null；项目详情的关系数据无此字段，前端任务列表走 `GET /api/tasks?projectId=`）。接口：`POST /api/tasks`、`PATCH /api/tasks/:id`、`DELETE /api/tasks/:id`（204）、`GET /api/tasks/:id`（详情，额外带 `nextRuns` 未来 5 次执行时间）、`GET /api/tasks/:id/runs`（该任务触发的运行历史）、`POST /api/tasks/:id/run`（手动立即触发，不受 enabled 限制）。调度用 `@nestjs/schedule` 的 `SchedulerRegistry` + `cron` 包 CronJob（服务启动时注册全部启用任务，增删改实时同步调度器），到点调用 `ChecksService.startRun(checkId, taskId)`，结果落 `check_runs`（`taskId` 列标记触发来源，手动运行为 null，与手动运行其余字段一致）。前端任务详情页 `/projects/:id/tasks/:taskId`（点击任务标题进入，布局同检查运行页：左侧终端、右侧运行状态 + 该任务的运行历史，"运行"按钮手动触发）。无物理外键：删除检查/项目时应用层级联删任务（先摘除调度）；删除任务保留其已产生的运行记录
- 项目管理下的能力：功能测试（见上）、定时任务（见上"任务"）；线上检查已实现登记管理（见上）

## 工作约定

- **飞书同步永远单向**。`FeishuService` 只保留读方法，任何"回写飞书"都是需求变更，先确认。
- **飞书导入的文档不允许本地修改正文**（`updateContent` 会 403），只能通过"更新同步"从源拉取覆盖；`remark`（备注，供 AI 阅读）任何来源都可编辑。
- **导入内容统一为 Markdown**：docx 块级转换（图片块暂不导入，输出 `*[图片暂不导入]*` 占位）；sheets 只导链接 `?sheet=` 指定的工作表；bitable 只导 `?table=` 指定的数据表（`?view=` 生效）。判重 key 含子标识：`docx:<id>` / `sheets:<token>#<sheetId>` / `bitable:<token>#<tableId>`，同一表格不同 sheet 互不覆盖。
- 测试管理 / 检查管理（/checks 全局页）/ 文档管理为"待补充"模块：前端已占位（Badge 标记），**需求未定义，勿自行实现**，先向用户确认范围。（项目级"检查"与"测试"板块已实现，见领域模型；这里指左侧导航的全局管理页）
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
