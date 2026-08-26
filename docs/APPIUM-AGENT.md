# APP 自动化测试方案

> 基于 appium-agent 与中心服务（project）的远程 APP 自动化测试能力设计。

## 一、架构概览

实际只有**两个自己写的组件**（appium 是外部依赖，不单独写 appium-server）：

| 组件 | 位置 | 职责 |
|---|---|---|
| **project** 中心服务 | 现有 backend | WebSocket server 端 + 全局任务队列 + 脚本下载端点 + app 版本管理 + 复用现有 test_runs/SSE/NotifyService |
| **appium-agent** | 测试机（与模拟器、appium 同机） | WebSocket client + 任务执行器：执行前置校验（模拟器/APP 就绪）、下载脚本、spawn node 跑脚本、逐行回传 stdout；另承载 APP 包管理（装/卸/查，见"十四"） |

### 拓扑：agent → appium-server → 模拟器

```
appium-agent ──► appium-server（单进程，常驻 4723）──► 模拟器 × N
```

- 一台测试机上：**1 个 appium-agent + 1 个 appium-server 进程 + 多个模拟器**。appium-server 是脚本执行的唯一入口（脚本经 appium REST API 建 session、执行指令）；APP 安装/卸载不经过 appium，由 agent 直接走 adb/simctl（见"十四"）。
- 实际部署**两个模拟器常驻**：一个 Android、一个 iOS。
- **运行到哪个模拟器由脚本内的配置决定**：脚本自带 capabilities（platformName / automationName / udid 等，如 `super('android', 'lite')` 基类注入），appium-server 按 platformName + driver 把 session 路由到对应平台的模拟器；agent 不感知具体设备。
- agent 的 **APP 安装/卸载**（APP 包管理）按 `platform` 参数区分目标虚拟机：android 走 adb、ios 走 `xcrun simctl`；每平台只有一台模拟器时 platform 即可定位设备，多设备时再由 `AGENT_SIMULATORS` 的 serial 细化（见"十四"）。

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
version(varchar 100), remark(text null),
createdAt, updatedAt
```

归属项目，只登记版本元信息（不存包内容、不参与执行——APP 包安装/卸载由"十四"的 APP 包管理统一处理，运行前由 agent 前置校验已安装）。CRUD：`GET /api/projects/:id/app-versions`、`POST`、`DELETE`。前端在项目详情页加"APP 版本"板块管理。

## 三、通信协议（WebSocket）

用 `ws` 库挂载到 NestJS http server 的 `/api/ws` 路径（http upgrade，单端口，挂在 `/api` 前缀下使生产反代一条 /api 规则即可覆盖，仍需支持 Upgrade 头）。新增 `AgentGateway` service 管连接与消息分发。**不引入 `@nestjs/websockets`**（单 client 场景 overkill）。

- **鉴权**：agent 连接时带 `?token=...`，project 校验环境变量 `AGENT_TOKEN`，不匹配拒绝握手。
- **心跳**：agent 每 10s 发 `{type:heartbeat}`，project 30s 无心跳标记离线、断线任务标 error。
- **重连**：agent 端指数退避重连。

### project → agent

```jsonc
// 下发任务
{ "type":"task", "runId":12, "scriptPath":"lita/login.test.ts",
  "device":"android", "appTarget":"lita",
  "appVersion":"1.2.3", "timeout":600000 }
// 取消（可选，后续）
{ "type":"cancel", "runId":12 }
// APP 包操作（请求-响应模式，reqId 关联，见"APP 包管理"小节）
{ "type":"app", "reqId":"uuid", "action":"list" }
{ "type":"app", "reqId":"uuid", "action":"install", "file":"lita-1.2.3.apk" }
{ "type":"app", "reqId":"uuid", "action":"uninstall", "packageId":"com.x", "platform":"android" }
{ "type":"app", "reqId":"uuid", "action":"version", "packageId":"com.x", "platform":"android" }
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
// APP 包操作应答（与 app 指令 reqId 对应；ok=false 时 error 为失败原因）
{ "type":"app-result", "reqId":"uuid", "ok":true,
  "data":[{ "file":"lita.apk", "platform":"android", "size":123, "updatedAt":"...",
            "packageId":"com.x", "version":"1.2.3", "installedVersion":"1.2.3" }] }
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

1. 用户在项目详情页"APP 版本"板块录入 app 版本（version + platform + appTarget）；APP 安装包放到 agent 包目录，经 APP 页安装到对应模拟器
2. 用户在"测试"板块登记/导入 APP 测试用例（scriptPath 指向 `.test.ts`，填 `appPlatform=android`、`appTarget=lita`）
3. 用户点该用例"运行"→ 选择 app 版本 → `POST /api/tests/:id/runs` 带 `appVersionId`
4. project 创建 `queued` run 入队 → `dispatch` 见 agent 空闲 → WebSocket 下发 `task`
5. agent 收到：⓪ **前置校验**（按 task 的 `device`+`appTarget` 定位受管模拟器：模拟器未启动 → 直接回错误；APP 未安装 → 直接回错误及原因，见"七"）① `GET /api/scripts?path=lita/login.test.ts`（带 token）下载脚本到本地工作目录 ② spawn `node [script]`（cwd=本地工作目录，能 resolve 到本地 `node_modules` 里的 appium client）。任务不携带 APP 包，agent 不建 session——脚本经注入的 `APPIUM_URL` 自行创建 session，appium-server 按脚本 capabilities 的 platformName 路由到对应模拟器
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
    runner.ts         # 前置校验、下载脚本、spawn node、逐行上报
    apps.ts           # APP 包管理 + 受管模拟器状态 + 运行前置校验（preflightRunTarget）
    config.ts         # 读 env: PROJECT_WS_URL, AGENT_TOKEN, SCRIPTS_DIR, APPS_DIR, SIMULATORS
```

关键约定：

- **执行前置校验**（`apps.ts` 的 `preflightRunTarget`，runTask 最先执行）：按 task 的 `device`（platform）+ `appTarget`（产品，对应 `AGENT_SIMULATORS` 的 product）定位受管模拟器——① 未配置对应模拟器 / 模拟器未启动（adb devices / simctl booted 不可见）→ 直接回错误"模拟器未启动：…"；② 模拟器在线但 APP（simulator 声明的 packageId）未安装 → 直接回错误"APP 未安装：…，请先在 APP 页安装"。校验失败经 `done{status:error, message}` 回传 project，project 落 error 终态（原因即 message），不进入脚本执行
- **任务不携带 APP 包**：脚本执行与 APP 包无关，agent 不下载包、不建 appium session；APP 的安装/卸载统一走"十四"的 APP 包管理（agent 包目录 + 平台远程操作）
- **模拟器/appium 拓扑**：**1 个 appium-server 进程（常驻，agent 启动时拉起或开机自启）管全部模拟器**；实际常驻两个模拟器（一个 Android、一个 iOS）。**具体跑到哪台模拟器由脚本内 capabilities 决定**（platformName/automationName 路由到对应平台的模拟器，必要时 udid 指定具体设备），agent 本身不做设备选择
- **appium 地址可配置**：由环境变量 `APPIUM_URL` 指定（默认 `http://localhost:4723`），开发机常用 `http://172.20.1.79:4723/`、生产机 `http://127.0.0.1:4723/`，可按实际机器自定义。agent 把 `APPIUM_URL`（及 `APP_PLATFORM`/`APP_VERSION`/`TEST_RUN_ID`）注入到被执行脚本的环境变量，脚本用 appium client 自行创建 session 执行用例
- **超时**：默认 600s（远大于本地 120s），任务可配，agent 端 SIGTERM 杀进程后发 `done{status:error, message:"脚本执行超时"}`
- **脚本协议不变**：agent 不关心脚本内容，只把 stdout 行透传

## 八、project 后端改动清单

| 模块 | 改动 |
|---|---|
| `common/enums.ts` | 加 `AppPlatform`/`AppTarget` 枚举 |
| `tests/test.entity.ts` | 加 `appPlatform`/`appTarget` |
| `tests/test-run.entity.ts` | 加 `appVersionId`/`queuedAt`/`agentName`；`status` 允许 `queued` |
| `tests/tests.service.ts` | `startRun` 分支（本地 vs 入队）；新增 `enqueueRun`/`dispatchRun`；`executeRemoteRun` 消费 agent 上报（复用 `handleLine`/`emitLive`/`finalize`） |
| 新建 `agent/agent.gateway.ts` + `agent.module.ts` | WebSocket server（`ws` 库，挂 `/api/ws`），管连接/鉴权/心跳/消息路由，调 `tests.service` 的远程执行方法 |
| 新建 `app-versions/` 模块 | `AppVersion` 实体 + CRUD controller/service |
| `scripts/` 新模块或扩 `settings` | `GET /api/scripts?path=` 下载端点（带 token 鉴权） |
| `main.ts` | 把 WebSocket server 挂到 http server 的 `/api/ws`（http upgrade） |
| `app.module.ts` | 注册 `AgentModule`、`AppVersionsModule`、ScriptsModule |

新增依赖：`ws` + `@types/ws`（backend）。`AGENT_TOKEN`、`AGENT_NAME` 等环境变量加到 `.env.example`。

## 九、前端改动清单

| 位置 | 改动 |
|---|---|
| 项目详情页 | 新增"APP 版本"板块（列表 + 新建/删除，version/platform/appTarget） |
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
PROJECT_WS_URL=ws://project-host:3000/api/ws
AGENT_TOKEN=...           # 与 backend 一致
AGENT_NAME=mac-mini-1
AGENT_SCRIPTS_DIR=...     # 本地脚本工作目录（含预装 node_modules）
AGENT_APPS_DIR=...         # APP 包目录（人工放置安装包，平台远程安装/卸载/查询，见"十四"）
# AGENT_ADB_SERIAL=...      # adb 目标设备序列号（多设备时指定）
APPIUM_URL=...            # appium server 地址（开发 http://172.20.1.79:4723/，生产 http://127.0.0.1:4723/，可自定义）
```

## 十三、待确认/后续

1. **appium driver 安装**：测试机需预装 `appium` + `UiAutomator2`(android)/`XCUITest`(ios) driver + 对应 SDK（Android SDK/Xcode）。这是 agent 运行前提，方案默认已就绪。
2. **iOS 签名**：iOS app 包（.ipa）需有效签名证书才能装到模拟器/真机。若涉及真机 iOS，签名管理是额外工程。本方案先聚焦 android。
3. ~~app 版本 downloadUrl 来源~~（已移除：任务不再携带 APP 包，安装统一走 APP 包管理）。
4. **多机扩展**：当前单台不建 agent 实体。未来加第二台时，把 `agentState` 内存对象升级为 `agents` 表 + 按能力路由，改动可控。
5. **队列优先级/取消**：当前纯 FIFO。如需插队/取消，后续加 `priority` 字段和 `cancel` 消息处理。

## 十四、APP 包管理（已实现）

agent 机器上配置一个 APP 包目录（`AGENT_APPS_DIR`，开发环境 `/Users/monkee/workplace/hufeng/files`），人工把安装包（.apk/.ipa）放进去，project 平台即可远程管理：

- **列出包**：agent 扫描目录（仅顶层），apk 经 aapt（`ANDROID_HOME/build-tools` 最新版，兜底 PATH）解析包名与包版本，并实时查询对应模拟器内已装版本（android `adb shell dumpsys package`，ios `xcrun simctl get_app_container` + PlistBuddy）
- **多模拟器**：安装/卸载先按 **`platform` 参数区分目标虚拟机**——android 走 adb、ios 走 `xcrun simctl`（实际每平台一台模拟器，platform 即可定位设备）。同一平台有多台设备时，`AGENT_SIMULATORS`（JSON 数组）声明受管模拟器 `{name, platform, product, serial, packageId}`（如 Android Lite / Android Lita / iOS Lita），按**包名**（apk 解析）优先、**产品+平台**（文件名第一段 `{产品}.{环境}.*.apk`）兜底路由到具体设备（adb `-s serial` / simctl udid）；未匹配时落回默认设备（`AGENT_ADB_SERIAL` 或 adb 默认）
- **环境判定**：只认平台安装记录——经平台安装时把文件名中的环境段与版本记入状态文件（`AGENT_STATE_FILE`，默认 `./install-state.json`），查询时已装版本与记录一致才展示环境，手动装/换包显示未知；卸载时清除记录
- **project 端点**：`GET /api/agent/apps`（列表）、`GET /api/agent/apps/simulators`（各模拟器在线状态 + 已装环境/版本）、`POST /api/agent/apps/install {file}`、`POST /api/agent/apps/uninstall {packageId, platform}`、`GET /api/agent/apps/installed?packageId=&platform=`；实现为 WS 请求-响应（`AgentGateway.requestAppOp`，reqId 关联，默认超时 180s），agent 侧报错映射 502 透传错误信息
- **互斥**：有远程任务在 agent 上执行时 APP 操作返回 409；APP 安装/卸载期间 RemoteRunService 暂停任务派发（`hasPendingAppOps`），完成后 `kickDispatch` 补一次派发
- **agent 侧实现**：`src/apps.ts`（`listPackages`/`listSimulators`/`installPackage`/`uninstallPackage`/`installedVersion`），main.ts 处理 `app` 指令；任务运行中（busy）拒绝 APP 操作
- **前端**：左侧导航"APP"（/apps）：包列表（APP/环境/平台/版本/文件/操作，产品/环境/平台筛选 + 版本搜索 + 文件名倒序）+ 安装/卸载；右侧受管模拟器面板（在线状态 + 已装环境/版本）
