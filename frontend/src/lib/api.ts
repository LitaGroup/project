/** 与后端 common/enums.ts 对应，枚举值用中文原文 */
export const PROJECT_TYPES = ['活动', '功能', '游戏', '数据', '后台', '技术', '其它'] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

export const PROJECT_STATUSES = ['计划中', '进行中', '已结束', '暂停'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** 与后端 DefectStatus 对应，平台侧统一为这五个状态（飞书 new→open、close→closed，乱填→open） */
export const DEFECT_STATUSES = ['open', 'reopen', 'fixed', 'closed', 'invalid'] as const
export type DefectStatus = (typeof DEFECT_STATUSES)[number]

/** 缺陷端：只保留这四类，飞书侧其它值统一为"未知"（默认） */
export const DEFECT_PLATFORMS = ['前端', '后端', 'APP端', '未知'] as const

/** APP 自动化测试目标应用（与后端 AppTarget 对应，app_versions 用） */
export const APP_TARGETS = ['lita', 'lita lite'] as const
export type AppTarget = (typeof APP_TARGETS)[number]

/** APP 版本平台（app 包目标，android/ios） */
export const APP_PLATFORMS = ['android', 'ios'] as const

/** 脚本运行设备：server/h5 本地直跑；android/ios 走 appium-agent 远程 */
export const DEVICES = ['server', 'h5', 'android', 'ios'] as const
export type Device = (typeof DEVICES)[number]

/** 与后端 DocumentType 对应 */
export const DOCUMENT_TYPES = [
  '需求',
  '功能',
  '测试',
  '技术',
  '接口',
  '配置',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export interface ProjectDocument {
  id: number
  title: string
  type: string
  source: string
  feishuUrl: string | null
  description: string | null
  remark: string | null
  content?: string | null
  projectId?: number
  updatedAt: string
}

/** 检查：本质是一个脚本，登记其元信息（编号/描述/脚本位置） */
export interface ProjectCheck {
  id: number
  /** 编号（手工定义，项目内唯一） */
  code: string
  /** 描述：脚本检查的内容 */
  description: string | null
  /** 脚本位置：相对脚本根目录的 .check.ts 路径 */
  scriptPath: string
  /** 运行设备/目标：server/h5 本地直跑；android/ios 走 appium-agent 远程 */
  device: string | null
  projectId?: number
  updatedAt: string
}

/** 脚本输出协议中的单条 act/check 记录 */
export interface CheckRunItem {
  kind: 'act' | 'check'
  no?: number
  title?: string
  status?: 'success' | 'fail' | 'skip'
  expect?: string
  real?: string
  message?: string
  time?: number
}

/** 一次脚本运行记录：running 期间实时更新 current/total，结束后落完整结果 */
export interface CheckRun {
  id: number
  checkId: number
  /** 触发来源任务（定时任务触发时记录；手动运行为 null） */
  taskId?: number | null
  /** queued=已入队待 appium-agent 执行；running=执行中；success=全部通过；fail=有失败项；error=脚本异常 */
  status: 'queued' | 'running' | 'success' | 'fail' | 'error'
  /** 总步数（脚本 [start] 上报） */
  total: number | null
  /** 当前步数（运行中实时更新） */
  current: number
  success: number | null
  fail: number | null
  skip: number | null
  message: string | null
  /** 耗时（毫秒），结束时写入 */
  durationMs: number | null
  /** 逐项明细（结束时写入） */
  items: CheckRunItem[] | null
  /** 日志行（结束时写入） */
  logs: string[] | null
  /** 脚本原始输出行（终端展示用；运行中实时累积） */
  output: string[] | null
  startedAt: string
  finishedAt: string | null
}

/** 测试：本质是一个脚本，登记其元信息（编号/描述/脚本位置），同检查但脚本后缀为 .test.ts */
export interface ProjectTest {
  id: number
  /** 编号（手工定义，项目内唯一） */
  code: string
  /** 描述：脚本测试的内容 */
  description: string | null
  /** 脚本位置：相对脚本根目录的 .test.ts 路径 */
  scriptPath: string
  /** 运行设备/目标：server/h5 本地直跑；android/ios 走 appium-agent 远程 */
  device: string | null
  projectId?: number
  updatedAt: string
}

/** APP 版本：APP 测试运行所针对的 app 版本元信息（包安装走 APP 页，不随任务下发） */
export interface AppVersion {
  id: number
  projectId: number
  /** 平台：ios / android */
  platform: string
  /** 目标应用：lita / lita lite */
  appTarget: string
  /** 版本号（如 1.2.3） */
  version: string
  remark: string | null
  createdAt: string
  updatedAt: string
}

/** 测试的一次脚本运行记录（字段与检查运行相同，脚本输出协议一致） */
export interface TestRun {
  id: number
  testId: number
  /** queued=已入队待 appium-agent 执行；running=执行中；success=全部通过；fail=有失败项；error=脚本异常 */
  status: 'queued' | 'running' | 'success' | 'fail' | 'error'
  /** 总步数（脚本 [start] 上报） */
  total: number | null
  /** 当前步数（运行中实时更新） */
  current: number
  success: number | null
  fail: number | null
  skip: number | null
  message: string | null
  /** 耗时（毫秒），结束时写入 */
  durationMs: number | null
  /** 逐项明细（结束时写入） */
  items: CheckRunItem[] | null
  /** 日志行（结束时写入） */
  logs: string[] | null
  /** 脚本原始输出行（终端展示用；运行中实时累积） */
  output: string[] | null
  /** 入队时间（APP 测试远程执行 FIFO 排序用） */
  queuedAt: string | null
  /** 关联的 APP 版本（非 APP 测试为空） */
  appVersionId: number | null
  /** 执行机标识（APP 测试记录） */
  agentName: string | null
  startedAt: string
  finishedAt: string | null
}

export interface Project {
  id: number
  name: string
  type: ProjectType
  status: ProjectStatus
  expectedReleaseAt: string | null
  iterationCycle: string | null
  priority: string | null
  /** 以下字段仅详情接口（GET /projects/:id）返回，列表接口（GET /projects）不包含 */
  resources?: { frontend?: string; backend?: string; qa?: string } | null
  /** 飞书同步的项目有 record_id，可据此判断来源 */
  feishuRecordId?: string | null
  description?: string | null
  /** 脚本目录：相对脚本根目录的路径，登记检查时只在该子目录下扫描 */
  scriptsPath?: string | null
  /** 飞书通知群：群机器人 webhook 的 secret，任务运行时向该群推送通知 */
  feishuWebhook?: string | null
  /** 缺陷多维表格地址：项目的缺陷与该表双向绑定 */
  defectBitableUrl?: string | null
  documents?: ProjectDocument[]
  checks?: ProjectCheck[]
  tests?: ProjectTest[]
  tasks?: ProjectTask[]
  defects?: Defect[]
  createdAt: string
  updatedAt: string
}

/** 缺陷：与项目设置的飞书多维表格双向绑定（拉取覆盖本地；本地状态/端变更异步回写飞书） */
export interface Defect {
  id: number
  projectId: number
  /** 问题描述（长文本截断至 500；全文在 description） */
  title: string
  /** 问题描述全文（仅详情接口返回；与 title 相同为 null） */
  description?: string | null
  /** 端（前端/后端/产品/IOS/Android…） */
  platform: string | null
  /** 状态：new/fixed/close/reopen/invalid（飞书侧乱填的选项原样保留） */
  status: string
  /** 人员（飞书同步） */
  assignee: string | null
  remark: string | null
  /** 截图：相对图片根目录的路径数组，经 /images/{path} 访问（仅详情接口返回） */
  images?: string[] | null
  /** 测试脚本：相对脚本根目录的 .test.ts 路径；非空时标记 fixed 前须最近一次运行通过 */
  testScript: string | null
  feishuRecordId: string | null
  updatedAt: string
}

/** 任务：按 crontab 表达式定时运行一个已登记的检查脚本 */
export interface ProjectTask {
  id: number
  projectId: number
  /** 标题 */
  title: string
  /** crontab 表达式（5 段：分 时 日 月 周） */
  cron: string
  /** 使用的检查脚本（checks 表 id） */
  checkId: number
  /** 是否启用（停用的任务不参与调度） */
  enabled: boolean
  /** 最近一次触发时间 */
  lastRunAt: string | null
  /** 已运行次数（任务触发累计，含失败） */
  runCount: number
  /** 下次执行时间（由 cron 表达式实时计算；停用为 null）。经 /tasks 接口返回，项目详情的关系数据不含此字段 */
  nextRunAt?: string | null
  /** 运行统计（成功/失败/总数；失败含 error）。经 /tasks 列表接口返回 */
  runStats?: { success: number; fail: number; total: number }
  /** 未来 5 次执行时间（仅 GET /tasks/:id 返回；停用为 null） */
  nextRuns?: string[] | null
  updatedAt: string
}

export interface ProjectPage {
  items: Project[]
  total: number
  iterations: string[]
  priorities: string[]
}

/** 项目表格分页查询参数（与后端 ProjectPageQuery 对应，全为空时返回全部） */
export interface ProjectPageParams {
  page: number
  pageSize?: number
  q?: string
  iteration?: string
  status?: string
  type?: string
  priority?: string
}

/** 平台设置（只读，来源于后端配置文件，不含密钥） */
export interface Settings {
  /** 运行环境（NODE_ENV） */
  environment: string
  /** 服务端口（PORT） */
  port: number
  /** 脚本根目录（CHECK_SCRIPTS_DIR） */
  scriptsDir: string
  /** 图片根目录（DIR_IMAGE_WEBROOT，经 /images 静态对外） */
  imageWebroot: string
  /** 浏览器访问地址（APP_URL） */
  appUrl: string
  /** 接口访问地址（API_URL） */
  apiUrl: string
  /** Lita 平台 API 地址（LITA_API_HOST，飞书 token 服务） */
  litaApiHost: string
  /** 项目同步源多维表格地址（FEISHU_PROJECT_SOURCE_URL，未配置用内置默认） */
  feishuProjectSourceUrl: string
  /** 飞书 token 来源：lita（LITA_USER_TOKEN 已配置）/ app-credential（自建应用凭据兜底） */
  feishuTokenSource: 'lita' | 'app-credential'
  /** 兜底通知 webhook 是否已配置（不暴露 secret） */
  feishuWebhookConfigured: boolean
  /** appium-agent 连接信息（实时：离线时 name/appiumUrl 为 null） */
  agent: {
    online: boolean
    name: string | null
    /** agent 本机 appium server 的内网地址（回环地址已替换为内网 IP） */
    appiumUrl: string | null
  }
}

/** appium-agent 包目录中的一个安装包（GET /agent/apps 实时扫描） */
export interface AgentAppPackage {
  /** 相对包目录的文件名 */
  file: string
  /** 目标平台（按扩展名推断） */
  platform: 'android' | 'ios'
  /** 文件大小（字节） */
  size: number
  /** 文件修改时间（ISO） */
  updatedAt: string
  /** 应用包名（apk 经 aapt 解析；ipa 为 null） */
  packageId: string | null
  /** 包自身版本 */
  version: string | null
  /** 模拟器内当前已装版本（未安装为 null） */
  installedVersion: string | null
  /** 路由到的模拟器名（未匹配为 null，安装时落回默认设备） */
  simulator: string | null
}

/** 受管模拟器的实时状态（GET /agent/apps/simulators） */
export interface AgentSimulator {
  /** 展示名（如 Android Lite） */
  name: string
  /** 平台：android/ios */
  platform: string
  /** 产品：lita/lite */
  product: string
  /** 应用包名 */
  packageId: string
  /** 设备在线 */
  online: boolean
  /** 机型（android ro.product.model / ios 设备名；离线或查询失败为 null） */
  model: string | null
  /** 模拟器内当前已装版本（未安装/离线为 null） */
  installedVersion: string | null
  /** 已装包的环境（仅平台安装记录与已装版本一致时给出，否则 null） */
  env: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.message ?? `请求失败 (${res.status})`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  listProjects: () => request<Project[]>('/projects'),
  /** 项目表格分页：只返回当前页 + total + 筛选值，避免全量拉回 */
  listProjectPage: (params: ProjectPageParams) => {
    const qs = new URLSearchParams()
    qs.set('page', String(params.page))
    if (params.pageSize) qs.set('pageSize', String(params.pageSize))
    if (params.q) qs.set('q', params.q)
    if (params.iteration) qs.set('iteration', params.iteration)
    if (params.status) qs.set('status', params.status)
    if (params.type) qs.set('type', params.type)
    if (params.priority) qs.set('priority', params.priority)
    return request<ProjectPage>(`/projects/page?${qs.toString()}`)
  },
  getProject: (id: number) => request<Project>(`/projects/${id}`),
  createProject: (input: {
    name: string
    type?: ProjectType
    expectedReleaseAt?: string
    description?: string
  }) => request<Project>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  deleteProject: (id: number) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),
  updateProject: (
    id: number,
    input: {
      scriptsPath?: string
      feishuWebhook?: string
      defectBitableUrl?: string
    },
  ) =>
    request<Project>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  syncProjectsFromFeishu: () =>
    request<{
      since: string
      firstSync: boolean
      scanned: number
      synced: number
    }>('/projects/sync-feishu', { method: 'POST' }),
  createDocument: (input: {
    projectId: number
    title: string
    type: DocumentType
    content?: string
  }) =>
    request<ProjectDocument>('/documents', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  importFeishuDocument: (input: {
    projectId: number
    type: DocumentType
    url: string
    description?: string
  }) =>
    request<ProjectDocument>('/documents/sync-feishu', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateDocumentRemark: (id: number, remark: string) =>
    request<ProjectDocument>(`/documents/${id}/remark`, {
      method: 'PATCH',
      body: JSON.stringify({ remark }),
    }),
  getDocument: (id: number) => request<ProjectDocument>(`/documents/${id}`),
  /** 文档列表：传 projectId 按项目过滤，不传返回全部 */
  listDocuments: (projectId?: number) =>
    request<ProjectDocument[]>(
      `/documents${projectId === undefined ? '' : `?projectId=${projectId}`}`,
    ),
  updateDocumentContent: (id: number, content: string) =>
    request<ProjectDocument>(`/documents/${id}/content`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),
  deleteDocument: (id: number) =>
    request<void>(`/documents/${id}`, { method: 'DELETE' }),
  /** 脚本自动联想：扫描 .check.ts 文件；传 projectId 时限定在项目的脚本目录下 */
  listCheckScripts: (keyword?: string, projectId?: number) => {
    const params = new URLSearchParams()
    if (keyword) params.set('q', keyword)
    if (projectId !== undefined) params.set('projectId', String(projectId))
    const qs = params.toString()
    return request<string[]>(`/checks/scripts${qs ? `?${qs}` : ''}`)
  },
  createCheck: (input: {
    projectId: number
    code: string
    description?: string
    scriptPath: string
    device?: string | null
  }) =>
    request<ProjectCheck>('/checks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCheck: (
    id: number,
    input: Partial<{
      code: string
      description: string
      scriptPath: string
      device: string | null
    }>,
  ) =>
    request<ProjectCheck>(`/checks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteCheck: (id: number) =>
    request<void>(`/checks/${id}`, { method: 'DELETE' }),
  /** 自动导入：扫描项目脚本目录下所有 .check.ts，过滤已登记的，其余全部导入 */
  importChecks: (projectId: number) =>
    request<{ created: ProjectCheck[]; skipped: number }>('/checks/import', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  getCheck: (id: number) => request<ProjectCheck>(`/checks/${id}`),
  /** 检查列表：传 projectId 按项目过滤，不传返回全部 */
  listChecks: (projectId?: number) =>
    request<ProjectCheck[]>(
      `/checks${projectId === undefined ? '' : `?projectId=${projectId}`}`,
    ),
  /** 启动一次脚本运行：立即返回 running 记录，脚本后台异步执行 */
  startCheckRun: (checkId: number) =>
    request<CheckRun>(`/checks/${checkId}/runs`, { method: 'POST' }),
  /** 运行历史（倒序，上限 50） */
  listCheckRuns: (checkId: number) =>
    request<CheckRun[]>(`/checks/${checkId}/runs`),
  /** 单次运行详情（含实时进度，运行中轮询） */
  getCheckRun: (runId: number) => request<CheckRun>(`/checks/runs/${runId}`),
  /** 测试脚本自动联想：扫描 .test.ts 文件；传 projectId 时限定在项目的脚本目录下 */
  listTestScripts: (keyword?: string, projectId?: number) => {
    const params = new URLSearchParams()
    if (keyword) params.set('q', keyword)
    if (projectId !== undefined) params.set('projectId', String(projectId))
    const qs = params.toString()
    return request<string[]>(`/tests/scripts${qs ? `?${qs}` : ''}`)
  },
  createTest: (input: {
    projectId: number
    code: string
    description?: string
    scriptPath: string
    device?: string | null
  }) =>
    request<ProjectTest>('/tests', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTest: (
    id: number,
    input: Partial<{
      code: string
      description: string
      scriptPath: string
      device: string | null
    }>,
  ) =>
    request<ProjectTest>(`/tests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteTest: (id: number) =>
    request<void>(`/tests/${id}`, { method: 'DELETE' }),
  /** 自动导入：扫描项目脚本目录下所有 .test.ts，过滤已登记的，其余全部导入 */
  importTests: (projectId: number) =>
    request<{ created: ProjectTest[]; skipped: number }>('/tests/import', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  getTest: (id: number) => request<ProjectTest>(`/tests/${id}`),
  /** 测试列表：传 projectId 按项目过滤，不传返回全部 */
  listTests: (projectId?: number) =>
    request<ProjectTest[]>(
      `/tests${projectId === undefined ? '' : `?projectId=${projectId}`}`,
    ),
  /** 启动一次测试脚本运行：APP 测试传 appVersionId 指定 app 版本，立即返回 queued/running 记录 */
  startTestRun: (testId: number, appVersionId?: number) =>
    request<TestRun>(`/tests/${testId}/runs`, {
      method: 'POST',
      body: JSON.stringify(appVersionId ? { appVersionId } : {}),
    }),
  /** 测试运行历史（倒序，上限 50） */
  listTestRuns: (testId: number) =>
    request<TestRun[]>(`/tests/${testId}/runs`),
  /** 单次测试运行详情（含实时进度，运行中轮询） */
  getTestRun: (runId: number) => request<TestRun>(`/tests/runs/${runId}`),
  /** APP 版本列表：传 projectId 按项目过滤，不传返回全部 */
  listAppVersions: (projectId?: number) =>
    request<AppVersion[]>(
      `/app-versions${projectId === undefined ? '' : `?projectId=${projectId}`}`,
    ),
  createAppVersion: (input: {
    projectId: number
    platform: string
    appTarget: string
    version: string
    remark?: string
  }) =>
    request<AppVersion>('/app-versions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteAppVersion: (id: number) =>
    request<void>(`/app-versions/${id}`, { method: 'DELETE' }),
  listTasks: (projectId?: number) =>
    request<ProjectTask[]>(
      `/tasks${projectId === undefined ? '' : `?projectId=${projectId}`}`,
    ),
  createTask: (input: {
    projectId: number
    title: string
    cron: string
    checkId: number
  }) =>
    request<ProjectTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTask: (
    id: number,
    input: Partial<{
      title: string
      cron: string
      checkId: number
      enabled: boolean
    }>,
  ) =>
    request<ProjectTask>(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteTask: (id: number) =>
    request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  getTask: (id: number) => request<ProjectTask>(`/tasks/${id}`),
  /** 任务触发的运行历史（倒序，上限 50） */
  listTaskRuns: (id: number) => request<CheckRun[]>(`/tasks/${id}/runs`),
  /** 立即触发一次任务（手动触发不受 enabled 限制），返回启动的运行记录 */
  runTask: (id: number) =>
    request<CheckRun>(`/tasks/${id}/run`, { method: 'POST' }),
  /** 平台设置：脚本目录与访问域名（只读） */
  getSettings: () => request<Settings>('/settings'),
  /** 更新脚本仓库：在脚本根目录执行 git pull，返回输出 */
  pullScripts: () =>
    request<{ output: string }>('/settings/scripts/pull', { method: 'POST' }),
  /** APP 包列表：扫描 appium-agent 包目录，含模拟器内已装版本（agent 离线 503） */
  listAgentApps: () => request<AgentAppPackage[]>('/agent/apps'),
  /** 受管模拟器实时状态：在线情况 + 已装环境/版本 */
  listAgentSimulators: () =>
    request<AgentSimulator[]>('/agent/apps/simulators'),
  /** 安装包目录中的指定包到模拟器（file 为包目录内文件名） */
  installAgentApp: (file: string) =>
    request<AgentAppPackage>('/agent/apps/install', {
      method: 'POST',
      body: JSON.stringify({ file }),
    }),
  /** 从模拟器卸载指定包名的 app */
  uninstallAgentApp: (packageId: string, platform: string) =>
    request<{ ok: true }>('/agent/apps/uninstall', {
      method: 'POST',
      body: JSON.stringify({ packageId, platform }),
    }),
  /** 缺陷列表：传 projectId 按项目过滤，不传返回全部。不含 description/images */
  listDefects: (projectId?: number) =>
    request<Defect[]>(
      `/defects${projectId === undefined ? '' : `?projectId=${projectId}`}`,
    ),
  getDefect: (id: number) => request<Defect>(`/defects/${id}`),
  /** 从项目绑定的飞书多维表格全量同步缺陷（直接覆盖本地飞书侧字段） */
  syncDefects: (projectId: number) =>
    request<{ scanned: number; created: number; updated: number }>(
      '/defects/sync',
      { method: 'POST', body: JSON.stringify({ projectId }) },
    ),
  /** 更新缺陷（端/状态/测试脚本/备注）；状态或端变更后异步回写飞书 */
  updateDefect: (
    id: number,
    input: Partial<{
      platform: string
      status: DefectStatus
      testScript: string
      remark: string
    }>,
  ) =>
    request<Defect>(`/defects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  /** 运行验证：启动缺陷测试脚本的一次运行，返回 running 记录 */
  verifyDefect: (id: number) =>
    request<TestRun>(`/defects/${id}/verify`, { method: 'POST' }),
  deleteDefect: (id: number) =>
    request<void>(`/defects/${id}`, { method: 'DELETE' }),
}
