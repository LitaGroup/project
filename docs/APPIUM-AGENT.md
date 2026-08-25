# APP 自动化测试方案

> 基于 appium-agent 与中心服务（project）的远程 APP 自动化测试能力设计。

## 一、架构概览

实际只有**两个自己写的组件**（appium 是外部依赖，不单独写 appium-server）：

| 组件 | 位置 | 职责 |
|---|---|---|
| **project** 中心服务 | 现有 backend | WebSocket server 端 + 全局任务队列 + 脚本下载端点 + app 版本管理 + 复用现有 test_runs/SSE/NotifyService |
| **appium-agent** | 测试机（与模拟器、appium 同机） | WebSocket client + 任务执行器：下载脚本、下载+校验 app 包、启动模拟器、安装+打开 app、spawn node 跑脚本、逐行回传 stdout |

**关键复用**：APP 测试就是 Test 的一种。`tests` 表加 `appPlatform`/`appTarget` 区分本地 node 直跑（空）vs 远程 appium 跑（非空）。`TestRunPage`、SSE、`run.md`、`Terminal`、行协议 `[type] {json}`、`NotifyService` 全链路复用——agent 只需把 stdout 行通过 WebSocket 回传，project 端把它喂进现有 `executeRun` 的行解析逻辑即可。

## 二、数据模型变更

### 1. `tests` 表新增字段（可空，向后兼容）

| 字段 | 类型 | 说明 |
|---|---|---|
| `appPlatform` | varchar(20) null | `ios` / `android` / 空(=非 APP 测试，走现有本地 spawn) |
| `appTarget` | varchar(50) null | `lita` / `lita lite` / 空 |

路由依据：`appPlatform` 非空 → 入队远程执行；空 → 现有 `spawn('node',[script])` 本地直跑。

### 2. `test_runs` 表新增字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `appVersionId` | int null | 关联 `app_versions`（非 APP 测试为空） |
| `queuedAt` | datetime null | 入队时间（FIFO 排序用） |
| `agentName` | varchar(100) null | 执行机标识（单台也记，便于扩展） |

`status` 枚举扩充：`queued` / `running` / `success` / `fail` / `error`（新增 `queued`）。

### 3. 新建 `app_versions` 表

```
id, projectId, platform(ios/android), appTarget(lita/lita lite),
version(varchar 100), downloadUrl(text), md5(varchar 64), remark(text null),
createdAt, updatedAt
```

归属项目，不存包内容（包由 agent 下载到测试机、按 md5 缓存）。CRUD：`GET /api/projects/:id/app-versions`、`POST`、`DELETE`。前端在项目详情页加"APP 版本"板块管理。

## 三、通信协议（WebSocket）

用 `ws` 库挂载到 NestJS http server 的 `/ws` 路径（http upgrade，单端口，像 `/images` 一样绕过 `/api` 前缀）。新增 `AgentGateway` service 管连接与消息分发。**不引入 `@nestjs/websockets`**（单 client 场景 overkill）。

- **鉴权**：agent 连接时带 `?token=...`，project 校验环境变量 `AGENT_TOKEN`，不匹配拒绝握手。
- **心跳**：agent 每 10s 发 `{type:heartbeat}`，project 30s 无心跳标记离线、断线任务标 error。
- **重连**：agent 端指数退避重连。

### project → agent

```jsonc
// 下发任务
{ "type":"task", "runId":12, "scriptPath":"lita/login.test.ts",
  "platform":"android", "appTarget":"lita",
  "appVersion":"1.2.3", "downloadUrl":"...", "md5":"...", "timeout":600000 }
// 取消（可选，后续）
{ "type":"cancel", "runId":12 }
```

### agent → project

```jsonc
// 连接注册
{ "type":"ready", "name":"mac-mini-1",
  "capabilities":{"platform":["android","ios"],"appTarget":["lita","lita lite"]} }
// 逐行 stdout（project 端喂进行解析器，与本地 executeRun 同逻辑）
{ "type":"progress", "runId":12, "line":"[check] {\"no\":1,\"status\":\"success\",\"title\":\"登录\"}" }
// 终态
{ "type":"done", "runId":12, "status":"success",
  "total":10,"current":10,"success":8,"fail":1,"skip":1,
  "durationMs":12345,"message":"", "items":[...], "output":[...] }
// 心跳
{ "type":"heartbeat" }
```

project 收到 `progress` 后：把 `line` 追加到 `liveRun.output`、调 `handleLine` 更新 items/current/status、`emitLive()` 推 SSE——**完全复用现有 `tests.service` 的 live 快照机制**，前端 `TestRunPage` 零改动。

## 四、任务队列与调度

全局单队列（单台 agent），基于 DB 状态机 + 事件驱动（无新依赖）：

- `tests.service.startRun(testId, appVersionId?)` 改为**分支**：
  - `test.appPlatform` 空 → 现有本地 spawn（不变）
  - 非空 → 创建 `test_run{status:queued, queuedAt:now, appVersionId}` 入队，触发 `dispatch()`
- `AgentGateway` 内存维护 `agentState: { online, busy }`（单台）
- `dispatch()` 逻辑：`agentState.online && !busy && 存在 queued 任务` → 取 `queuedAt` 最早的一条 → 发 `task` 消息 → `status=running` + `agentState.busy=true`
- 收到 `done`（或 agent 断线）→ 更新 run 终态 + 推 SSE + 推飞书通知 + `agentState.busy=false` → 再调 `dispatch()` 扫下一个

队列持久化在 `test_runs` 表（重启不丢），调度状态在内存（重启后 `onModuleInit` 扫 `status=running` 的标记为 error"服务重启"，再 `dispatch`）。

## 五、端到端执行流程

1. 用户在项目详情页"APP 版本"板块上传/录入 app 版本（version + downloadUrl + md5）
2. 用户在"测试"板块登记/导入 APP 测试用例（scriptPath 指向 `.test.ts`，填 `appPlatform=android`、`appTarget=lita`）
3. 用户点该用例"运行"→ 选择 app 版本 → `POST /api/tests/:id/runs` 带 `appVersionId`
4. project 创建 `queued` run 入队 → `dispatch` 见 agent 空闲 → WebSocket 下发 `task`
5. agent 收到：① `GET /api/scripts?path=lita/login.test.ts`（带 token）下载脚本到本地工作目录 ② 下载 app 包（按 md5 命中缓存则跳过）③ 启动模拟器 ④ 通过 appium capabilities 安装+打开 app ⑤ spawn `node [script]`（cwd=本地工作目录，能 resolve 到本地 `node_modules` 里的 appium client）
6. agent 逐行读 stdout，每行 `progress` 上报；project 喂进行解析器 → SSE 推前端
7. 脚本结束/超时 → agent 发 `done` → project 终态落库 + SSE 收尾 + 飞书通知 + `dispatch` 下一个

## 六、脚本下载端点

- `GET /api/scripts?path=...`（新增，或复用 `checks/scripts` 扫描机制扩展）：返回脚本文件内容（text/plain），校验 path 不含 `..`/绝对路径（同现有 `normalizeScriptPath`）
- 鉴权：agent 用 `AGENT_TOKEN`（query 或 header）。普通前端请求不走此端点
- agent 本地维护一个工作目录（`AGENT_SCRIPTS_DIR`），下载的脚本放进去，确保其 `node_modules` 已预装 appium 依赖（`appium`、`webdriverio` 等）

## 七、appium-agent 实现

`appium-agent/`（pnpm workspace 第三个成员，与 backend/frontend 并列）：

```
appium-agent/
  package.json        # 依赖：ws（+ 本地预装 appium、appium driver）
  tsconfig.json
  src/
    main.ts           # 连 WebSocket、收任务、调度执行
    ws-client.ts      # WebSocket client + 心跳 + 重连
    runner.ts         # 下载脚本、下载+校验 app、起模拟器、装 app、spawn node、逐行上报
    appium.ts         # appium capabilities/session 管理（装+开 app）
    config.ts         # 读 env: PROJECT_WS_URL, AGENT_TOKEN, SCRIPTS_DIR, APP_CACHE_DIR
```

关键约定：

- **app 包缓存**：按 md5 缓存到 `APP_CACHE_DIR/{md5}.apk`，同 md5 不重复下载
- **模拟器/appium 启动**：appium server 常驻（agent 启动时拉起或开机自启），agent 通过 appium REST API 带 app 包路径创建 session 让 appium 自动安装+启动 app，session 信息（或 appium server url + capabilities）通过环境变量传给脚本
- **appium 地址可配置**：由环境变量 `APPIUM_URL` 指定（默认 `http://localhost:4723`），开发机常用 `http://172.20.1.79:4723/`、生产机 `http://127.0.0.1:4723/`，可按实际机器自定义。agent 创建 session 用该地址，并把 `APPIUM_URL` + `APPIUM_SESSION_ID` 注入到被执行脚本的环境变量（脚本用 appium client attach session 执行用例）
- **超时**：默认 600s（远大于本地 120s），任务可配，agent 端 SIGTERM 杀进程后发 `done{status:error, message:"脚本执行超时"}`
- **脚本协议不变**：agent 不关心脚本内容，只把 stdout 行透传

## 八、project 后端改动清单

| 模块 | 改动 |
|---|---|
| `common/enums.ts` | 加 `AppPlatform`/`AppTarget` 枚举 |
| `tests/test.entity.ts` | 加 `appPlatform`/`appTarget` |
| `tests/test-run.entity.ts` | 加 `appVersionId`/`queuedAt`/`agentName`；`status` 允许 `queued` |
| `tests/tests.service.ts` | `startRun` 分支（本地 vs 入队）；新增 `enqueueRun`/`dispatchRun`；`executeRemoteRun` 消费 agent 上报（复用 `handleLine`/`emitLive`/`finalize`） |
| 新建 `agent/agent.gateway.ts` + `agent.module.ts` | WebSocket server（`ws` 库，挂 `/ws`），管连接/鉴权/心跳/消息路由，调 `tests.service` 的远程执行方法 |
| 新建 `app-versions/` 模块 | `AppVersion` 实体 + CRUD controller/service |
| `scripts/` 新模块或扩 `settings` | `GET /api/scripts?path=` 下载端点（带 token 鉴权） |
| `main.ts` | 把 WebSocket server 挂到 http server 的 `/ws`（http upgrade） |
| `app.module.ts` | 注册 `AgentModule`、`AppVersionsModule`、ScriptsModule |

新增依赖：`ws` + `@types/ws`（backend）。`AGENT_TOKEN`、`AGENT_NAME`、`APP_CACHE_DIR` 等环境变量加到 `.env.example`。

## 九、前端改动清单

| 位置 | 改动 |
|---|---|
| 项目详情页 | 新增"APP 版本"板块（列表 + 新建/删除，version/platform/appTarget/downloadUrl/md5） |
| 新建/编辑测试表单 | 增加 `appPlatform`（ios/android/空）、`appTarget`（lita/lita lite/空）选项；非空时为 APP 测试 |
| 测试运行入口 | APP 测试点"运行"时弹出选择 app 版本（从 `GET /api/projects/:id/app-versions` 取，按 platform/appTarget 过滤） |
| `TestRunPage` | **零改动**（SSE + Terminal + 历史复用） |
| `api.ts` | 加 `AppVersion` 类型 + `startTestRun` 支持 `appVersionId` 参数 + `AppPlatform`/`AppTarget` 枚举 |
| （可选）项目详情/概览 | 展示 agent 在线状态 + 队列长度 |

## 十、飞书通知

复用 `NotifyService`，但现有 `notifyTaskRunStart`/`notifyTaskRun` 绑定 `taskId`（仅 task 触发的 check 运行才推）。APP 测试当前不挂 task（task 只调度 check）。

**建议**：把 `NotifyService` 的两个方法签名从"依赖 taskId"泛化为"依赖 run 上下文（projectId + runTitle + scriptPath + 可选 taskId）"，让 APP 测试运行也推送开始/结果卡片。运行标题用"测试：{testCode} - {appTarget} {appVersion}"。这属于现有模块小重构，符合 AGENTS.md"通知"约定。

（APP 测试是否需要定时调度？现有 task 只绑 checkId。如需 APP 测试也定时跑，后续扩展 task 支持 `testId`——本方案不包含，作为后续需求。）

## 十一、目录结构（最终）

```
project/
  frontend/          (现有)
  backend/           (现有，新增 agent/ app-versions/ scripts/ 模块)
  appium-agent/      (新增，pnpm workspace 成员)
  docs/              (现有)
  pnpm-workspace.yaml (成员加 appium-agent)
```

## 十二、配置项（新增 .env）

```
# backend
AGENT_TOKEN=...          # agent 连接鉴权 token
# appium-agent
PROJECT_WS_URL=ws://project-host:3000/ws
AGENT_TOKEN=...           # 与 backend 一致
AGENT_NAME=mac-mini-1
AGENT_SCRIPTS_DIR=...     # 本地脚本工作目录（含预装 node_modules）
AGENT_APP_CACHE_DIR=...   # app 包缓存目录
APPIUM_URL=...            # appium server 地址（开发 http://172.20.1.79:4723/，生产 http://127.0.0.1:4723/，可自定义）
```

## 十三、待确认/后续

1. **appium driver 安装**：测试机需预装 `appium` + `UiAutomator2`(android)/`XCUITest`(ios) driver + 对应 SDK（Android SDK/Xcode）。这是 agent 运行前提，方案默认已就绪。
2. **iOS 签名**：iOS app 包（.ipa）需有效签名证书才能装到模拟器/真机。若涉及真机 iOS，签名管理是额外工程。本方案先聚焦 android。
3. **app 版本 downloadUrl 来源**：downloadUrl 由人工录入 app_versions 表。若后续要对接构建系统自动拉取，是后续需求。
4. **多机扩展**：当前单台不建 agent 实体。未来加第二台时，把 `agentState` 内存对象升级为 `agents` 表 + 按能力路由，改动可控。
5. **队列优先级/取消**：当前纯 FIFO。如需插队/取消，后续加 `priority` 字段和 `cancel` 消息处理。
