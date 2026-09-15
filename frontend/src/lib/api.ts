/** 与后端 common/enums.ts 对应，枚举值用中文原文 */
export const PROJECT_TYPES = ['活动', '功能', '游戏', '数据', '后台', '技术', '其它'] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

export const PROJECT_STATUSES = ['计划中', '进行中', '已结束', '暂停'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** 与后端 DefectStatus 对应，平台侧统一为 开放/修复/关闭（飞书 new/reopen→开放、fixed→修复、close/invalid→关闭） */
export const DEFECT_STATUSES = ['开放', '修复', '关闭'] as const
export type DefectStatus = (typeof DEFECT_STATUSES)[number]

/** 与后端 DefectSource 对应：脚本=测试运行失败一键生成；飞书=多维表格同步；录入=人工表单 */
export const DEFECT_SOURCES = ['脚本', '飞书', '录入'] as const
export type DefectSource = (typeof DEFECT_SOURCES)[number]

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

/** 文档来源：飞书（单向同步）/ apipost（接口文档导入）/ '-'（平台内手写） */
export const DOCUMENT_SOURCES = ['飞书', 'apipost', '-'] as const
/** 来源展示文案：'-' 显示为手写 */
export function documentSourceLabel(source: string): string {
  if (source === 'apipost') return 'APIPOST'
  if (source === '-') return '手写'
  return source
}

/** 与后端 ResourceType 对应：配置=飞书配置文档（绑定文档模块）；多语言=固定多语言表的命名空间前缀（Activity/Frontend/FE/Backend 四类 SHEET）；文件资源=文件链接；UI=蓝湖设计稿地址（仅存链接不处理）；其它=自由登记 */
export const RESOURCE_TYPES = ['配置', '多语言', '文件资源', 'UI', '其它'] as const
export type ResourceType = (typeof RESOURCE_TYPES)[number]

/** 临时禁用的资源类型（与后端 DISABLED_CREATE_TYPES 同步；恢复时清空此列表） */
export const DISABLED_RESOURCE_TYPES = ['文件资源', '其它'] as const
/** 表单可选的资源类型 */
export const RESOURCE_TYPE_OPTIONS = RESOURCE_TYPES.filter(
  (t) => !(DISABLED_RESOURCE_TYPES as readonly string[]).includes(t),
)

/** 与后端 ResourceStatus 对应：缺失 → 草稿 → 确认；废弃为软删除终态（列表默认隐藏，仍可硬删） */
export const RESOURCE_STATUSES = ['缺失', '草稿', '确认', '废弃'] as const
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number]

/** 与后端 MilestoneAchieved 对应：no（默认）/yes/cancel；yes 须研发验收后标记 */
export const MILESTONE_ACHIEVED = ['no', 'yes', 'cancel'] as const
export type MilestoneAchieved = (typeof MILESTONE_ACHIEVED)[number]

/** 与后端 MilestoneStatus 对应（推导状态，不落库） */
export const MILESTONE_STATUSES = [
  '准备中',
  '提前达成',
  '达成',
  '延期',
  '取消',
] as const
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number]

/** 节点：项目在某个时间点需要完成的事项（日期=北京时间当日 23:59:59 前）；状态由后端推导 */
export interface Milestone {
  id: number
  projectId: number
  /** 应完成日期（YYYY-MM-DD） */
  date: string
  /** 达成标记：no（默认）/yes/cancel */
  achieved: MilestoneAchieved
  /** 实际达成日期（标记 yes 时自动取北京时间当天；no/cancel 为 null） */
  achievedAt: string | null
  /** 推导状态：准备中/提前达成/达成/延期/取消 */
  status: MilestoneStatus
  /** 内容：该节点要完成的事项 */
  content: string
  remark: string | null
  /** 交付人（可空） */
  deliverer: string | null
  /** 验收人（可空） */
  acceptor: string | null
  updatedAt: string
}

export interface ProjectDocument {
  id: number
  title: string
  type: string
  source: string
  /** AI 写入文档的判重标识，项目内唯一（飞书/手工创建的文档为 null） */
  fileName?: string | null
  feishuUrl: string | null
  /** 来源为 apipost 时的规范化原文链接（docs.apipost.net），兼作同步判重 key */
  apipostUrl?: string | null
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

/** 导出：本质是一个脚本（.export.ts），登记其元信息（编号/描述/脚本位置），脚本位于项目脚本目录的 exports 子目录 */
export interface ProjectExport {
  id: number
  /** 编号（手工定义，项目内唯一） */
  code: string
  /** 描述：脚本导出的内容 */
  description: string | null
  /** 脚本位置：相对脚本根目录的 .export.ts 路径 */
  scriptPath: string
  projectId?: number
  updatedAt: string
}

/** 脚本 [files] 协议上报的产出文件（file 相对本次运行的输出目录） */
export interface ExportRunFile {
  title: string
  file: string
}

/**
 * 导出的一次脚本运行记录（字段与检查运行类似，脚本输出协议一致，另有 [files] 产物清单）。
 * 产物文件经 /export-files/{exportId}/{runId}/{file} 下载。
 */
export interface ExportRun {
  id: number
  exportId: number
  /** running=执行中；success=全部通过；fail=有失败项；error=脚本异常 */
  status: 'running' | 'success' | 'fail' | 'error'
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
  /** 产出文件清单（脚本 [files] 协议上报） */
  files: ExportRunFile[] | null
  startedAt: string
  finishedAt: string | null
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
  exports?: ProjectExport[]
  tasks?: ProjectTask[]
  defects?: Defect[]
  /** 资源列表（不含多语言缓存正文、隐藏软删除；键名避开上方人员 resources） */
  projectResources?: ProjectResource[]
  /** 节点列表（按日期升序，含推导状态） */
  milestones?: Milestone[]
  createdAt: string
  updatedAt: string
}

/** 缺陷：与项目设置的飞书多维表格双向绑定（拉取覆盖本地；本地状态/端变更异步回写飞书） */
export interface Defect {
  id: number
  projectId: number
  /** 简述（标题，长文本截断至 500） */
  title: string
  /** 问题描述全文（仅详情接口返回；与 title 相同为 null） */
  description?: string | null
  /** 操作步骤与关键信息（Markdown，截图以 /images/... 内嵌；仅详情接口返回） */
  steps?: string | null
  /** 预期结果（仅详情接口返回） */
  expected?: string | null
  /** 实际结果（仅详情接口返回） */
  actual?: string | null
  /** 端（前端/后端/APP端/未知） */
  platform: string | null
  /** 状态：开放/修复/关闭 */
  status: string
  /** 来源：脚本/飞书/录入 */
  source: string
  /** 开发（飞书"人员"同步到此） */
  developer: string | null
  /** 测试 */
  tester: string | null
  remark: string | null
  /** 截图：相对图片根目录的路径数组，经 /images/{path} 访问（仅详情接口返回） */
  images?: string[] | null
  /** 测试脚本：相对脚本根目录的 .test.ts 路径；非空时标记修复前须最近一次运行通过 */
  testScript: string | null
  feishuRecordId: string | null
  /** 修复时间（验证运行通过自动流转为"修复"时记录） */
  fixedAt: string | null
  /** 验证时间（人工二次确认，改为"关闭"时记录） */
  verifiedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 资源：项目完成需要需求方提供的素材/信息（配置/多语言/文件资源/UI/其它）。"废弃"为软删除，列表默认隐藏 */
export interface ProjectResource {
  id: number
  projectId: number
  /** 类型：配置/多语言/文件资源/UI/其它 */
  type: string
  title: string
  /** 状态：缺失/草稿/确认/废弃 */
  status: string
  description: string | null
  /** 链接：配置=飞书文档 URL（可空，"缺失"表示尚未提供）；文件资源=文件 URL；UI=蓝湖地址 */
  url: string | null
  /** 配置类型绑定的文档 ID */
  documentId: number | null
  /** 多语言：命名空间前缀 {SHEET}$NAMESPACE（SHEET=Activity/Frontend/FE/Backend，省略默认 Activity）；空=缺失 */
  prefix: string | null
  remark: string | null
  /** 多语言文案缓存（word/sheet 同步的 Markdown 表格；仅详情接口返回） */
  content?: string | null
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
      type?: ProjectType
      status?: ProjectStatus
      priority?: string
      iterationCycle?: string
      /** YYYY-MM-DD，空串清除 */
      expectedReleaseAt?: string
      scriptsPath?: string
      feishuWebhook?: string
      defectBitableUrl?: string
      /** 项目描述（Markdown），空串清除 */
      description?: string
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
  /** 导入 APIPOST 接口文档（docs 文档页 / swagger 链接均可），content 存原始 swagger JSON */
  importApipostDocument: (input: {
    projectId: number
    url: string
    type?: DocumentType
    description?: string
  }) =>
    request<ProjectDocument>('/documents/sync-apipost', {
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
  /** 脚本目录自动联想：包含 .check.ts 的目录（含父目录，相对脚本根目录） */
  listScriptDirs: (keyword?: string) =>
    request<string[]>(
      `/checks/script-dirs${keyword ? `?q=${encodeURIComponent(keyword)}` : ''}`,
    ),
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
  /** 导出脚本自动联想：扫描项目脚本目录 exports 子目录下的 .export.ts 文件；传 projectId 时限定该项目 */
  listExportScripts: (keyword?: string, projectId?: number) => {
    const params = new URLSearchParams()
    if (keyword) params.set('q', keyword)
    if (projectId !== undefined) params.set('projectId', String(projectId))
    const qs = params.toString()
    return request<string[]>(`/exports/scripts${qs ? `?${qs}` : ''}`)
  },
  createExport: (input: {
    projectId: number
    code: string
    description?: string
    scriptPath: string
  }) =>
    request<ProjectExport>('/exports', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateExport: (
    id: number,
    input: Partial<{
      code: string
      description: string
      scriptPath: string
    }>,
  ) =>
    request<ProjectExport>(`/exports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteExport: (id: number) =>
    request<void>(`/exports/${id}`, { method: 'DELETE' }),
  /** 自动导入：扫描项目脚本目录 exports 子目录下所有 .export.ts，过滤已登记的，其余全部导入 */
  importExports: (projectId: number) =>
    request<{ created: ProjectExport[]; skipped: number }>('/exports/import', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  getExport: (id: number) => request<ProjectExport>(`/exports/${id}`),
  /** 导出列表：传 projectId 按项目过滤，不传返回全部 */
  listExports: (projectId?: number) =>
    request<ProjectExport[]>(
      `/exports${projectId === undefined ? '' : `?projectId=${projectId}`}`,
    ),
  /** 启动一次导出脚本运行：立即返回 running 记录，脚本后台异步执行 */
  startExportRun: (exportId: number) =>
    request<ExportRun>(`/exports/${exportId}/runs`, { method: 'POST' }),
  /** 导出运行历史（倒序，上限 50） */
  listExportRuns: (exportId: number) =>
    request<ExportRun[]>(`/exports/${exportId}/runs`),
  /** 单次导出运行详情（含实时进度与产物文件清单） */
  getExportRun: (runId: number) => request<ExportRun>(`/exports/runs/${runId}`),
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
  /** 人工/脚本一键生成缺陷（来源：脚本/录入） */
  createDefect: (input: {
    projectId: number
    title: string
    source?: DefectSource
    platform?: string
    steps?: string
    expected?: string
    actual?: string
    testScript?: string
    developer?: string
    tester?: string
    remark?: string
  }) =>
    request<Defect>('/defects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 从项目绑定的飞书多维表格全量同步缺陷（直接覆盖本地飞书侧字段） */
  syncDefects: (projectId: number) =>
    request<{ scanned: number; created: number; updated: number }>(
      '/defects/sync',
      { method: 'POST', body: JSON.stringify({ projectId }) },
    ),
  /** 更新缺陷（简述/端/状态/脚本/备注/正文/开发/测试）；状态或端变更后异步回写飞书 */
  updateDefect: (
    id: number,
    input: Partial<{
      title: string
      platform: string
      status: DefectStatus
      testScript: string
      remark: string
      steps: string
      expected: string
      actual: string
      developer: string
      tester: string
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
  /** 上传图片（Markdown 正文内嵌用），返回可访问链接 */
  uploadImage: async (file: File): Promise<{ path: string; url: string }> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/images', { method: 'POST', body: form })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.message ?? `上传失败 (${res.status})`)
    }
    return res.json() as Promise<{ path: string; url: string }>
  },
  /** 资源列表：传 projectId 按项目过滤，不传返回全部；默认隐藏软删除（includeDeleted 含全部） */
  listResources: (projectId?: number, includeDeleted = false) => {
    const params = new URLSearchParams()
    if (projectId !== undefined) params.set('projectId', String(projectId))
    if (includeDeleted) params.set('includeDeleted', 'true')
    const qs = params.toString()
    return request<ProjectResource[]>(`/resources${qs ? `?${qs}` : ''}`)
  },
  getResource: (id: number) => request<ProjectResource>(`/resources/${id}`),
  /** 创建资源；配置类型按 URL 自动绑定项目内同 URL 配置文档，否则新建文档 */
  createResource: (input: {
    projectId: number
    type: ResourceType | string
    title?: string
    /** 初始状态：缺失/草稿/确认/废弃，缺省为"缺失" */
    status?: string
    url?: string
    description?: string
    /** 多语言：命名空间前缀 {SHEET}$NAMESPACE（省略 SHEET 默认 Activity），空=缺失 */
    prefix?: string
    remark?: string
  }) =>
    request<ProjectResource>('/resources', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 更新资源（标题/状态/链接/描述/工作表/备注）；status=废弃 为软删除 */
  updateResource: (
    id: number,
    input: Partial<{
      title: string
      status: ResourceStatus | string
      url: string
      description: string
      /** 多语言：命名空间前缀（规范化存储），空串清除 */
      prefix: string
      remark: string
    }>,
  ) =>
    request<ProjectResource>(`/resources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  /** 同步：配置类型重拉绑定文档（仅飞书链接）；多语言类型按前缀拉取 Lita word/sheet 接口缓存文案 */
  syncResource: (id: number) =>
    request<ProjectResource>(`/resources/${id}/sync`, { method: 'POST' }),
  /** 硬删除（永久移除；软删除走 updateResource status=废弃） */
  deleteResource: (id: number) =>
    request<void>(`/resources/${id}`, { method: 'DELETE' }),
  /** 节点列表：传 projectId 按项目过滤，不传返回全部（全局列表页用）。按日期升序，附推导状态 */
  listMilestones: (projectId?: number) =>
    request<Milestone[]>(
      `/milestones${projectId === undefined ? '' : `?projectId=${projectId}`}`,
    ),
  createMilestone: (input: {
    projectId: number
    /** 应完成日期（YYYY-MM-DD，北京时间当日 23:59:59 前） */
    date: string
    content: string
    remark?: string
    deliverer?: string
    acceptor?: string
  }) =>
    request<Milestone>('/milestones', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 更新节点；achieved=yes 即研发验收（自动记录北京时间当天为实际达成日期），no 撤销、cancel 取消节点 */
  updateMilestone: (
    id: number,
    input: Partial<{
      date: string
      content: string
      remark: string
      deliverer: string
      acceptor: string
      achieved: MilestoneAchieved
    }>,
  ) =>
    request<Milestone>(`/milestones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteMilestone: (id: number) =>
    request<void>(`/milestones/${id}`, { method: 'DELETE' }),
}
