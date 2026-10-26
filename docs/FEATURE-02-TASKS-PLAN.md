---
description: "> AI 助手提示：任务处理中心（FEATURE-02）的设计与实施方案。执行器/机器人/任务包/调度机器人的领域模型、opencode 集成细节、状态机与实施顺序。调度能力已并入机器人（系统机器人 ID < 1000），不再使用平台进程内 PI Agent。"
version: 1.1.0
type: docs
---

# FEATURE-02 · 任务处理中心 设计与实施方案

> 需求原文占位于 `docs/FETURE-02-TASKS.md`；本文为评审定稿后的实施方案。
> 结论性原则：任务由 Agent（opencode 执行器上的机器人）完成，由人验收；调度能力并入机器人——系统调度机器人（ID < 1000，代码内置）统一运行在 opencode 等执行器上，不再使用平台进程内 PI Agent。

> **实施变更（2026-10-26）**：调度器已合并进机器人。`workers` 表中 id < 1000 为系统机器人（只能由代码内置，如系统调度机器人），id >= 1000 为网页创建的自定义机器人；历史自定义机器人启动时迁入 1000+，历史调度器迁入系统 ID 段。任务识别通过系统调度机器人的执行器会话完成（`TaskIdentifyService`），PROMPT 优化同样走执行器（`WorkerAiService`）；`src/pi/` 与 `@mariozechner/pi-ai` 已移除。

---

## 一、核心概念

| 概念 | 定义 | 载体 |
|---|---|---|
| **执行器** | 实际执行任务的工具实例（opencode / codex / claude-code，本期仅 opencode）。属性：ip、port、type、description、token（鉴权） | `executors` 表 + 登记页 |
| **供应商** | 大模型供应商及其模型清单。**从执行器 API 拉取并本地缓存**（`GET /api/provider` + `GET /api/model`） | `executors.providersCache` JSON |
| **机器人** | 干活的最小单元。可以是智能体（擅长一件事：需求分析师 / 技术架构师 / 前端·后端·客户端架构师 / 发布工程师 / 前端·UI·后端工程师 等）或员工（本期仅智能体）。每个智能体有**责任人**：定义智能体、验收其任务产出；验收通过即「内部完成」 | `workers` 表 |
| **调度机器人** | 项目负责人角色：任务识别（类型/输入/输出）、材料检查、任务拆解（单机器人可完成 or 拆成工作流）、分配建议。**有具体负责人**，对派发负责。属于系统机器人（id < 1000），运行在 opencode 等执行器上 | `workers` 表中 role=调度器（系统内置） |
| **任务包** | 具体任务内容：明确输入、明确输出、明确任务类型；可挂子任务形成工作流；有阶段状态机 | `tasks` / `task_events` / `dispatch_plans` 表 |

**统一建模说明**：机器人与调度机器人字段高度重合（PROMPT / 负责人 / 模型选择），统一存 `workers` 表，以 `role`（工作者/调度器）区分，统一 `runtime=opencode`；调度机器人多一个「调度材料」字段，且属于系统机器人（id < 1000，只能代码内置）。

---

## 二、总体架构

```
┌─────────────────────────── 项目管理平台（本仓库）───────────────────────────┐
│  前端：新顶级 Tab「任务」（/tasks 前缀）                                      │
│   ├── 任务概览（统计 + 任务树/工作流动画 + 列表）                              │
│   ├── 工作概览（智能体实时状态卡片墙 + 实时日志）                              │
│   └── 管理：机器人 / 调度器 / 执行器                                          │
│                                                                            │
│  后端 NestJS                                                                │
│   ├── executors 模块   执行器 CRUD + 健康检查 + 供应商缓存 + OpencodeClient    │
│   │                     + OpencodeEventHub（每执行器一条 SSE 订阅，断线重连）   │
│   ├── workers 模块     机器人 + 调度器 CRUD + 实时状态推导                     │
│   ├── tasks 模块       任务包 + 状态机 + 事件 + 调度方案 + 派发执行 + SSE 转发  │
│   └── 调度机器人（系统机器人 id<1000）——运行在 opencode 等执行器上              │
└──────────────────────────────┬─────────────────────────────────────────────┘
                               │ http://{ip}:{port}，HTTP Basic 鉴权
                    ┌──────────▼──────────┐
                    │ opencode server 2.x │──▶ 机器人在此干活
                    └─────────────────────┘
```

- **机器人** → 跑在执行器（opencode server）上：平台组装 PROMPT → 建 session（指定 model / location / permissions）→ 发 prompt（附 skills）→ 订阅 `/api/event` SSE 实时拿进展。
- **调度机器人 + 平台内部 Agent 能力**（任务识别、材料完整性检查、拆解、分配建议）→ **系统机器人（id<1000）+ opencode 等执行器会话**（`TaskIdentifyService`）。调度类任务无文件系统工具需求，以结构化 JSON 输出为主；不再使用平台进程内 PI Agent。

---

## 三、opencode 集成细节（已对本机 2.1.4 实测验证）

| 事项 | 结论 |
|---|---|
| 鉴权 | **HTTP Basic**，用户名固定 `opencode`，密码即 server password（`OPENCODE_PASSWORD` 同值；CLI 实抓包确认 Basic）。`executors.token` 存该密码，所有请求（含 SSE）统一注入 `Authorization` |
| 健康检查 | `GET /api/info` → `{version, pid, urls}`；Cron 60s 刷新在线状态 |
| 供应商/模型 | `GET /api/provider`、`GET /api/model` → providersCache 本地缓存（手动同步按钮 + 每日刷新） |
| 建会话 | `POST /api/session`：`title`、`model:{providerID, modelID}`、**`location:{directory}`**（工作目录，见「六」）、**`permissions`**（预授权规则集——无人值守关键）、`metadata` |
| 发任务 | `POST /api/session/{id}/prompt`：`text`（必填）+ `skills`（技能附件，schema 实现时对齐，兜底文本内联）+ `files` |
| 实时流 | `GET /api/event` SSE：`data: {"id","type","data"}` + 心跳注释；按 `sessionID` 过滤映射到任务 |
| 中断 | `POST /api/session/{id}/interrupt` |
| 历史 | `GET /api/session/{id}/message`（消息）、`GET /api/session/{id}/log` |
| 权限请求 | 事件 `permission.request` → 任务标「等待中」+ 通知负责人；网页批复透传 `POST /api/session/{id}/permission/{requestID}/reply` |
| 目录 | `location.directory` 支持任意已存在的绝对路径，按需动态加载；不传则用 server 启动 cwd；`GET /api/location` 查默认目录 |

**执行器环境**：
- 本机联调：`http://127.0.0.1:4096`，password `RPuavt2P6nUdl5QP26Gv4xnPPPRFpF_RsEbvpmb_j3c`
- 生产：`10.251.6.12:49374`（password 待提供）

---

## 四、数据模型（新表；枚举中文原文存 `common/enums.ts`）

### 4.1 `executors` 执行器
`name`、`ip`、`port`、`type`（ExecutorType：opencode，预留 codex/claude-code）、`description`、`token`（可空）、`enabled`、`online`（健康检查推导，落库供列表展示）、`version`、`defaultLocation`、`providersCache`（simple-json：`[{id,name,models:[{id,name}]}]`）、`providersSyncedAt`、`lastCheckedAt`

### 4.2 `workers` 机器人 + 调度器
`name`、`intro`（擅长什么/能接什么任务）、`kind`（WorkerKind：智能体/员工，本期仅智能体）、`role`（WorkerRole：工作者/调度器）、`runtime`（WorkerRuntime：opencode/pi）、`executorId`（runtime=opencode 必填）、`providerId`、`modelId`、`prompt`（角色定义 longtext）、`skills`（simple-json：`[{name, content}]` 技能名+MD 内容）、`taskDefs`（simple-json：`[{type, inputs:[{name,desc,required}], outputs:[...], how}]` 任务定义）、`ownerUserId`（责任人，users 表）、`materials`（调度材料 longtext，调度器专用）、`enabled`
- 运行状态不落库：由名下任务实时推导（空闲中/工作中/等待中/验收中），`GET /api/workers` 附带
- `workdir` 不落库：`{WORKER_BASE_DIR}/worker/{id}/` 实时计算返回（见「六」）

### 4.3 `tasks` 任务包（自引用树）
`code`（编号 TK-xxx 自动）、`title`、`type`（TaskType：需求分析/技术设计/前端开发/后端开发/客户端开发/UI设计/测试/发布/其它）、`parentId`/`rootId`/`sortOrder`、`input`（输入 longtext）、`outputSpec`（明确输出 longtext）、`missingItems`（simple-json：`[{item, reason}]` 缺失清单）、`status`（见「五」）、`agentId`（分配的机器人）、`schedulerId`、`executorId` + `opencodeSessionId`（执行绑定）、`result`（交付物/最终产出 longtext）、`acceptedAt/acceptedBy`、`deliveredAt`、`archivedAt`、`canceledAt`、`createdById`
- 无物理外键（RDS 无 REFERENCES 权限）；删根任务应用层级联删子任务/事件/方案

### 4.4 `task_events` 流转事件（append-only）
`taskId`、`type`（状态变更/操作/系统）、`content`、`meta`（simple-json）、`operator`（人名，系统动作为空）

### 4.5 `dispatch_plans` 调度方案
`taskId`（根任务）、`schedulerId`、`plan`（simple-json：`{identification:{type,input,output}, missingItems?, subtasks:[{title,type,input,outputSpec,agentId,dependsOn?}]}`）、`status`（DispatchPlanStatus：待确认/已确认/已驳回）、`confirmedBy`、`confirmedAt`

---

## 五、任务状态机（2026-10-26 起改为 LOOP：主状态 + 子状态）

| 主状态 | 子状态 | 进入条件 / LOOP 动作 |
|---|---|---|
| 等待中 | 待识别 | 新任务创建；LOOP 下一秒领取并置「进行中-识别中」 |
| 等待中 | 待反馈 | 调度器识别发现资料缺失/信息不明；LOOP 每 30 分钟提醒负责人，3 次未处理标记失败 |
| 等待中 | 待验收 | 机器人执行完成；LOOP 每 30 分钟提醒负责人，3 次未处理按成功完成 |
| 进行中 | 识别中 | 调度器正在识别标题/输入/输出/类型/工作计划/机器人 |
| 进行中 | 执行中 | 机器人 opencode session 运行中（LOOP 暂不处理，后续加超时） |
| 已结束 | 完成 | 验收通过或待验收超时自动完成 |
| 已结束 | 取消 | 人工取消或待反馈超时自动判失败 |

每次流转写 `task_events`；任务详情的待反馈/待验收飞书卡片经 `TaskNotifyService` 发送给机器人/调度器负责人。详细实现见 `docs/FETURE-02-TASKS.md` 末尾「LOOP 实现说明」。

---

## 六、workdir 规则（机器人独立工位）

- `workdir = {WORKER_BASE_DIR}/worker/{worker.id}/`；`WORKER_BASE_DIR` 为平台后端 `.env` 环境变量（执行器机器上的路径约定）。
- 不落库，服务层实时计算；worker API 响应附带 `workdir`；任务包不带 workdir 字段。
- **创建时机**：派发前由后端调执行器 `POST /api/shell` 执行 `mkdir -p {workdir}`（幂等），成功后再建会话。
- **串行约束**：同一机器人 P1 串行执行（workdir 共享工位，避免并行互踩；与智能体状态模型天然一致）。P2 如需并行，按 `{workdir}/{taskId}/` 或 worktree 再隔离。

---

## 七、核心链路

### 7.1 派发执行链路
```
派发 → mkdir -p workdir（执行器 shell）
     → POST /api/session（title=编号+标题, model=机器人选择, permissions=预授权模板, location=workdir）
     → POST /api/session/{id}/prompt（text=角色PROMPT+技能+输入/输出要求, skills=技能附件）
     → 订阅 /api/event 过滤 sessionId → 前端 SSE 转发 + 状态推进
     → 会话 idle → 「待验收」+ 通知责任人
```

### 7.2 AI 调度链路（PI · DeepSeek）
```
待调度任务 → POST /api/tasks/:id/schedule
  → PI 跑调度器 PROMPT + 调度材料 + 机器人清单（intro/taskDefs/在线状态）
  → 结构化 JSON：识别结果（类型/输入/输出）+ 缺失清单（有缺失→「待补材料」）
    或 拆解方案（单任务直接分配 / 多子任务+建议智能体）→ 存 dispatch_plans →「待确认」+ 通知
  → 管理员确认 → 物化子任务（parentId 挂树）→ 逐个自动派发
```
- 供应商：由执行器的供应商缓存提供（如 DeepSeek）；机器人与调度机器人在表单里选择执行器 → 供应商 → 模型。
- 调度器管理页提供「试跑」验证连通。

---

## 八、API 设计（后端）

| 分组 | 端点 |
|---|---|
| 执行器 | `GET/POST /api/executors`、`GET/PATCH/DELETE /api/executors/:id`、`POST /api/executors/:id/sync-providers` |
| 机器人 | `GET/POST /api/workers`、`GET/PATCH/DELETE /api/workers/:id`（列表附运行状态与 workdir；`?role=&kind=` 筛选） |
| 调度器 | 同机器人接口（`?role=scheduler`），另有 `POST /api/schedulers/:id/test`（试跑） |
| 任务 | `GET/POST /api/tasks`、`GET/PATCH/DELETE /api/tasks/:id`、`GET /api/tasks/:id/events`、`GET /api/tasks/overview`（统计） |
| 流程动作 | `POST /api/tasks/:id/schedule`（触发 PI 调度）、`POST /api/tasks/:id/plans/:planId/confirm|reject`、`POST /api/tasks/:id/dispatch`（手动派发）、`POST /api/tasks/:id/accept`（验收→内部完成）、`/deliver`、`/archive`、`/cancel`、`POST /api/tasks/:id/interrupt`、`POST /api/tasks/:id/permission/:requestID/reply` |
| 实时 | `GET /api/tasks/:id/chat`（聊天初始快照：任务 + 根任务 PIPELINE + 消息）、`GET /api/tasks/:id/chat/stream`（SSE：`message.upsert` / `stage.upsert` / `refresh`，机器人文本增量与工具调用实时推送）、`GET /api/tasks/:id/stream`（执行器事件行 + 状态变更；任务看板兼容） |
| 看板 | `GET /api/workers/live`（卡片墙：状态+当前任务，前端轮询） |

权限：全部走现有 AuthGuard（网页登录）。`.md` AI 端点 P2 再议。

---

## 九、前端设计（新顶级 Tab「任务」，`/tasks` 前缀）

左侧导航：**任务概览 / 工作概览 / 机器人 / 调度器 / 执行器**

| 页面 | 路由 | 内容 |
|---|---|---|
| 任务概览 | `/tasks` | 阶段统计卡 + 任务树/工作流视图（SVG+CSS 动画：执行中节点脉冲、流转边流动虚线，不引新依赖）+ 任务列表（状态/类型筛选、搜索） |
| 任务详情 | `/tasks/:id` | assistant-ui 对话页（SSE 实时，按发送方展示机器人头像/名称）+ 右侧任务概览 / PIPELINE（主任务 + 各机器人子任务）/ 交付物（含中间产出） |
| 工作概览 | `/tasks/live` | 智能体卡片墙：状态 Badge（空闲中/工作中/等待中/验收中，工作中呼吸动画）+ 当前任务 + 点击展开实时日志 |
| 机器人管理 | `/tasks/workers` | CRUD：执行器→供应商→模型三级联动、PROMPT 编辑、技能清单、任务定义、负责人、工位路径展示 |
| 调度器管理 | `/tasks/schedulers` | CRUD：DeepSeek 供应商+模型、角色 PROMPT、调度材料、负责人、启停、试跑 |
| 执行器管理 | `/tasks/executors` | CRUD + 在线状态 + 默认目录 + 供应商缓存同步 |

实时通道全部 SSE（与检查运行页同模式）；概览/卡片墙轮询（5s）。

---

## 十、定时任务迁移（`/tasks` → `/schedules`，任务中心接管 `/tasks`）

- **DB**（测试 RDS 手工迁移保数据，生产走 migrations）：
  ```sql
  RENAME TABLE tasks TO schedules;
  ALTER TABLE check_runs CHANGE task_id schedule_id BIGINT NULL;  -- 触发来源列更名
  ```
- **后端**：`src/tasks/` → `src/schedules/`，实体 `Task`→`Schedule`（@Entity('schedules')），API 挂 `/api/schedules`；`check_runs.scheduleId`、NotifyService、ChecksService 引用机械更名；旧 `/api/tasks` 路径不保留（前端同步切换）。
- **前端**：`/tasks`→`/schedules`、`/projects/:id/tasks/:id`→`/projects/:id/schedules/:id`；导航标签「任务」→「定时任务」；`api.ts` 方法更名。
- **文档**：AGENTS.md / SKILL.md 中任务（Task）相关章节同步改写为 schedules。

---

## 十一、实施顺序

1. **定时任务迁移**（schedules 改名，腾出 `/tasks` 与 `tasks` 表名）
2. **执行器模块**：CRUD + 健康检查 + 供应商缓存 + OpencodeClient + EventHub
3. **机器人 + 任务包 + 状态机**：CRUD、事件、流转动作
4. **派发执行 + SSE**：workdir 创建 → session/prompt → 实时日志 → 完成检测 → 待验收
5. **PI 调度器**：DeepSeek 接入、方案生成、确认物化子任务、自动派发
6. **前端**：导航 + 六个页面 + api.ts
7. **飞书通知 + 联调**：本机执行器跑通全链路 → 生产机接入

**P2 候选**：子任务 DAG 依赖自动流转、员工型机器人、`.md` AI 端点、任务模板（从 taskDefs 一键建任务）、codex/claude-code 执行器、素材附件管理、同机器人并行隔离。

---

## 十二、环境与配置

| 项 | 值 |
|---|---|
| 本机执行器 | `http://127.0.0.1:4096`（password `RPuavt...j3c`，见「三」） |
| 生产执行器 | `10.251.6.12:49374`（password 待提供） |
| `DEEPSEEK_API_KEY` | （已废弃）原 PI 调度器使用，现统一走执行器供应商配置 |
| `WORKER_BASE_DIR` | 后端 `.env`，执行器机器上的工位根目录（默认建议 `<执行器侧约定路径>`，登记执行器页面展示） |
| 执行器登记 | 页面录入（ip/port/token），不预置种子数据 |

---

## 十三、实施状态（2026-10-26）

### 已完成（P1 全链路）

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 定时任务迁移 schedules（DB 表/列更名 + 前后端路由 + 文档） | ✅ |
| 2 | 执行器模块（CRUD/健康检查/供应商缓存/OpencodeClient/EventHub） | ✅ |
| 3 | 机器人 + 任务包 + 状态机 + 事件/调度方案表 | ✅ |
| 4 | 派发执行 + SSE 实时流 + 完成回写 + 对账补偿 | ✅ |
| 5 | PI 调度器（DeepSeek，识别/缺料/拆解/分配） | ✅ |
| 6 | 前端：任务 Tab 6 页面 + api 客户端 | ✅ |
| 7 | 责任人飞书通知 + 本机执行器全链路 E2E | ✅ |

**E2E 实测（本机 opencode 2.1.4 + DeepSeek）**：建任务（材料不全）→ AI 调度识别 5 项缺失 → 转「待补材料」→ 补材料 → AI 调度拆解 2 子任务并分配给前端/后端工程师 → 管理员确认 → 子任务自动派发并行执行（deepseek-flash）→ 完成回写产出 → 责任人验收 → 父任务自动「待验收」→ 交付 → 归档（维护中）。事件时间线完整，机器人实时状态（工作中/验收中/空闲中）推导正确。

### 实测修正的集成事实（与初版方案差异）

1. 模型引用 `Model.Ref` = `{ id: modelID, providerID }`（不是 `{modelID}`）。
2. 会话成功终态事件是 **`session.execution.succeeded`**；`session.execution.failed` 为失败终态。
3. 工具事件为 `session.tool.input.started`（data.name）/`session.tool.success`/`session.tool.failed`；文本流为 `session.text.delta`（data.delta）。
4. 消息列表接口的 assistant 项 `text` 为空，完整文本需 `GET /api/session/{id}/message/{messageID}` 的 `content[].text`；实时产出优先用文本增量累积。
5. ~~`pi-ai` 为纯 ESM 包，后端 CJS 运行时必须用动态 `import()`~~（已移除，调度统一走执行器）。
6. 事件流漏收（服务重启/断线）通过三处兜底：启动时订阅、派发时 ensureConnected、每 2 分钟对账执行中任务（查会话 outcome）。

### P2 待办

子任务 DAG 依赖自动流转（当前为并行+聚合验收）、员工型机器人、任务中心 `.md` AI 端点、任务模板（从 taskDefs 一键建任务）、codex/claude-code 执行器、同机器人并行隔离（`{workdir}/{taskId}/` 或 worktree）、任务详情页技能/任务定义的结构化表单（当前为 JSON 文本域）。

### 开发环境配置（本机）

- 执行器：`http://127.0.0.1:4096`（`opencode serve --port 4096` 启动，password 见启动输出，登记时填入 token）
- `WORKER_BASE_DIR`：执行器机器上的工位根目录（开发机已用 `/Users/monkee/workplace/hufeng/runtime`）
- `DEEPSEEK_API_KEY`：（已废弃）原 PI 调度器使用，不再需要
- 已配置示例：调度器-项目负责人（PI/deepseek-v4-flash）、前端工程师/后端工程师（opencode/deepseek-flash）
