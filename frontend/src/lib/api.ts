/** 与后端 common/enums.ts 对应，枚举值用中文原文 */
export const PROJECT_TYPES = ['活动', '功能', '游戏', '数据', '后台', '技术', '其它'] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

export const PROJECT_STATUSES = ['待分配', '开发中', '已关闭', '暂停中', '测试中', '已发布'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** 提测记录状态（与后端 ReleaseStatus 对应）：待冒烟（默认）/ 进行中 / 已通过 / 未通过 */
export const RELEASE_STATUSES = ['待冒烟', '进行中', '已通过', '未通过'] as const
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number]

/** 与后端 DefectStatus 对应，平台侧统一为 开放/修复/关闭 */export const DEFECT_STATUSES = ['开放', '修复', '关闭'] as const
export type DefectStatus = (typeof DEFECT_STATUSES)[number]

/** 缺陷端：只保留这四类，非规范值统一为"未知"（默认） */
export const DEFECT_PLATFORMS = ['前端', '后端', 'APP端', '未知'] as const

/** 缺陷优先级：高/中/低（默认中，与后端 DefectPriority 对应） */
export const DEFECT_PRIORITIES = ['高', '中', '低'] as const
export type DefectPriority = (typeof DEFECT_PRIORITIES)[number]

/** 反馈类型（与后端 FeedbackType 对应，业务分区「反馈」）：BUG（默认）/ 建议 / 其它 */
export const FEEDBACK_TYPES = ['BUG', '建议', '其它'] as const
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]

/** 反馈状态（与后端 FeedbackStatus 对应）：待处理（默认）/ 处理中 / 已解决 / 已关闭；流转仅管理员 */
export const FEEDBACK_STATUSES = ['待处理', '处理中', '已解决', '已关闭'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

/** 反馈来源（与后端 FeedbackSource 对应）：平台=网页提交；飞书群=「系统-反馈处理」话题自动收录 */
export const FEEDBACK_SOURCES = ['平台', '飞书群'] as const
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number]

/** 灵感类型（与后端 IdeaType 对应，业务分区「灵感」）：想法（默认）/ 创意 / 待办 / 建议 / 其它 */
export const IDEA_TYPES = ['想法', '创意', '待办', '建议', '其它'] as const
export type IdeaType = (typeof IDEA_TYPES)[number]

/** 灵感状态（与后端 IdeaStatus 对应）：构思（默认）/ 废弃 / 采纳；流转仅管理员 */
export const IDEA_STATUSES = ['构思', '废弃', '采纳'] as const
export type IdeaStatus = (typeof IDEA_STATUSES)[number]

/** 迭代类型（与后端 IterationType 对应）：T0 快速通道（常驻）/ W1 周迭代 */
export const ITERATION_TYPES = ['T0', 'W1'] as const
export type IterationType = (typeof ITERATION_TYPES)[number]

/** 迭代状态（与后端 IterationStatus 对应）：进行中 / 已结束 */
export const ITERATION_STATUSES = ['进行中', '已结束'] as const
export type IterationStatus = (typeof ITERATION_STATUSES)[number]

/** 迭代项状态（与后端 BacklogStatus 对应）：等待 → 执行 → 测试 → 发布 → 完成；允许取消 */
export const BACKLOG_STATUSES = ['等待', '执行', '测试', '发布', '完成', '取消'] as const
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number]

/** 迭代项成员角色（与后端 BacklogMemberRole 对应） */
export const BACKLOG_MEMBER_ROLES = ['产品', '业务', '项目', '前端', '后端', '测试', '客户端'] as const
export type BacklogMemberRole = (typeof BACKLOG_MEMBER_ROLES)[number]

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

/** 用户角色（与后端 UserRole 对应）：首个登录用户自动为管理员 */
export const USER_ROLES = ['管理员', '成员'] as const
export type UserRole = (typeof USER_ROLES)[number]

/** 项目代码分支归类（与后端 CodeBranchCategory 对应）：该项目涉及修改的仓库/分支属于哪一端 */
export const CODE_BRANCH_CATEGORIES = ['后端', 'H5', '安卓', 'IOS', '其它'] as const
export type CodeBranchCategory = (typeof CODE_BRANCH_CATEGORIES)[number]

/** 当前登录用户（飞书 OAuth 落库，仅身份展示，接口不拦截） */
export interface User {
  id: number
  name: string
  avatarUrl: string | null
  email: string | null
  /** 部门名（主部门；应用无通讯录读权限时为 null） */
  department: string | null
  role: UserRole
  lastLoginAt: string | null
}

/** 用户系统名单条目（管理端「用户列表」页展示） */
export interface PlatformUser {
  id: number
  name: string
  department: string | null
  avatarUrl: string | null
  email: string | null
  role: UserRole
  lastLoginAt: string | null
}

/** MCP 机器人调用审计条目（管理端「MCP 调用」页展示） */
export interface McpCallLogItem {
  id: number
  userId: number
  userName: string
  workerId: number
  workerName: string
  /** 平台会话标识（mcp:{sessionId}） */
  sessionId: string
  tool: string
  status: string
  durationMs: number
  messageLength: number
  contentLength: number | null
  error: string | null
  createdAt: string
}

/** MCP 调用审计分页结果 */
export interface McpLogPage {
  items: McpCallLogItem[]
  total: number
  page: number
  pageSize: number
}

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

/** 平台内文档同步映射到知识库的固定路径 */
export function documentKnowledgePath(projectId: number, documentId: number): string {
  return `/project/${projectId}/document/${documentId}`
}

export const KNOWLEDGE_NODE_KINDS = ['directory', 'article'] as const
export type KnowledgeNodeKind = (typeof KNOWLEDGE_NODE_KINDS)[number]
export type KnowledgeNodeSource = 'native' | 'project-document' | 'system'
export type KnowledgeIndexStatus = 'pending' | 'ready' | 'error'
/** 搜索数据源：仅站内知识（飞书云文档搜索已下线） */
export type KnowledgeSearchSource = 'project'

export interface KnowledgeNode {
  id: string
  kind: KnowledgeNodeKind
  path: string
  parentPath: string
  name: string
  title: string
  content: string | null
  source: KnowledgeNodeSource
  sourceDocumentId: number | null
  contentHash: string
  indexStatus: KnowledgeIndexStatus
  indexError: string | null
  indexAttempts: number
  createdAt: string
  updatedAt: string
}

export type KnowledgeNodeSummary = Omit<
  KnowledgeNode,
  'content' | 'contentHash' | 'indexError' | 'indexAttempts'
>

export interface KnowledgeDirectory {
  path: string
  title: string
  parentPath: string | null
  directories: KnowledgeNodeSummary[]
  articles: KnowledgeNodeSummary[]
}

export interface KnowledgeSearchResult {
  nodeId: string
  title: string
  path: string
  headingPath: string
  content: string
  /** RRF 原始分（仅用于诊断） */
  score: number
  /** 归一化相关度（0..1），用于与脚本等其它来源统一排序 */
  relevance: number
  /** 原始向量余弦相似度；未命中向量时为 null */
  vectorSimilarity: number | null
  matchedBy: 'vector' | 'fulltext' | 'hybrid'
  updatedAt: string
}

export interface KnowledgeProjectSearchPage {
  page: number
  pageSize: number
  hasMore: boolean
  mode: 'hybrid' | 'fulltext'
  results: KnowledgeSearchResult[]
}

export interface KnowledgeSearchResponse {
  query: string
  source: KnowledgeSearchSource
  path: string
  page: number
  pageSize: number
  mode: 'hybrid' | 'fulltext'
  results: KnowledgeSearchResult[]
  project: KnowledgeProjectSearchPage
}

/** 知识路径逐段编码，保留层级 */
export function encodeKnowledgePath(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments.map((s) => encodeURIComponent(s)).join('/')
}

/** 知识网页地址：目录必须带结尾 /，文章不带 */
export function knowledgeWebPath(path: string, directory = false): string {
  const encoded = encodeKnowledgePath(path)
  if (!encoded) return '/docs/detail/'
  return `/docs/detail/${encoded}${directory ? '/' : ''}`
}

/** 知识 Markdown 地址：接口约定目录为 `/.md`，文章为 `.md` */
export function knowledgeMdPath(path: string, directory = false): string {
  const encoded = encodeKnowledgePath(path)
  if (!encoded) return '/api/docs/detail/.md'
  return `/api/docs/detail/${encoded}${directory ? '/.md' : '.md'}`
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
  /** 触发来源定时任务（定时任务触发时记录；手动运行为 null） */
  scheduleId?: number | null
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

// ===== 脚本库（scripts 仓库 main 分支）=====

/** 脚本库脚本类型：按文件后缀区分 */
export type ScriptLibraryKind = 'check' | 'test' | 'export'

/** 类型展示文案与筛选选项（value 与中文不一致，Select 须传 items 映射） */
export const SCRIPT_LIBRARY_KIND_ITEMS: Record<ScriptLibraryKind, string> = {
  check: '检查',
  test: '测试',
  export: '导出',
}

/** 脚本库的一次运行记录（与导出运行结构一致，另记脚本路径/类型/运行时提交） */
export interface ScriptLibraryRun {
  id: number
  /** 相对脚本根目录的路径（projects/ 下） */
  scriptPath: string
  kind: ScriptLibraryKind
  /** 运行时脚本仓库 main HEAD */
  revision: string | null
  status: 'running' | 'success' | 'fail' | 'error'
  total: number | null
  current: number
  success: number | null
  fail: number | null
  skip: number | null
  message: string | null
  durationMs: number | null
  items: CheckRunItem[] | null
  logs: string[] | null
  output: string[] | null
  files: ExportRunFile[] | null
  startedAt: string
  finishedAt: string | null
}

/** 描述生成状态 */
export type ScriptDescriptionStatus = 'pending' | 'running' | 'done' | 'error'

/** 脚本库中的一个脚本（列表条目） */
export interface ScriptLibraryScript {
  path: string
  kind: ScriptLibraryKind
  /** 文件大小（字节） */
  size: number
  updatedAt: string
  /** 登记了该脚本的检查/用例/导出所属项目 id 列表 */
  projectIds: number[]
  latestRun: ScriptLibraryRun | null
  /** 描述（脚本描述机器人生成；未生成为 null） */
  description: string | null
  /** 描述生成状态（尚无描述记录为 null） */
  descriptionStatus: ScriptDescriptionStatus | null
  /** 搜索相关度（0..1）；无关键词或详情接口为 null */
  relevance: number | null
}

/** 脚本详情（含源码与 main HEAD / GitHub 原文链接） */
export interface ScriptLibraryScriptDetail extends ScriptLibraryScript {
  content: string
  revision: string | null
  githubUrl: string
}

export interface ScriptLibraryListResponse {
  items: ScriptLibraryScript[]
  total: number
  page: number
  pageSize: number
}

/** 脚本库同步状态（scripts 仓库 main 分支定期同步） */
export interface ScriptLibrarySyncStatus {
  repo: string
  branch: string
  githubConfigured: boolean
  currentRevision: string | null
  remoteRevision: string | null
  syncing: boolean
  lastSyncAt: string | null
  lastSyncOk: boolean | null
  lastError: string | null
  lastSource: string | null
  lastDurationMs: number | null
  lastOutput: string[]
  /** 描述队列统计（脚本描述机器人 #3 生成进度） */
  descriptions?: {
    pending: number
    running: number
    done: number
    error: number
  }
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

/** GitHub 组织下的仓库（GET /github/repos 搜索联想用，已裁剪字段） */
export interface GithubRepo {
  /** 仓库名（如 lita-android） */
  name: string
  /** 仓库全名（owner/name，如 LitaGroup/lita-android） */
  fullName: string
  private: boolean
  description: string | null
  /** 默认分支名（通常 main） */
  defaultBranch: string
  htmlUrl: string
  language: string | null
  updatedAt: string
}

/** 仓库端（与后端 RepoPlatform 对应）：仓库列表展示/筛选，同时作为新建项目代码分支的默认归类来源 */
export const REPO_PLATFORMS = ['前端', '后端', '安卓', '苹果', '其它'] as const
export type RepoPlatform = (typeof REPO_PLATFORMS)[number]

/** 仓库状态：忽略后不再出现在仓库联想与代码分支候选（存量登记保留） */
export const REPO_STATUSES = ['有效', '忽略'] as const
export type RepoStatus = (typeof REPO_STATUSES)[number]

/** 代码仓库登记（组织仓库清单同步 + 平台侧维护的端/状态） */
export interface Repo {
  id: number
  /** 仓库名（如 lita-android） */
  name: string
  /** 仓库全名（owner/name，如 LitaGroup/lita-android） */
  fullName: string
  description: string | null
  htmlUrl: string | null
  defaultBranch: string | null
  language: string | null
  platform: RepoPlatform
  status: RepoStatus
  /** 仓库最后被更新的时间（GitHub updated_at） */
  lastUpdatedAt: string | null
  remark: string | null
  createdAt: string
  updatedAt: string
}

/** 项目代码分支：项目涉及修改的 GitHub 仓库与分支登记（登记后自动监听新提交/合并） */
export interface ProjectBranch {
  id: number
  projectId: number
  /** 仓库全名（owner/name，如 LitaGroup/lita-android） */
  repo: string
  /** 分支名（通常 test/main/stable 等被监听的分支） */
  branch: string
  /** 归类：后端/H5/安卓/IOS/其它 */
  category: CodeBranchCategory
  remark: string | null
  createdAt: string
  updatedAt: string
}

/** 代码事件：监听到的 GitHub 提交/合并记录（append-only，按提交时间倒序） */
export interface CodeEvent {
  id: number
  /** 仓库全名（owner/name） */
  repo: string
  branch: string
  /** 提交 SHA（40 位） */
  sha: string
  /** 提交信息全文 */
  message: string
  /** 提交作者名 */
  author: string | null
  /** 是否合并提交（parents > 1） */
  isMerge: boolean
  /** 提交页面链接 */
  url: string | null
  /** 提交时间 */
  committedAt: string
  /** 平台发现时间 */
  createdAt: string
  /** 登记了该 仓库+分支 的项目（一个组合可关联多项目） */
  projects: { id: number; name: string }[]
}

/** 提测单上的代码分支（仓库 + 分支，提测时快照） */
export interface ReleaseBranch {
  repo: string
  branch: string
}

/** 项目提测记录：点「提测」生成，项目状态随之流转「测试中」；允许重复提测追加 */
export interface ProjectRelease {
  id: number
  projectId: number
  /** 提测内容（Markdown，可空） */
  content: string | null
  /** 访问地址（可空） */
  urls: string[] | null
  /** 代码分支（仓库+分支 列表，可空） */
  branches: ReleaseBranch[] | null
  /** 测试人员姓名（至少 1 个，均为用户系统内用户） */
  testers: string[]
  /** 提测人姓名（机器人提测时为机器人名称） */
  operator: string | null
  /** 发起提测的机器人（人工提测为空） */
  workerId: number | null
  /** 发起提测时机器人正在执行的任务 */
  sourceTaskId: number | null
  /** 提测状态：待冒烟（默认）/ 进行中 / 已通过 / 未通过 */
  status: ReleaseStatus
  /** 判定人姓名（已通过/未通过时记录，待冒烟/进行中为空） */
  verifier: string | null
  /** 判定时间（已通过/未通过时记录，待冒烟/进行中为空） */
  verifiedAt: string | null
  /** 提测时间 */
  createdAt: string
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
  resources?: { frontend?: string; backend?: string; qa?: string; product?: string; client?: string } | null
  /** 飞书同步的项目有 record_id，可据此判断来源 */
  feishuRecordId?: string | null
  description?: string | null
  /** 脚本目录：相对脚本根目录的路径，登记检查时只在该子目录下扫描 */
  scriptsPath?: string | null
  documents?: ProjectDocument[]
  checks?: ProjectCheck[]
  tests?: ProjectTest[]
  exports?: ProjectExport[]
  tasks?: ProjectSchedule[]
  defects?: Defect[]
  /** 资源列表（不含多语言缓存正文、隐藏软删除；键名避开上方人员 resources） */
  projectResources?: ProjectResource[]
  /** 节点列表（按日期升序，含推导状态） */
  milestones?: Milestone[]
  /** 代码分支登记（仓库+分支+归类） */
  projectBranches?: ProjectBranch[]
  /** 提测记录（倒序） */
  projectReleases?: ProjectRelease[]
  /** 项目开发交付任务及进展（详情接口附带） */
  projectDeliveryTask?: ProjectDeliveryTaskView | null
  /** 项目任务板块：任务/子任务与关联工单（详情接口附带） */
  projectWorkItems?: ProjectWorkItem[]
  createdAt: string
  updatedAt: string
}

/** 迭代分组视图单项（与后端 IterationGroup 对应，GET /projects/iterations） */
export interface IterationGroup {
  /** 迭代周期原值；'-' 表示未排期 */
  cycle: string
  /** 解析自 `w{n}: MM/DD-MM/DD` 的周编号；无法解析为 null */
  week: number | null
  /** 日期区间（如 `08/19-08/25`）；无法解析为 null */
  dateRange: string | null
  /** 今天（北京时间）是否落在该周期 */
  current: boolean
  total: number
  /** 各状态需求数 */
  statusCounts: Partial<Record<ProjectStatus, number>>
  items: Project[]
}

/** 迭代项成员（角色 + 平台用户 + 姓名快照） */
export interface BacklogMember {
  role: BacklogMemberRole
  userId: number
  name: string
}

/** 迭代进度汇总（与后端 IterationProgress 对应） */
export interface IterationProgress {
  total: number
  done: number
  percent: number
  statusCounts: Partial<Record<BacklogStatus, number>>
}

/** 迭代列表项（GET /iterations，含 backlog 进度） */
export interface IterationSummary extends IterationProgress {
  id: number
  code: string
  type: IterationType
  name: string
  startAt: string | null
  endAt: string | null
  status: IterationStatus
  /** 是否当前迭代（W1 今天在起止区间内；T0 恒为 true） */
  current: boolean
  createdAt: string
  updatedAt: string
}

/** 迭代项（Backlog）：从需求转入，指定负责人机器人后自动创建交付任务 */
export interface Backlog {
  id: number
  code: string
  iterationId: number
  /** 原始需求（projects.id） */
  projectId: number
  /** 迭代项自己的标题（转入后异步由 title-naming 模型生成，兜底为需求名） */
  title: string
  status: BacklogStatus
  ownerWorkerId: number | null
  ownerName: string | null
  /** 预期上线时间（到小时，北京时间展示；可空） */
  expectedOnlineAt: string | null
  members: BacklogMember[] | null
  /** 自动创建的交付任务（tasks.id） */
  taskId: number | null
  statusBy: string | null
  startedAt: string | null
  testingAt: string | null
  releasingAt: string | null
  completedAt: string | null
  canceledAt: string | null
  createdAt: string
  updatedAt: string
}

/** 迭代项提测工单工作流可用性（详情接口返回，供提测按钮置灰） */
export interface BacklogReleaseWorkflow {
  id: number
  /** 已启用且已发布版本（可创建工单） */
  enabled: boolean
}

/** 迭代项详情（GET /backlogs/:id）：迭代项 + 提测工作流信息 */
export interface BacklogDetail extends Backlog {
  releaseWorkflow: BacklogReleaseWorkflow | null
}

/** 迭代项关联文档摘要（不含正文大字段） */
export type BacklogDocumentSummary = ProjectDocument

/** 迭代项事件（append-only）：created / status / moved / release-ticket 等 */
export interface BacklogEvent {
  id: number
  backlogId: number
  type: string
  /** 事件明细（status: { from, to, remark } 等） */
  payload: Record<string, unknown> | null
  operator: string | null
  createdAt: string
}

/** 迭代项任务面板任务摘要（交付任务树，含子任务） */
export interface BacklogTaskSummary {
  id: number
  code: string
  title: string
  type: string
  status: string
  subStatus: string
  parentId: number | null
  rootId: number
  projectId: number | null
  agentId: number | null
  templateName: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 迭代项任务面板工单摘要（直接关联 + 任务树关联） */
export interface BacklogTicketSummary {
  id: number
  code: string
  title: string
  category: string
  workflowStatus: string | null
  currentNodeName: string | null
  initiatorWorkerName: string | null
  createdAt: string
  updatedAt: string
}

/** 迭代项详情（GET /iterations/:id）：迭代信息 + 迭代项列表 */
export interface IterationDetail extends IterationSummary {
  backlogs: Backlog[]
}

/** 缺陷：仅平台内维护（接口/人工创建），属性只保留 端/预期/实际/图片/用例脚本/状态 */
export interface Defect {
  id: number
  projectId: number
  /** 端（前端/后端/APP端/未知） */
  platform: string | null
  /** 优先级：高/中/低（默认中） */
  priority: string
  /** 预期功能描述 */
  expected: string
  /** 实际结果描述 */
  actual: string
  /** 图片：/images/... 路径数组（最多 9 张，经 POST /api/images 上传） */
  images: string[] | null
  /** 状态：开放/修复/关闭 */
  status: string
  /** 用例脚本：相对脚本根目录的 .test.ts 路径；配置后脚本回归通过时后端自动把"修复"态流转为"关闭" */
  testScript: string | null
  /** 修复时间（状态置"修复"时记录） */
  fixedAt: string | null
  /** 验证时间（人工二次确认，改为"关闭"时记录） */
  verifiedAt: string | null
  /** 来源提测记录（机器人提测后的新缺陷自动关联） */
  releaseId: number | null
  /** 自动创建的缺陷处理任务 */
  followupTaskId: number | null
  createdAt: string
  updatedAt: string
}

/** 用户反馈（BUG REPORT）：业务分区「反馈」，独立于研发缺陷；列表接口不含 content 正文 */
export interface Feedback {
  id: number
  title: string
  /** 类型：BUG（默认）/ 建议 / 其它 */
  type: FeedbackType
  /** 来源：平台（默认）/ 飞书群（反馈群话题自动收录） */
  source: FeedbackSource
  /** 状态：待处理（默认）/ 处理中 / 已解决 / 已关闭 */
  status: FeedbackStatus
  /** 问题描述（Markdown）；仅详情接口返回 */
  content?: string
  /** 图片：/images/... 路径数组（最多 9 张，经 POST /api/images 上传） */
  images: string[] | null
  reporterId: number | null
  reporterName: string | null
  /** 飞书来源群 chat_id（详情返回；平台提交为空） */
  sourceChatId?: string | null
  /** 飞书来源话题 thread_id（一个话题一条反馈；详情返回） */
  sourceThreadId?: string | null
  /** 飞书来源首帖消息 id（详情返回） */
  sourceMessageId?: string | null
  /** 处理人（管理员流转时写入） */
  handlerName: string | null
  /** 收录后自动创建的处理任务 ID（tasks.id，详情返回；无任务为空） */
  taskId?: number | null
  /** 处理备注（仅管理员可写） */
  handleNote: string | null
  /** 解决时间（置已解决/已关闭时记录） */
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 反馈跟帖（append-only）：飞书群话题内后续成员消息的自动收录 */
export interface FeedbackReply {
  id: number
  feedbackId: number
  senderName: string | null
  senderUserId: number | null
  senderOpenId: string | null
  content: string
  images: string[] | null
  sourceMessageId: string | null
  sourceThreadId: string | null
  createdAt: string
}

/** 灵感：业务分区「灵感」收集想法/创意/待办/建议；构思期全员可编辑，采纳即进入需求池 */
export interface Idea {
  id: number
  title: string
  /** 类型：想法（默认）/ 创意 / 待办 / 建议 / 其它 */
  type: IdeaType
  /** 状态：构思（默认）/ 废弃 / 采纳 */
  status: IdeaStatus
  /** 正文（Markdown，可空）；仅详情接口返回 */
  content?: string
  /** 图片：/images/... 路径数组（最多 9 张，经 POST /api/images 上传） */
  images: string[] | null
  creatorId: number | null
  creatorName: string | null
  /** 采纳后关联的需求池项目 ID */
  projectId: number | null
  /** 采纳时间（退回构思/废弃时清空） */
  adoptedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 缺陷变更记录来源：录入=前端表单 / AI=.md 接口 / 自动=脚本回归通过自动流转 */
export const DEFECT_RECORD_SOURCES = ['录入', 'AI', '自动'] as const

/** 缺陷变更记录（append-only，不可编辑删除；倒序返回） */
export interface DefectChangeRecord {
  id: number
  defectId: number
  projectId: number
  /** 变更内容（本次改了什么） */
  content: string
  /** 备注信息 */
  remark: string | null
  /** 记录时缺陷状态（变更后的状态） */
  status: string
  /** 记录来源：录入/AI/自动 */
  source: string
  /** 操作人姓名（agent 令牌对应用户 / 网页登录用户；系统自动流转为空） */
  operator: string | null
  createdAt: string
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

/** 定时任务（调度）：按 crontab 表达式定时运行一个已登记的检查脚本 */
export interface ProjectSchedule {
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
  /** 下次执行时间（由 cron 表达式实时计算；停用为 null）。经 /schedules 接口返回，项目详情的关系数据不含此字段 */
  nextRunAt?: string | null
  /** 运行统计（成功/失败/总数；失败含 error）。经 /schedules 列表接口返回 */
  runStats?: { success: number; fail: number; total: number }
  /** 未来 5 次执行时间（仅 GET /schedules/:id 返回；停用为 null） */
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
  /** Lita 平台 API 地址（LITA_API_HOST，多语言文案等平台接口） */
  litaApiHost: string
  /** 项目同步源多维表格地址（FEISHU_PROJECT_SOURCE_URL，未配置用内置默认） */
  feishuProjectSourceUrl: string
  /** 平台官方机器人（飞书统一凭据：tenant token 与 OAuth 登录）配置状态 */
  feishuOfficialBot: {
    configured: boolean
    appId: string | null
    enabled: boolean
  }
  /** GitHub 集成：token 配置状态（不回显明文）与组织名 */
  github: {
    tokenConfigured: boolean
    org: string
  }
  /** 公共 Agent 访问令牌是否已配置（PUBLIC_AGENT_TOKEN，不回显明文） */
  publicAgentTokenConfigured: boolean
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

/** 401 统一处理：会话缺失/过期跳转登录页；/auth/*（getMe 等）由调用方自行消化未登录态，避免循环跳转 */
function handleUnauthorized(path: string): void {
  if (!path.startsWith('/auth/')) {
    window.location.href = `/login?error=${encodeURIComponent('请先登录')}`
  }
}

/** 我的 AI：详情页上下文 -> query 参数 */
function agentPageContextQuery(context?: AgentPageContext | null): string {
  if (!context) return ''
  const params = new URLSearchParams()
  params.set('contextType', context.type)
  params.set('contextId', context.id)
  if (context.title) params.set('contextTitle', context.title)
  if (context.summary) params.set('contextSummary', context.summary)
  if (context.readUrl) params.set('contextReadUrl', context.readUrl)
  return params.toString()
}

/** 我的 AI：详情页上下文 -> POST body */
function agentPageContextBody(
  context?: AgentPageContext | null,
): Record<string, string> {
  if (!context) return {}
  return {
    contextType: context.type,
    contextId: context.id,
    ...(context.title ? { contextTitle: context.title } : {}),
    ...(context.summary ? { contextSummary: context.summary } : {}),
    ...(context.readUrl ? { contextReadUrl: context.readUrl } : {}),
  }
}

/** 顶部「机器人」一对一聊天 SSE 地址 */
export function workerChatStreamUrl(workerId: number): string {
  return `/api/worker-chats/${workerId}/stream`
}

/** 我的 AI SSE 地址（工作台/详情页共用） */
export function workbenchAgentStreamUrl(
  taskId?: number | null,
  context?: AgentPageContext | null,
): string {
  const query = [
    taskId ? `taskId=${encodeURIComponent(taskId)}` : '',
    agentPageContextQuery(context),
  ]
    .filter(Boolean)
    .join('&')
  return `/api/workbench/agent/stream${query ? `?${query}` : ''}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (res.status === 401) handleUnauthorized(path)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.message ?? `请求失败 (${res.status})`)
  }
  if (res.status === 204) return undefined as T
  // 空响应体（如可空详情返回 null）按 null 处理，避免 JSON 解析异常
  const text = await res.text()
  if (!text) return null as T
  return JSON.parse(text) as T
}

// ===== 任务处理中心（FEATURE-02）=====

export const EXECUTOR_TYPES = ['opencode', 'codex', 'claude-code'] as const
export type ExecutorType = (typeof EXECUTOR_TYPES)[number]

export const WORKER_ROLES = ['工作者', '调度器'] as const
export type WorkerRole = (typeof WORKER_ROLES)[number]

export const WORKER_RUNTIMES = ['opencode', 'human'] as const
export type WorkerRuntime = (typeof WORKER_RUNTIMES)[number]

export const WORKER_LIVE_STATUSES = ['空闲中', '工作中', '等待中', '验收中'] as const
export type WorkerLiveStatus = (typeof WORKER_LIVE_STATUSES)[number]

/** 机器人 GitHub 权限：可配置档位为 develop（开发权限，默认）/ release（发布权限）；none 为真人/个人 AGENT 内部兜底，不作为配置项 */
export const WORKER_GITHUB_PERMISSIONS = ['develop', 'release'] as const
export type WorkerGithubPermission =
  | 'none'
  | (typeof WORKER_GITHUB_PERMISSIONS)[number]

export const WORKER_GITHUB_PERMISSION_LABELS: Record<WorkerGithubPermission, string> = {
  none: '无权限',
  develop: '开发权限',
  release: '发布权限',
}

/** 机器人资源网关权限：none（无权限，默认）/ read（仅只读资源）/ write（全部资源） */
export const WORKER_RESOURCE_PERMISSIONS = ['none', 'read', 'write'] as const
export type WorkerResourcePermission =
  (typeof WORKER_RESOURCE_PERMISSIONS)[number]

export const WORKER_RESOURCE_PERMISSION_LABELS: Record<
  WorkerResourcePermission,
  string
> = {
  none: '无权限',
  read: '只读资源',
  write: '全部资源',
}

// ===== MCP 配置（管理区） =====

/** MCP 服务类型：opencode V2 支持 remote（Streamable HTTP）与 local（stdio 命令） */
export const MCP_SERVER_TYPES = ['remote', 'local'] as const
export type McpServerType = (typeof MCP_SERVER_TYPES)[number]

export const MCP_SERVER_TYPE_LABELS: Record<McpServerType, string> = {
  remote: 'Streamable HTTP',
  local: 'stdio 本地命令',
}

/** MCP 鉴权方式：固定令牌 / 环境变量（{env:NAME} 占位）/ 平台 LITA_WORK_TOKEN */
export const MCP_AUTH_MODES = ['none', 'fixed', 'env', 'work-token'] as const
export type McpAuthMode = (typeof MCP_AUTH_MODES)[number]

export const MCP_AUTH_MODE_LABELS: Record<McpAuthMode, string> = {
  none: '无鉴权',
  fixed: '固定令牌',
  env: '环境变量',
  'work-token': 'LITA_WORK_TOKEN',
}

/** MCP 配置（列表/详情；固定令牌只返回是否已配置，不回显原文） */
export interface McpServerConfig {
  id: number
  name: string
  type: McpServerType
  url: string | null
  command: string[] | null
  authMode: McpAuthMode
  authHeader: string
  authPrefix: string | null
  hasSecret: boolean
  /** env 模式的环境变量名（非敏感） */
  envName: string | null
  enabled: boolean
  remark: string | null
  createdAt: string
  updatedAt: string
}

/** 机器人可选 MCP 服务（非管理入口读取；不含地址、命令与鉴权信息） */
export interface McpServerOption {
  id: number
  name: string
  type: McpServerType
  enabled: boolean
  remark: string | null
}

/** 保存 MCP 配置入参（编辑时未传字段保持原值；固定令牌留空保持不变） */
export interface McpServerSaveInput {
  name: string
  type: McpServerType
  url?: string | null
  command?: string[] | string | null
  authMode: McpAuthMode
  authHeader?: string | null
  authPrefix?: string | null
  authSecret?: string | null
  enabled?: boolean
  remark?: string | null
}

/** MCP 配置连接测试结果 */
export interface McpServerTestResult {
  status: 'connected' | 'auth-rejected' | 'unreachable'
  message: string
  serverName: string | null
  serverVersion: string | null
  toolCount: number | null
  tools: string[]
  durationMs: number
}

/** SSO 接入方（管理区列表/详情；密钥只返回是否已配置，不回显原文） */
export interface SsoClientConfig {
  id: number
  name: string
  clientId: string
  /** 回调地址白名单（精确匹配） */
  redirectUris: string[]
  enabled: boolean
  remark: string | null
  hasSecret: boolean
  createdAt: string
  updatedAt: string
}

/** 保存 SSO 接入方入参（编辑时未传字段保持原值） */
export interface SsoClientSaveInput {
  name: string
  redirectUris: string[]
  enabled?: boolean
  remark?: string | null
}

/** 新建/重置密钥响应：clientSecret 仅本次一次性返回 */
export interface SsoClientCreated extends SsoClientConfig {
  clientSecret: string
}

// ===== 模型配置（管理区） =====

/** 模型思考等级：off 关闭思考（最低档），其余逐级提高 */
export const MODEL_THINKING_LEVELS = ['off', 'low', 'medium', 'high'] as const
export type ModelThinkingLevel = (typeof MODEL_THINKING_LEVELS)[number]

export const MODEL_THINKING_LEVEL_LABELS: Record<
  ModelThinkingLevel,
  string
> = {
  off: '关闭（最低）',
  low: '低',
  medium: '中',
  high: '高',
}

/** 固定模型场景 + 已保存配置（apiKey 只返回是否已配置，不回显原文） */
export interface ModelScenarioConfig {
  scenario: string
  name: string
  description: string
  /** baseUrl 与 model 均已配置，可供调用 */
  configured: boolean
  baseUrl: string | null
  model: string | null
  thinking: ModelThinkingLevel
  hasApiKey: boolean
  updatedAt: string | null
}

/** 保存场景配置入参：apiKey 未传保持原值，空串清除 */
export interface ModelScenarioSaveInput {
  baseUrl?: string | null
  apiKey?: string | null
  model?: string | null
  thinking?: ModelThinkingLevel
}

/** 任务主状态：等待中 / 进行中 / 已结束 */
export const TASK_STATUSES = ['等待中', '进行中', '已结束'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** 任务类型：普通 / 审批（工单审批节点任务，创建后自动接受） */
export const TASK_TYPES = ['普通', '审批'] as const
export type TaskType = (typeof TASK_TYPES)[number]

/** 任务子状态：与主状态严格对应（等待中：待分配/待接受/待反馈/待继续/待申请验收/待验收；进行中：执行中；已结束：完成/已拒绝/失败/取消） */
export const TASK_SUB_STATUSES = [
  '待分配',
  '待接受',
  '待反馈',
  '待继续',
  '待申请验收',
  '待验收',
  '执行中',
  '完成',
  '已拒绝',
  '失败',
  '取消',
] as const
export type TaskSubStatus = (typeof TASK_SUB_STATUSES)[number]

/** 执行器：实际执行任务的工具实例（本期 opencode server） */
export interface ExecutorProviderModelVariant {
  id: string
  name: string
}
export interface ExecutorProviderModel {
  id: string
  name: string
  /** 可选思考等级；旧缓存没有该字段时前端触发一次重新同步 */
  variants?: ExecutorProviderModelVariant[]
}
export interface ExecutorProvider {
  id: string
  name: string
  models: ExecutorProviderModel[]
}
export interface Executor {
  id: number
  name: string
  ip: string
  port: number
  type: ExecutorType
  description: string | null
  token: string | null
  enabled: boolean
  /** 健康检查推导：在线/离线 */
  online: boolean
  version: string | null
  /** server 默认工作目录 */
  defaultLocation: string | null
  providersCache: ExecutorProvider[] | null
  providersSyncedAt: string | null
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 技能库目录条目 */
export interface WorkerSkillCatalogItem {
  name: string
  description: string | null
  version: string | null
  path: string
  url: string
  sourceUrl: string
}

/** 规范库目录条目（README 所在目录，初始化时整目录同步） */
export interface WorkerStandardCatalogItem {
  name: string
  description: string | null
  version: string | null
  /** 仓库内 README.md 相对路径，如 fe/h5/README.md */
  path: string
  /** README 所在目录，如 fe/h5 */
  directory: string
  url: string
  sourceUrl: string
}

/** 机器人技能引用（保存后安装到工位 .opencode/skills） */
export interface WorkerSkill {
  name: string
  path: string
  url: string
  description?: string | null
  version?: string | null
  sourceUrl?: string | null
}

/** 机器人规范引用（保存后初始化时同步其目录到工位 .opencode/rules） */
export interface WorkerStandard {
  name: string
  path: string
  directory: string
  url: string
  description?: string | null
  version?: string | null
  sourceUrl?: string | null
}
export interface WorkerTaskDef {
  inputs: { name: string; desc?: string; required?: boolean }[]
  outputs: { name: string; desc?: string }[]
  how?: string
}

/** 机器人（工作者/调度机器人统一）：附工位路径与实时状态（服务端实时计算） */
export interface Worker {
  id: number
  name: string
  intro: string | null
  /** 系统机器人稳定标识（自定义机器人为 null） */
  systemKey: string | null
  /** 头像：/images/... 路径（空为默认黑底占位头像） */
  avatarUrl: string | null
  role: WorkerRole
  runtime: WorkerRuntime
  executorId: number | null
  providerId: string | null
  modelId: string | null
  /** 默认思考等级（opencode variant id；空=模型默认） */
  variant: string | null
  /** 备用模型：主模型限额/限流/token 用尽时自动切换（空=未配置） */
  backupProviderId: string | null
  backupModelId: string | null
  backupVariant: string | null
  prompt: string | null
  skills: WorkerSkill[] | null
  standards: WorkerStandard[] | null
  /** 勾选的 MCP 配置 id（管理区「MCP 配置」） */
  mcps: number[] | null
  taskDefs: WorkerTaskDef[] | null
  ownerUserId: number | null
  ownerName: string | null
  /** 真人机器人绑定的用户；runtime=human 时即实际执行人 */
  humanUserId: number | null
  humanUserName: string | null
  /** 个人 AI AGENT 的归属用户；工作台「我的 AGENT」使用该机器人 */
  personalAgentUserId: number | null
  /** GitHub 权限：none（内部兜底）/ develop（开发权限）/ release（发布权限） */
  githubPermission: WorkerGithubPermission
  /** 资源网关权限：none（无权限）/ read（仅只读资源）/ write（全部资源） */
  resourcePermission: WorkerResourcePermission
  /** 并行执行上限：同一时刻可执行的任务数（仅 AI 机器人；1 表示串行，默认 3） */
  maxParallelTasks: number
  enabled: boolean
  /** 系统机器人（代码内置，网页不可新增/删除） */
  system: boolean
  /** 工位路径：生产 {WORKER_BASE_DIR}/worker/{id}，开发 {WORKER_BASE_DIR}/worker-dev/{id}（未配置 env 为 null） */
  workdir: string | null
  liveStatus: WorkerLiveStatus
  activeTask: { id: number; code: string; title: string; status: string } | null
  /** 当前执行中的任务数（与 maxParallelTasks 对照展示并行占用） */
  executingCount: number
  /** 已绑定独立飞书应用（头像角标用） */
  feishuBound?: boolean
  createdAt: string
  updatedAt: string
}

/** 顶部「机器人」聊天会话摘要 */
export interface WorkerChatSession {
  worker: WorkerDebugOption
  /** 会话创建时间，即首条消息时间 */
  startedAt: string
}

/** 可调试 Agent（仅启用、执行器在线且模型配置完整的机器人） */
export interface WorkerDebugOption {
  id: number
  name: string
  intro: string | null
  avatarUrl: string | null
  executorName: string
  providerId: string
  modelId: string
  /** 机器人默认思考等级（空=模型默认） */
  variant: string | null
}

/** 机器人提问（调试对话中的问答卡片，结构与任务对话的 TaskChatQuestion 一致） */
export interface WorkerDebugQuestion {
  id: string
  /** 提问所在 opencode 会话（可能是子会话） */
  sessionId: string
  questions: TaskChatQuestionInfo[]
  state: TaskChatQuestionState
  /** 按问题顺序的答案（选项 label + 自定义文本），仅 answered 有值 */
  answers?: string[][]
  askedAt: string
  toolCallId?: string
}

export interface WorkerDebugTool {
  id: string
  name: string
  status: 'running' | 'success' | 'error'
  /** 工具参数（JSON 文本） */
  argsText?: string
  /** 工具结果或错误 */
  result?: string
  startedAt?: string
  finishedAt?: string
}

export interface WorkerDebugMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 用户消息携带的附件（文件上传后的公开地址） */
  files?: WorkerDebugAttachment[]
  /** 流式累积的思考内容（session.reasoning.* 事件；可能为空） */
  reasoning?: string
  status: 'running' | 'complete' | 'error'
  createdAt: string
  /** message=普通对话气泡；question=机器人提问卡片（缺省按 message 处理） */
  kind?: 'message' | 'question'
  /** kind=question 时的问答卡片数据 */
  question?: WorkerDebugQuestion
  /** 本轮工具调用（session.tool.* 事件实时累积） */
  tools?: WorkerDebugTool[]
}

/** 对话附件 */
export interface WorkerDebugAttachment {
  name: string
  url: string
  size?: number
  mime?: string
}

/** 调试会话当前模型与思考等级 */
export interface WorkerDebugModelSelection {
  providerId: string
  modelId: string
  variant: string | null
}

/** 模型可选思考等级 */
export interface WorkerDebugModelVariant {
  id: string
  name: string
}

export interface WorkerDebugModel {
  id: string
  name: string
  variants: WorkerDebugModelVariant[]
}

export interface WorkerDebugModelProvider {
  id: string
  name: string
  models: WorkerDebugModel[]
}

/** 我的 AGENT 模型选择器数据 */
export interface WorkerDebugModelCatalog {
  current: WorkerDebugModelSelection
  providers: WorkerDebugModelProvider[]
}

/** opencode 待办（todowrite 工具产出，随调试快照返回） */
export interface WorkerDebugTodo {
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority?: string
}

/** 调试对话快照；同一用户 + 机器人固定绑定一个 sessionId，7 天不活跃才重置 */
export interface WorkerDebugSnapshot {
  worker: WorkerDebugOption
  /** 当前选择/生效的模型与思考等级 */
  model: WorkerDebugModelSelection
  sessionId: string | null
  status: 'idle' | 'running'
  messages: WorkerDebugMessage[]
  /** 最近一次 todowrite 的待办清单（右侧待办面板数据源） */
  todos: WorkerDebugTodo[]
  error: string | null
  updatedAt: string
}

/** 机器人工作环境初始化状态 */
export type WorkerInitializeStatus = 'idle' | 'running' | 'success' | 'failed'

/** 初始化快照：POST 响应、GET 查询与 SSE snapshot 事件共用 */
export interface WorkerInitializeSnapshot {
  workerId: number
  status: WorkerInitializeStatus
  /** 进度行（时间正序，最新在末尾） */
  lines: string[]
  error: string | null
  workdir: string | null
  startedAt: string | null
  finishedAt: string | null
}

/** 机器人 AGENTS.md 优化状态 */
export type WorkerOptimizeStatus = 'running' | 'success' | 'failed'

/** 优化快照：POST 响应、GET 查询与 SSE snapshot 事件共用 */
export interface WorkerOptimizeSnapshot {
  runId: string
  status: WorkerOptimizeStatus
  /** 进度行（时间正序，最新在末尾） */
  lines: string[]
  /** 优化后的 Markdown（status=success 时非空） */
  prompt: string | null
  error: string | null
  startedAt: string
  finishedAt: string | null
}

/** 任务待反馈事项（需要用户补充/确认什么） */
export interface TaskMissingItem {
  item: string
  reason?: string
}

/** 任务流转事件（append-only） */
export interface TaskEvent {
  id: number
  taskId: number
  type: string
  content: string
  meta: Record<string, unknown> | null
  operator: string | null
  createdAt: string
}

/** 调度方案（调度机器人产出，历史保留） */
export interface PlanSubtask {
  title: string
  type: string
  input?: string
  outputSpec?: string
  agentId?: number | null
  agentName?: string
}
export interface DispatchPlan {
  id: number
  taskId: number
  schedulerId: number | null
  plan: {
    identification: { type?: string; input?: string; output?: string; summary?: string }
    missingItems?: TaskMissingItem[]
    subtasks?: PlanSubtask[]
  }
  status: '待确认' | '已确认' | '已驳回'
  operator: string | null
  operatedAt: string | null
  createdAt: string
}

/** 任务：明确输入/输出/任务定义，可挂子任务形成工作流 */
export interface TaskPackage {
  id: number
  code: string
  title: string
  /** 任务类型：普通（默认）/ 审批 */
  type: TaskType
  /** 任务定义（task_templates.id，可空） */
  templateId: number | null
  /** 任务定义名称快照 */
  templateName: string | null
  /** 关联项目（项目交付任务使用） */
  projectId: number | null
  parentId: number | null
  rootId: number
  sortOrder: number
  description: string | null
  input: string | null
  /** 需求内容（AI 分析整理后的需求，含需求澄清与补充详情） */
  content: string | null
  outputSpec: string | null
  missingItems: TaskMissingItem[] | null
  /** 主状态：等待中 / 进行中 / 已结束 */
  /** 最近一次分配时间（操作台按此倒序；可能为空） */
  assignedAt: string | null
  status: TaskStatus
  /** 子状态：待分配 / 待接受 / 待反馈 / 待继续 / 待申请验收 / 待验收 / 执行中 / 完成 / 已拒绝 / 失败 / 取消 */
  subStatus: TaskSubStatus
  /** 需求方类型：user=人类用户（历史）/ worker=真人机器人 */
  requesterType: 'user' | 'worker' | null
  /** 需求方 id（users.id 或 workers.id，与 requesterType 联合解释） */
  requesterId: number | null
  /** 需求方展示名（列表接口/看板 SSE 附带；worker 显示机器人名，历史个人 AGENT 显示主人） */
  requesterName?: string | null
  /** 待继续时下一次派发需要补充的上下文（答复/返工/子任务事件） */
  resumePrompt: string | null
  /** 最近一次任务邀约时间（待接受重试节流） */
  offerAttemptAt: string | null
  /** 工作计划（历史识别或外部 AI 更新，Markdown） */
  workPlan: string | null
  /** 待反馈/待验收提醒次数 */
  remindCount: number
  /** 首次提醒时间（首次提醒满 7 天未处理自动收尾） */
  firstRemindedAt: string | null
  /** 最近一次提醒时间 */
  lastRemindedAt: string | null
  agentId: number | null
  schedulerId: number | null
  executorId: number | null
  opencodeSessionId: string | null
  result: string | null
  /** 任务交付文档知识路径（执行方首次显式创建后登记） */
  handoffPath: string | null
  /** 交付文档当前版本（平台维护） */
  handoffVersion: number
  /** 最近一次申请验收锁定的版本 */
  handoffSubmittedVersion: number | null
  handoffUpdatedAt: string | null
  handoffUpdatedBy: string | null
  acceptedAt: string | null
  acceptedBy: string | null
  deliveredAt: string | null
  /** 累计验收不通过次数（第 4 次起转任务执行方） */
  acceptRejectCount: number
  /** 转任务执行方的时间（未升级为 null） */
  ownerTakeoverAt: string | null
  ownerTakeoverUserId: number | null
  ownerTakeoverName: string | null
  archivedAt: string | null
  /** 机器人拒绝承接时间、操作者与理由 */
  refusedAt: string | null
  refusedBy: string | null
  refusalReason: string | null
  /** 机器人拒绝承接时给出的分发建议 */
  dispatchSuggestion: string | null
  /** 需求方判定任务失败的时间、判定人与原因 */
  failedAt: string | null
  failedBy: string | null
  failureReason: string | null
  canceledAt: string | null
  createdAt: string
  updatedAt: string
  /** 列表接口附带的子任务（调度拆解产物） */
  children?: TaskPackage[]
  /** 详情接口附带的事件时间线与实时输出行 */
  events?: TaskEvent[]
  liveLines?: string[]
}

/** 项目详情附带的项目交付任务快照 */
export interface ProjectDeliveryTaskView {
  task: TaskPackage
  /** 当前执行机器人名称 */
  agentName: string | null
  /** 最近一条流转/操作事件 */
  latestEvent: TaskEvent | null
  /** 最近实时输出行（最多 5 条） */
  liveLines: string[]
  /** 已拆出的子任务数量 */
  childCount: number
}

export type ProjectWorkItemKind = 'task' | 'ticket'

/** 项目详情任务板块的统一展示项 */
export interface ProjectWorkItem {
  kind: ProjectWorkItemKind
  id: number
  code: string
  title: string
  status: string
  /** 任务子状态；工单为空 */
  subStatus: string | null
  /** 执行机器人或工单处理人 */
  agentName: string | null
  /** 任务实时进度或工单当前节点 */
  progress: string
  currentNodeName: string | null
  /** 子任务指向父任务 */
  parentTaskId: number | null
  updatedAt: string
}

export type TicketCategory = string
export type TicketAssigneeType = 'user' | 'worker'

/** 工单状态：工作流状态优先，历史工单沿用任务推导状态 */
export type TicketStatus =
  | '待分配'
  | '待接受'
  | '待反馈'
  | '待继续'
  | '待申请验收'
  | '待验收'
  | '处理中'
  | '待人工验收'
  | '已完成'
  | '已失败'
  | '已取消'

export interface TicketWorkflowInputField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'file'
  required: boolean
  /** 单选 / 多选的可选项 */
  options?: string[]
  placeholder?: string | null
  /** 多选默认值为英文逗号分隔的选项 */
  defaultValue?: string | number | null
}

export interface TicketWorkflowRun {
  id: number
  ticketId: number
  nodeKey: string
  nodeName: string
  nodeKind: 'start' | 'operation' | 'approval' | 'acceptance' | 'condition'
  attempt: number
  taskTemplateId: number | null
  taskTemplateName: string | null
  agentId: number | null
  agentName: string | null
  taskId: number | null
  status: string
  outcome: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
  taskStatus: string | null
}

export interface TicketWorkflowView {
  definitionId: number
  definitionName: string
  versionId: number
  version: number
  status: string
  currentNodeKey: string | null
  currentNodeName: string | null
  autoAcceptance: boolean
  inputValues: Record<string, unknown>
  nodes: WorkflowNodeDefinition[]
  edges: WorkflowEdgeDefinition[]
  runs: TicketWorkflowRun[]
}

export interface Ticket {
  id: number
  code: string
  category: string
  title: string
  description: string | null
  /** AI 机器人发起时为空 */
  createdById: number | null
  createdByName: string
  assigneeType: TicketAssigneeType
  assigneeId: number
  assigneeName: string
  taskId: number | null
  /** 工作流状态或按关联任务实时推导的历史工单状态 */
  status: TicketStatus
  task: TaskPackage | null
  workflowDefinitionId: number | null
  workflowVersion: number | null
  initiatorWorkerId: number | null
  initiatorWorkerName: string | null
  workflowStatus: string | null
  currentNodeKey: string | null
  currentNodeName: string | null
  workflow?: TicketWorkflowView | null
  createdAt: string
  updatedAt: string
}

/** 工单工作流节点类型：起始 / 操作 / 审批 / 验收 / 判断 */
export const WORKFLOW_NODE_KINDS = [
  'start',
  'operation',
  'approval',
  'acceptance',
  'condition',
] as const
export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number]

/** 节点执行结果；审批节点使用 approved/rejected，其它节点使用 succeeded/failed */
export const WORKFLOW_OUTCOMES = [
  'succeeded',
  'failed',
  'approved',
  'rejected',
] as const
export type WorkflowOutcome = (typeof WORKFLOW_OUTCOMES)[number]

/** 判断节点支持的比较运算符 */
export const WORKFLOW_CONDITION_OPERATORS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'empty',
  'notEmpty',
] as const
export type WorkflowConditionOperator =
  (typeof WORKFLOW_CONDITION_OPERATORS)[number]

/** 判断节点出边的单条条件；同一出边的多条条件之间为「且」关系 */
export interface WorkflowConditionRule {
  field: string
  operator: WorkflowConditionOperator
  value?: string | null
}

/** 流程结束的虚拟节点；验收通过或操作节点的成功/失败流转可以指向它 */
export const WORKFLOW_END_NODE = '$end'

export interface WorkflowNodeDefinition {
  key: string
  name: string
  kind: WorkflowNodeKind
  taskTemplateId: number | null
  /** 审批节点负责机器人；操作节点按任务定义自动分配 */
  responsibleWorkerId: number | null
  /** 仅起始节点：工单发起时的结构化输入字段 */
  inputFields: TicketWorkflowInputField[] | null
  /** 仅验收节点：前序成功到达时直接验收通过 */
  autoAccept: boolean
  description: string | null
}

export interface WorkflowEdgeDefinition {
  from: string
  to: string
  outcome: WorkflowOutcome | null
  /** 仅判断节点：出边条件，多条之间为「且」；为空表示默认兜底分支 */
  conditions?: WorkflowConditionRule[] | null
  label: string | null
}

export interface WorkflowDefinitionJson {
  startNode: string
  nodes: WorkflowNodeDefinition[]
  edges: WorkflowEdgeDefinition[]
}

export interface TicketWorkflowDefinitionSummary {
  id: number
  code: string
  category: string
  name: string
  description: string | null
  builtIn: boolean
  enabled: boolean
  latestPublishedVersion: number
  latestPublishedAt: string | null
  draftUpdatedAt: string | null
  updatedAt: string
}

export interface TicketWorkflowPublishedVersion {
  version: number
  name: string
  description: string | null
  definition: WorkflowDefinitionJson
  publishedById: number | null
  publishedByName: string | null
  publishedAt: string
}

export interface TicketWorkflowDefinitionDetail extends TicketWorkflowDefinitionSummary {
  draft: WorkflowDefinitionJson
  published: TicketWorkflowPublishedVersion | null
}


/** 任务看板 SSE（GET /api/tasks/stream）使用的轻量列表项：不含 Markdown 正文与产物等大字段 */
export interface TaskBoardItem {
  id: number
  code: string
  title: string
  parentId: number | null
  status: TaskStatus
  subStatus: TaskSubStatus
  /** 需求方展示名（服务端批量解析） */
  requesterName: string | null
  agentId: number | null
  updatedAt: string
}

/** 任务看板 SSE（GET /api/tasks/stream）：初始快照 + 增量事件 */
export type TaskRealtimeMessage =
  | { type: 'snapshot'; tasks: TaskBoardItem[]; at: number }
  | { type: 'task.upsert'; task: TaskBoardItem; at: number }
  | { type: 'task.line'; taskId: number; line: string; at: number }
  | { type: 'task.delete'; ids: number[]; at: number }
  | { type: 'ping'; at: number }

/** 任务对话身份：需求方 / 执行方 */
export type TaskChatPerspective = 'requester' | 'responsible'

/** 任务聊天发送方：需求方 / 机器人 / 调度机器人 / 系统 */
export interface TaskChatSender {
  id: string
  name: string
  kind: 'user' | 'worker' | 'scheduler' | 'system'
  workerId?: number
  roleLabel?: string
  /** 机器人头像：/images/... 路径（空为默认黑底占位） */
  avatarUrl?: string | null
}

/** 机器人执行过程中的工具调用（详情页对话内联展示） */
export interface TaskChatTool {
  id: string
  name: string
  status: 'running' | 'success' | 'error'
  /** 历史错误/补充说明 */
  detail?: string
  /** 工具参数（JSON 文本） */
  argsText?: string
  /** 工具结果或错误 */
  result?: string
  startedAt?: string
  finishedAt?: string
}

/** 提问选项（opencode question） */
export interface TaskChatQuestionOption {
  label: string
  description?: string
}

/** 单个问题（opencode question） */
export interface TaskChatQuestionInfo {
  question: string
  header: string
  options?: TaskChatQuestionOption[]
  multiple?: boolean
  /** 是否接受自由输入（false 时只能从选项中选择） */
  custom?: boolean
  /** form 协议下的字段 key（仅后端答复使用） */
  fieldKey?: string
}

/** 提问状态：待回答 / 已回答 / 已跳过 / 已失效 */
export type TaskChatQuestionState =
  | 'pending'
  | 'answered'
  | 'rejected'
  | 'cancelled'

/** 机器人提问（对话中的问答卡片） */
export interface TaskChatQuestion {
  id: string
  sessionId: string
  questions: TaskChatQuestionInfo[]
  state: TaskChatQuestionState
  /** 按问题顺序的答案（选项 label + 自定义文本） */
  answers?: string[][]
  askedAt: string
  toolCallId?: string
}

/** 任务详情页聊天消息（来自 GET /api/tasks/:id/chat + SSE 增量） */
export interface TaskChatMessage {
  id: string
  taskId: number
  role: 'user' | 'assistant'
  sender: TaskChatSender
  /** 该消息属于任务哪一方；旧消息缺失时按 role 推断 */
  perspective?: TaskChatPerspective
  /** Markdown 正文；工具调用/提问消息可能为空 */
  content: string
  /** 机器人思考过程（session.reasoning.*） */
  reasoning?: string
  createdAt: string
  status: 'running' | 'complete' | 'error'
  /** message=普通对话气泡；question=机器人提问卡片（时间线事件不进对话流，走快照 events） */
  kind: 'message' | 'question'
  tools?: TaskChatTool[]
  question?: TaskChatQuestion
  meta?: Record<string, unknown>
}

/** PIPELINE 阶段：主任务或子任务 + 分配的机器人与调度机器人 */
export interface TaskPipelineStage {
  task: TaskPackage
  agent: TaskChatSender | null
  scheduler: TaskChatSender | null
}

/** 任务详情页聊天初始快照 */
export interface TaskChatSnapshot {
  task: TaskPackage
  rootTask: TaskPackage
  pipeline: TaskPipelineStage[]
  messages: TaskChatMessage[]
  /** 当前任务需求方姓名 */
  requesterName: string | null
  /** 当前执行机器人执行方姓名 */
  agentOwnerName: string | null
  /** 人工介入次数 */
  interventionCount: number
  /** 当前任务是否曾提交过验收申请（后续返工也保持为 true） */
  hasAcceptanceApplication: boolean
  /** 当前任务事件时间线（倒序） */
  events: TaskEvent[]
}

/** 工作台角色：我执行 / 我是需求方 / 我是执行方 */
export type WorkbenchRole = 'agent' | 'requester' | 'responsible'

/** 操作台任务：任务本体 + 当前用户角色与下一步动作 */
export interface WorkbenchTask extends TaskPackage {
  workbenchRoles: WorkbenchRole[]
  /** 当前需要当前用户处理的动作；null 表示等待其他参与方 */
  workbenchAction: string | null
}

/** 工作台「我的 AGENT」机器人视图（服务端只返回对话所需字段） */
export interface WorkbenchAgentWorker {
  id: number
  name: string
  intro: string | null
  avatarUrl: string | null
  executorId: number | null
  providerId: string | null
  modelId: string | null
  variant: string | null
  enabled: boolean
  personalAgentUserId: number | null
}

/** 工作台「我的 AGENT」可用状态 */
export interface WorkbenchAgentInfo {
  /** 个人 AGENT 机器人；创建失败时为 null */
  worker: WorkbenchAgentWorker | null
  available: boolean
  /** 不可用原因 */
  reason: string | null
}

/** 详情页「我的 AI」页面类型（每个类型 + ID 使用独立会话） */
export type AgentPageContextType =
  | 'document'
  | 'script'
  | 'project'
  | 'idea'
  | 'backlog'

/** 详情页「我的 AI」上下文：会话按 type + id 隔离，内容读取接口供 AI 取当前页面 */
export interface AgentPageContext {
  type: AgentPageContextType
  id: string
  title?: string
  summary?: string
  /** 站内只读接口，如 /api/documents/12.md */
  readUrl?: string
}

/** 操作台初始数据 */
export interface WorkbenchSummary {
  worker: Worker
  /** 当前用户的个人 AI AGENT */
  agent: WorkbenchAgentInfo
  tasks: WorkbenchTask[]
}

/** 任务交付文档（正文由作者维护，版本与更新时间由平台维护） */
export interface TaskHandoffDocument {
  /** 文档是否已由执行方/需求方显式创建 */
  exists: boolean
  path: string
  url: string
  title: string
  version: number
  submittedVersion: number | null
  /** Markdown 正文，不含平台 Frontmatter */
  content: string
  updatedAt: string | null
  updatedBy: string | null
}

/** 任务目录下的 Markdown 文档（任务详情「文档」Tab） */
export interface TaskDocumentEntry {
  /** 阅读名，如 HANDOFF.md / API.md */
  name: string
  /** 知识路径（不带 .md） */
  path: string
  /** 网页阅读地址 */
  url: string
  /** Markdown 接口地址 */
  markdownUrl: string
  title: string
  /** 文档 Frontmatter 中的描述 */
  description: string | null
  updatedAt: string | null
  /** 来源任务（「文档」Tab 聚合子任务文档时携带） */
  taskId?: number
  taskCode?: string
  taskTitle?: string
}

/** 任务文档中引用的站内图片/文件 */
export interface TaskArtifactEntry {
  name: string
  kind: 'image' | 'file'
  url: string
  /** 引用该产物的文档 */
  sourceDocument: string
  /** 来源任务（「文档」Tab 聚合子任务文档时携带） */
  taskId?: number
  taskCode?: string
  taskTitle?: string
}

/** 任务详情「文档」Tab 数据（documents 含当前任务与全部子任务文档） */
export interface TaskDocumentsView {
  directory: string
  /** 当前任务 id，用于区分「当前任务」与「子任务」分组 */
  taskId: number
  documents: TaskDocumentEntry[]
  artifacts: TaskArtifactEntry[]
}

/** 任务文档正文（去掉平台 Frontmatter） */
export interface TaskDocumentContent extends TaskDocumentEntry {
  content: string
}

/** 任务聊天 SSE 推送 */
export type TaskChatStreamMessage =
  | { type: 'ready'; at: number }
  | { type: 'message.upsert'; message: TaskChatMessage; at: number }
  | { type: 'stage.upsert'; stage: TaskPipelineStage; at: number }
  | { type: 'stage.delete'; ids: number[]; at: number }
  | { type: 'refresh'; at: number }
  | { type: 'ping'; at: number }

export interface TaskOverview {
  total: number
  roots: number
  /** 按主状态计数 */
  statuses: Record<string, number>
  /** 按子状态计数 */
  subStatuses: Record<string, number>
}

/** 任务定义：一类任务的可复用定义（描述 + 默认处理机器人） */
export interface TaskTemplate {
  id: number
  name: string
  /** Markdown 描述：包含任务范围、所需输入与交付方式 */
  description: string | null
  /** 默认处理机器人 workers.id 列表 */
  agentIds: number[]
  /** 创建人用户 ID（系统内置定义为空） */
  createdById: number | null
  /** 创建人姓名快照 */
  createdByName: string | null
  /** 当前登录用户是否已关注（仅列表接口返回） */
  followedByMe?: boolean
  createdAt: string
  updatedAt: string
}

/** 管理区 GitHub 档位凭证（不含任何 PAT / 密文）；全平台仅 开发权限 / 发布权限 两条 */
export interface GithubAccessCredential {
  permission: WorkerGithubPermission
  configured: boolean
  githubAccount: string | null
  enabled: boolean
  rotatedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 飞书机器人应用配置（Secret 只写不回显） */
export interface FeishuBotConfigView {
  id: number
  kind: 'official' | 'worker'
  workerId: number | null
  name: string | null
  appId: string
  enabled: boolean
  secretConfigured: boolean
  verificationTokenConfigured: boolean
  encryptKeyConfigured: boolean
  callbackUrl: string
  boundAt: string | null
  lastVerifiedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

/** 飞书配置保存输入：已配置时 Secret 类字段留空即保持不变 */
export interface FeishuBotSaveInput {
  appId?: string
  appSecret?: string | null
  verificationToken?: string | null
  encryptKey?: string | null
  enabled?: boolean
}

/** 机器人外部群答复策略：smart=智能反馈 / at=仅被@ / record=仅记录 / feedback=反馈采集（仅「系统-反馈处理」） */
export const FEISHU_BOT_GROUP_POLICIES = [
  'smart',
  'at',
  'record',
  'feedback',
] as const
export type FeishuBotGroupPolicy = (typeof FEISHU_BOT_GROUP_POLICIES)[number]

/** 外部群策略标签 */
export const FEISHU_BOT_GROUP_POLICY_LABELS: Record<
  FeishuBotGroupPolicy,
  string
> = {
  smart: '智能反馈',
  at: '仅被@反馈',
  record: '仅记录',
  feedback: '反馈采集',
}

/** 机器人被拉入的外部群（不含平台任务群/项目群） */
export interface FeishuBotGroupView {
  id: number
  chatId: string
  name: string | null
  /** 单群策略；null = 跟随默认 */
  policy: FeishuBotGroupPolicy | null
  /** 实际生效策略 */
  effectivePolicy: FeishuBotGroupPolicy
  joinedAt: string
  leftAt: string | null
  lastMessageAt: string | null
  messageCount: number
}

/** 群时间线记录（消息/回复/进群/出群） */
export interface FeishuBotGroupRecordView {
  id: number
  kind: 'message' | 'reply' | 'bot_added' | 'bot_removed'
  messageId: string | null
  /** 话题 id（thread_id）；非话题消息为空 */
  threadId: string | null
  senderOpenId: string | null
  senderName: string | null
  senderUserId: number | null
  messageType: string | null
  content: string | null
  decision:
    | 'replied'
    | 'silent'
    | 'not_mentioned'
    | 'record_only'
    | 'busy'
    | 'error'
    | null
  error: string | null
  createdAt: string
}

/** OP Gateway 可获取的凭证类型（第一期仅 GitHub PAT） */
export const GATEWAY_CREDENTIAL_TYPES = ['github.pat'] as const
export type GatewayCredentialType = (typeof GATEWAY_CREDENTIAL_TYPES)[number]

/** OP Gateway 凭证租用 */
export interface GatewayCredentialLease {
  leaseId: string
  workerId: number
  credential: {
    type: GatewayCredentialType
    data: Record<string, string | number | boolean>
  }
  issuedAt: string
  expiresAt: string
}

/** 通用凭证操作（第一期仅 GitHub 动作） */
export const GATEWAY_GITHUB_ACTIONS = [
  'git.read',
  'git.write',
  'gh.pr.create',
  'gh.pr.approve',
  'gh.pr.merge',
] as const
export type GatewayGithubAction = (typeof GATEWAY_GITHUB_ACTIONS)[number]

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
  /** 迭代分组视图：需求按迭代周期聚合 + 状态计数（业务分区「迭代」栏目） */
  listProjectIterations: () => request<IterationGroup[]>('/projects/iterations'),
  /** 迭代列表（T0 置顶，W1 按开始日期倒序） */
  listIterations: (params?: {
    type?: IterationType
    status?: IterationStatus
  }) => {
    const qs = new URLSearchParams()
    if (params?.type) qs.set('type', params.type)
    if (params?.status) qs.set('status', params.status)
    const q = qs.toString()
    return request<IterationSummary[]>(`/iterations${q ? `?${q}` : ''}`)
  },
  /** 迭代详情：迭代信息 + 迭代项列表 */
  getIteration: (id: number) => request<IterationDetail>(`/iterations/${id}`),
  /** 创建 W1 周迭代（仅管理员） */
  createIteration: (input: {
    code: string
    name: string
    startAt: string
    endAt: string
  }) =>
    request<IterationSummary>('/iterations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 更新迭代：名称 / 起止日期 / 结束或重开（仅管理员） */
  updateIteration: (
    id: number,
    input: {
      name?: string
      startAt?: string | null
      endAt?: string | null
      status?: IterationStatus
    },
  ) =>
    request<IterationSummary>(`/iterations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  /** 批量转入：选中需求转为该迭代的 backlog（每条必填负责人） */
  createBacklogs: (
    iterationId: number,
    items: Array<{
      projectId: number
      ownerWorkerId: number
      members?: Array<{ role: BacklogMemberRole; userId: number }>
    }>,
  ) =>
    request<Backlog[]>(`/iterations/${iterationId}/backlogs`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  /** 迭代项详情 */
  getBacklog: (id: number) => request<BacklogDetail>(`/backlogs/${id}`),
  /** 迭代项状态流转（成员或管理员；备注可空，写入事件流） */
  updateBacklogStatus: (id: number, status: BacklogStatus, remark?: string) =>
    request<Backlog>(`/backlogs/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, remark }),
    }),
  /** 更新迭代项属性（预期上线时间，传 null 清空） */
  updateBacklog: (id: number, input: { expectedOnlineAt?: string | null }) =>
    request<Backlog>(`/backlogs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  /** 迭代项关联文档列表（不含正文大字段） */
  listBacklogDocuments: (id: number) =>
    request<BacklogDocumentSummary[]>(`/backlogs/${id}/documents`),
  /** 关联已有文档（须属于该迭代项的原始需求） */
  addBacklogDocument: (id: number, documentId: number) =>
    request<{ linked: boolean }>(`/backlogs/${id}/documents`, {
      method: 'POST',
      body: JSON.stringify({ documentId }),
    }),
  /** 取消文档关联（不删除文档本体） */
  removeBacklogDocument: (id: number, documentId: number) =>
    request<void>(`/backlogs/${id}/documents/${documentId}`, {
      method: 'DELETE',
    }),
  /** 迭代项事件流（倒序，最近 100 条） */
  listBacklogEvents: (id: number) =>
    request<BacklogEvent[]>(`/backlogs/${id}/events`),
  /** 任务与工单面板：交付任务树（含子任务）+ 相关工单 */
  listBacklogTasks: (id: number) =>
    request<{ tasks: BacklogTaskSummary[]; tickets: BacklogTicketSummary[] }>(
      `/backlogs/${id}/tasks`,
    ),
  /** 发起提测（创建提测工单，自动填入迭代项上下文） */
  createBacklogReleaseTicket: (
    id: number,
    input: { title?: string; supplement?: string },
  ) =>
    request<{ ticketId: number; ticketCode: string; title: string }>(
      `/backlogs/${id}/release-ticket`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),
  /** 移动迭代项到另一个迭代 */
  moveBacklog: (id: number, iterationId: number) =>
    request<Backlog>(`/backlogs/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ iterationId }),
    }),
  /** 更新迭代项成员（仅管理员） */
  updateBacklogMembers: (
    id: number,
    members: Array<{ role: BacklogMemberRole; userId: number }>,
  ) =>
    request<Backlog>(`/backlogs/${id}/members`, {
      method: 'PATCH',
      body: JSON.stringify({ members }),
    }),
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
  /** 脚本库列表：q 匹配路径或描述，kind 过滤类型；有关键词按相关度、无关键词按路径排序分页 */
  listLibraryScripts: (params?: {
    q?: string
    kind?: ScriptLibraryKind
    page?: number
    pageSize?: number
  }) => {
    const search = new URLSearchParams()
    if (params?.q) search.set('q', params.q)
    if (params?.kind) search.set('type', params.kind)
    if (params?.page !== undefined) search.set('page', String(params.page))
    if (params?.pageSize !== undefined)
      search.set('pageSize', String(params.pageSize))
    const qs = search.toString()
    return request<ScriptLibraryListResponse>(
      `/script-library/scripts${qs ? `?${qs}` : ''}`,
    )
  },
  /** 脚本库脚本详情（含源码） */
  getLibraryScript: (path: string) =>
    request<ScriptLibraryScriptDetail>(
      `/script-library/script?path=${encodeURIComponent(path)}`,
    ),
  /** 脚本库同步状态 */
  getLibraryStatus: () =>
    request<ScriptLibrarySyncStatus>('/script-library/status'),
  /** 手动触发一次脚本库同步（main 分支 ff-only 拉取） */
  syncLibrary: () =>
    request<ScriptLibrarySyncStatus>('/script-library/sync', {
      method: 'POST',
    }),
  /** 启动一次脚本库脚本运行（无需登记到项目） */
  startLibraryRun: (path: string) =>
    request<ScriptLibraryRun>('/script-library/runs', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  /** 脚本库某脚本的运行历史（倒序，上限 50） */
  listLibraryRuns: (path: string) =>
    request<ScriptLibraryRun[]>(
      `/script-library/runs?path=${encodeURIComponent(path)}`,
    ),
  /** 单次脚本库运行详情 */
  getLibraryRun: (runId: number) =>
    request<ScriptLibraryRun>(`/script-library/runs/${runId}`),
  /** 手动重新生成脚本描述（转回待生成队列，由脚本描述机器人重新分析） */
  regenerateLibraryDescription: (path: string) =>
    request<ScriptLibrarySyncStatus>('/script-library/descriptions/regenerate', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
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
  listSchedules: (projectId?: number) =>
    request<ProjectSchedule[]>(
      `/schedules${projectId === undefined ? '' : `?projectId=${projectId}`}`,
    ),
  createSchedule: (input: {
    projectId: number
    title: string
    cron: string
    checkId: number
  }) =>
    request<ProjectSchedule>('/schedules', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateSchedule: (
    id: number,
    input: Partial<{
      title: string
      cron: string
      checkId: number
      enabled: boolean
    }>,
  ) =>
    request<ProjectSchedule>(`/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteSchedule: (id: number) =>
    request<void>(`/schedules/${id}`, { method: 'DELETE' }),
  getSchedule: (id: number) => request<ProjectSchedule>(`/schedules/${id}`),
  /** 任务触发的运行历史（倒序，上限 50） */
  listScheduleRuns: (id: number) => request<CheckRun[]>(`/schedules/${id}/runs`),
  /** 立即触发一次任务（手动触发不受 enabled 限制），返回启动的运行记录 */
  runSchedule: (id: number) =>
    request<CheckRun>(`/schedules/${id}/run`, { method: 'POST' }),
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
  /** 缺陷列表：可按项目 / 提测 ID 过滤，不传返回全部。不含大字段 */
  listDefects: (projectId?: number, releaseId?: number) => {
    const query = [
      projectId !== undefined && `projectId=${projectId}`,
      releaseId !== undefined && `releaseId=${releaseId}`,
    ]
      .filter(Boolean)
      .join('&')
    return request<Defect[]>(`/defects${query ? `?${query}` : ''}`)
  },
  getDefect: (id: number) => request<Defect>(`/defects/${id}`),
  /** 缺陷变更记录列表（倒序） */
  listDefectRecords: (id: number) =>
    request<DefectChangeRecord[]>(`/defects/${id}/records`),
  /** 追加一条缺陷变更记录（变更内容 + 备注，状态取缺陷当前状态） */
  addDefectRecord: (id: number, input: { content: string; remark?: string }) =>
    request<DefectChangeRecord>(`/defects/${id}/records`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 创建缺陷（预期与实际为必填） */
  createDefect: (input: {
    projectId: number
    expected: string
    actual: string
    platform?: string
    priority?: DefectPriority
    images?: string[]
    testScript?: string
    /** 关联提测 ID；不传走自动关联，null 表示明确不关联 */
    releaseId?: number | null
  }) =>
    request<Defect>('/defects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 更新缺陷（端/状态/预期/实际/图片/脚本）；images 全量覆盖（空数组清除） */
  updateDefect: (
    id: number,
    input: Partial<{
      platform: string
      priority: DefectPriority
      status: DefectStatus
      expected: string
      actual: string
      images: string[]
      testScript: string
      /** 关联提测 ID；null 清除关联 */
      releaseId: number | null
      /** 变更内容：状态变更时并入状态记录，否则单独记一条内容变更记录 */
      changeContent: string
      /** 本次变更的备注信息（写入变更记录） */
      changeRemark: string
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
  /** 反馈列表（不含正文）：q 走后端拼音匹配（标题/提交人），status/type 过滤 */
  listFeedbacks: (params?: {
    q?: string
    status?: FeedbackStatus
    type?: FeedbackType
  }) => {
    const qs = new URLSearchParams()
    if (params?.q) qs.set('q', params.q)
    if (params?.status) qs.set('status', params.status)
    if (params?.type) qs.set('type', params.type)
    const suffix = qs.toString()
    return request<Feedback[]>(`/feedbacks${suffix ? `?${suffix}` : ''}`)
  },
  getFeedback: (id: number) => request<Feedback>(`/feedbacks/${id}`),
  /** 反馈跟帖（飞书群话题内后续成员消息，按时间正序） */
  listFeedbackReplies: (id: number) =>
    request<FeedbackReply[]>(`/feedbacks/${id}/replies`),
  /** 提交反馈（任何登录用户） */
  createFeedback: (input: {
    title: string
    content: string
    type?: FeedbackType
    images?: string[]
  }) =>
    request<Feedback>('/feedbacks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 更新反馈：提交人仅「待处理」可改内容；管理员随时；handleNote 仅管理员 */
  updateFeedback: (
    id: number,
    input: Partial<{
      title: string
      content: string
      /** 图片全量覆盖（空数组清除） */
      images: string[]
      type: FeedbackType
      handleNote: string
    }>,
  ) =>
    request<Feedback>(`/feedbacks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  /** 状态流转（仅管理员）：置已解决/已关闭补记解决时间，退回时清空 */
  changeFeedbackStatus: (
    id: number,
    input: { status: FeedbackStatus; handleNote?: string },
  ) =>
    request<Feedback>(`/feedbacks/${id}/status`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 删除反馈：管理员，或提交人撤销待处理反馈 */
  deleteFeedback: (id: number) =>
    request<void>(`/feedbacks/${id}`, { method: 'DELETE' }),
  /** 灵感列表（不含正文）：q 走后端拼音匹配（标题/创建人），status/type 过滤 */
  listIdeas: (params?: {
    q?: string
    status?: IdeaStatus
    type?: IdeaType
  }) => {
    const qs = new URLSearchParams()
    if (params?.q) qs.set('q', params.q)
    if (params?.status) qs.set('status', params.status)
    if (params?.type) qs.set('type', params.type)
    const suffix = qs.toString()
    return request<Idea[]>(`/ideas${suffix ? `?${suffix}` : ''}`)
  },
  getIdea: (id: number) => request<Idea>(`/ideas/${id}`),
  /** 创建灵感（任何登录用户；机器人经 lita-work MCP 创建） */
  createIdea: (input: {
    /** 标题可省略：省略时由平台根据正文异步生成 */
    title?: string
    content?: string
    type?: IdeaType
    images?: string[]
  }) => request<Idea>('/ideas', { method: 'POST', body: JSON.stringify(input) }),
  /** 更新灵感：构思期任何登录用户可编辑；采纳/废弃后仅管理员 */
  updateIdea: (
    id: number,
    input: Partial<{
      title: string
      content: string
      /** 图片全量覆盖（空数组清除） */
      images: string[]
      type: IdeaType
    }>,
  ) =>
    request<Idea>(`/ideas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  /** 状态流转（仅管理员）：采纳时新建（createProject）或关联（projectId）需求池需求 */
  changeIdeaStatus: (
    id: number,
    input: {
      status: IdeaStatus
      createProject?: boolean
      projectId?: number | null
      projectType?: ProjectType
    },
  ) =>
    request<Idea>(`/ideas/${id}/status`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 删除灵感：管理员，或创建人撤销构思中的灵感 */
  deleteIdea: (id: number) =>
    request<void>(`/ideas/${id}`, { method: 'DELETE' }),
  /** 上传图片（Markdown 正文内嵌用），返回可访问链接 */
  uploadImage: async (file: File): Promise<{ path: string; url: string }> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/images', { method: 'POST', body: form })
    if (res.status === 401) handleUnauthorized('/images')
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.message ?? `上传失败 (${res.status})`)
    }
    return res.json() as Promise<{ path: string; url: string }>
  },
  /** 上传通用文件（聊天附件/Agent 共用），返回公开地址 */
  uploadFile: async (
    file: File,
  ): Promise<{ filename: string; size: number; mime: string; url: string }> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/files', { method: 'POST', body: form })
    if (res.status === 401) handleUnauthorized('/files')
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.message ?? `上传失败 (${res.status})`)
    }
    return res.json() as Promise<{
      filename: string
      size: number
      mime: string
      url: string
    }>
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
  /** GitHub 仓库搜索（组织下仓库，q 匹配 名称/描述；后端缓存 5 分钟，最多 50 条） */
  searchGithubRepos: (q?: string) =>
    request<GithubRepo[]>(
      `/github/repos${q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
    ),
  /** GitHub 分支联想：指定仓库的全部分支名 */
  listGithubBranches: (repo: string) =>
    request<string[]>(`/github/branches?repo=${encodeURIComponent(repo)}`),
  /** 仓库登记列表（组织仓库清单 + 端/状态），可按 端/状态 筛选 + 关键字搜索 */
  listRepos: (params?: {
    platform?: RepoPlatform
    status?: RepoStatus
    q?: string
  }) => {
    const search = new URLSearchParams()
    if (params?.platform) search.set('platform', params.platform)
    if (params?.status) search.set('status', params.status)
    if (params?.q) search.set('q', params.q)
    const qs = search.toString()
    return request<Repo[]>(`/repos${qs ? `?${qs}` : ''}`)
  },
  /** 立即同步组织仓库清单（刷新最后更新时间/补充新仓库） */
  syncRepos: () =>
    request<{ created: number; updated: number; total: number }>('/repos/sync', {
      method: 'POST',
    }),
  /** 更新仓库的端/状态/备注（状态=忽略后不再出现在联想与代码分支候选） */
  updateRepo: (
    id: number,
    input: Partial<{
      platform: RepoPlatform
      status: RepoStatus
      remark: string
    }>,
  ) =>
    request<Repo>(`/repos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  /** 代码分支登记：传 projectId 按项目过滤，不传返回全部 */
  listCodeBranches: (projectId?: number) =>
    request<ProjectBranch[]>(
      `/code-branches${projectId === undefined ? '' : `?projectId=${projectId}`}`,
    ),
  /** 登记代码分支（repo 支持仓库名/全名/完整 URL，归一化存 owner/name） */
  createCodeBranch: (input: {
    projectId: number
    repo: string
    branch: string
    category?: CodeBranchCategory
    remark?: string
  }) =>
    request<ProjectBranch>('/code-branches', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 更新登记（仓库/分支/归类/备注） */
  updateCodeBranch: (
    id: number,
    input: Partial<{
      repo: string
      branch: string
      category: CodeBranchCategory
      remark: string
    }>,
  ) =>
    request<ProjectBranch>(`/code-branches/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteCodeBranch: (id: number) =>
    request<void>(`/code-branches/${id}`, { method: 'DELETE' }),
  /** 代码提交记录（监听到的提交/合并，按提交时间倒序）：projectId 匹配该项目登记的 仓库+分支 */
  listCodeEvents: (params?: {
    projectId?: number
    repo?: string
    branch?: string
    q?: string
    limit?: number
  }) => {
    const search = new URLSearchParams()
    if (params?.projectId !== undefined) search.set('projectId', String(params.projectId))
    if (params?.repo) search.set('repo', params.repo)
    if (params?.branch) search.set('branch', params.branch)
    if (params?.q) search.set('q', params.q)
    if (params?.limit !== undefined) search.set('limit', String(params.limit))
    const qs = search.toString()
    return request<CodeEvent[]>(`/code-events${qs ? `?${qs}` : ''}`)
  },
  /** 幂等创建项目开发交付任务；已有任务时直接返回现有任务快照 */
  ensureProjectDeliveryTask: (projectId: number) =>
    request<ProjectDeliveryTaskView>(`/projects/${projectId}/delivery-task`, {
      method: 'POST',
    }),
  /** 项目提测：创建提测记录 + 状态流转「测试中」+ 通知提测群与项目人员（testers 至少 1 人且须为用户系统内用户） */
  submitRelease: (
    projectId: number,
    input: {
      content?: string
      urls?: string[]
      branches?: ReleaseBranch[]
      testers: string[]
      /** 来源任务（机器人调用时可显式指定；网页提测一般不传） */
      taskId?: number
    },
  ) =>
    request<ProjectRelease>(`/projects/${projectId}/release`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 提测记录列表（倒序） */
  listReleases: (projectId: number) =>
    request<ProjectRelease[]>(`/projects/${projectId}/releases`),
  /** 推进提测状态（测试同学操作）：待冒烟 → 进行中 → 已通过 / 未通过；待冒烟/进行中不保留判定人/时间 */
  updateReleaseStatus: (releaseId: number, status: ReleaseStatus) =>
    request<ProjectRelease>(`/releases/${releaseId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  /** 用户系统全量名单（项目人员/提测测试人员等场景选择用户，亦供管理端用户列表页展示） */
  listUsers: () =>
    request<{ users: PlatformUser[] }>('/auth/users').then((r) => r.users),
  /** MCP 机器人调用审计（管理端，倒序分页） */
  listMcpLogs: (params?: { q?: string; page?: number; pageSize?: number }) => {
    const search = new URLSearchParams()
    if (params?.q) search.set('q', params.q)
    if (params?.page) search.set('page', String(params.page))
    if (params?.pageSize) search.set('pageSize', String(params.pageSize))
    const qs = search.toString()
    return request<McpLogPage>(`/mcp/logs${qs ? `?${qs}` : ''}`)
  },
  /** 当前登录用户（未登录 401，调用方 catch 视为未登录态） */
  getMe: () => request<{ user: User }>('/auth/me').then((r) => r.user),
  /** 当前用户的机器人令牌（真人机器人令牌，个人 AGENT 共用；调 .md 端点与 MCP 鉴权用） */
  getAgentToken: () =>
    request<{ token: string }>('/auth/agent-token').then((r) => r.token),
  /** 重置机器人令牌（真人机器人与个人 AGENT 共用；旧令牌立即失效） */
  resetAgentToken: () =>
    request<{ token: string }>('/auth/agent-token/reset', {
      method: 'POST',
    }).then((r) => r.token),
  /** 登出：清除会话 Cookie */
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  // ===== 任务处理中心（FEATURE-02）=====

  /** 执行器列表 */
  listExecutors: () => request<Executor[]>('/executors'),
  createExecutor: (input: {
    name: string
    ip: string
    port: number
    type?: ExecutorType
    description?: string | null
    token?: string | null
  }) =>
    request<Executor>('/executors', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateExecutor: (
    id: number,
    input: Partial<{
      name: string
      ip: string
      port: number
      type: ExecutorType
      description: string | null
      token: string | null
      enabled: boolean
    }>,
  ) =>
    request<Executor>(`/executors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteExecutor: (id: number) =>
    request<void>(`/executors/${id}`, { method: 'DELETE' }),
  /** 立即健康检查 */
  checkExecutor: (id: number) =>
    request<Executor>(`/executors/${id}/check`, { method: 'POST' }),
  /** 同步供应商/模型缓存 */
  syncExecutorProviders: (id: number) =>
    request<Executor>(`/executors/${id}/sync-providers`, { method: 'POST' }),
  /** 供应商缓存（机器人表单三级联动） */
  getExecutorProviders: (id: number) =>
    request<ExecutorProvider[]>(`/executors/${id}/providers`),

  /** 管理区 GitHub 档位凭证清单（仅管理员；固定两条，不含 PAT） */
  listGithubAccess: () =>
    request<GithubAccessCredential[]>('/github-access'),
  /** 配置权限档位 PAT；pat 只写不读 */
  saveGithubAccess: (input: {
    permission: WorkerGithubPermission
    pat: string
    enabled?: boolean
  }) =>
    request<{ ok: true }>('/github-access', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteGithubAccess: (permission: WorkerGithubPermission) =>
    request<void>(`/github-access/${permission}`, { method: 'DELETE' }),

  /** 飞书机器人配置视图（不含 Secret） */
  listFeishuBotConfigs: () =>
    request<{
      official: FeishuBotConfigView | null
      workers: FeishuBotConfigView[]
    }>('/feishu-bot'),
  saveFeishuBotOfficial: (input: FeishuBotSaveInput) =>
    request<FeishuBotConfigView>('/feishu-bot/official', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  saveFeishuBotWorker: (workerId: number, input: FeishuBotSaveInput) =>
    request<FeishuBotConfigView>(`/feishu-bot/workers/${workerId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  testFeishuBot: (id: number) =>
    request<FeishuBotConfigView>(`/feishu-bot/${id}/test`, { method: 'POST' }),
  deleteFeishuBot: (id: number) =>
    request<{ ok: true }>(`/feishu-bot/${id}`, { method: 'DELETE' }),

  /** 机器人外部群策略：群列表 + 默认策略 + 是否为「系统-反馈处理」配置（收录群视图） */
  listFeishuBotGroups: (configId: number) =>
    request<{
      defaultPolicy: FeishuBotGroupPolicy
      groups: FeishuBotGroupView[]
      feedbackCollector: boolean
    }>(`/feishu-bot/${configId}/groups`),
  /** 收录群批量设置（仅「系统-反馈处理」）：选中群自动收录话题反馈 */
  saveFeishuBotFeedbackGroups: (configId: number, groupIds: number[]) =>
    request<{ ok: true; collected: number[] }>(
      `/feishu-bot/${configId}/feedback-groups`,
      { method: 'PUT', body: JSON.stringify({ groupIds }) },
    ),
  saveFeishuBotGroupDefaultPolicy: (
    configId: number,
    policy: FeishuBotGroupPolicy,
  ) =>
    request<{ defaultPolicy: FeishuBotGroupPolicy }>(
      `/feishu-bot/${configId}/groups/default-policy`,
      { method: 'PUT', body: JSON.stringify({ policy }) },
    ),
  /** 单群策略：null = 跟随默认 */
  saveFeishuBotGroupPolicy: (
    configId: number,
    groupId: number,
    policy: FeishuBotGroupPolicy | null,
  ) =>
    request<{ ok: true }>(`/feishu-bot/${configId}/groups/${groupId}/policy`, {
      method: 'PUT',
      body: JSON.stringify({ policy }),
    }),
  /** 群时间线记录（分页） */
  listFeishuBotGroupRecords: (
    configId: number,
    groupId: number,
    params: { page?: number; pageSize?: number; kind?: string } = {},
  ) => {
    const query = new URLSearchParams()
    if (params.page) query.set('page', String(params.page))
    if (params.pageSize) query.set('pageSize', String(params.pageSize))
    if (params.kind) query.set('kind', params.kind)
    const suffix = query.toString()
    return request<{
      items: FeishuBotGroupRecordView[]
      total: number
      page: number
      pageSize: number
    }>(
      `/feishu-bot/${configId}/groups/${groupId}/records${suffix ? `?${suffix}` : ''}`,
    )
  },

  /** MCP 配置列表（管理区；固定令牌只返回是否已配置） */
  listMcpServers: () => request<McpServerConfig[]>('/mcp/servers'),
  /** 登录用户可读的启用中候选清单（个人中心「助理配置」勾选用） */
  listMcpServerOptions: () =>
    request<McpServerOption[]>('/mcp/servers/options'),
  createMcpServer: (input: McpServerSaveInput) =>
    request<McpServerConfig>('/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateMcpServer: (id: number, input: Partial<McpServerSaveInput>) =>
    request<McpServerConfig>(`/mcp/servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  /** 平台侧连接测试；work-token 模式可传 workerId 借用该机器人令牌 */
  testMcpServer: (id: number, workerId?: number | null) =>
    request<McpServerTestResult>(`/mcp/servers/${id}/test`, {
      method: 'POST',
      body: JSON.stringify({ workerId: workerId ?? null }),
    }),
  deleteMcpServer: (id: number) =>
    request<{ ok: true }>(`/mcp/servers/${id}`, { method: 'DELETE' }),

  /** SSO 接入方列表（管理区；密钥只返回是否已配置） */
  listSsoClients: () => request<SsoClientConfig[]>('/sso/clients'),
  /** 新建接入方：clientId/clientSecret 仅本次响应返回 */
  createSsoClient: (input: SsoClientSaveInput) =>
    request<SsoClientCreated>('/sso/clients', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateSsoClient: (id: number, input: Partial<SsoClientSaveInput>) =>
    request<SsoClientConfig>(`/sso/clients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  /** 重置密钥：旧密钥立即失效，新密钥仅本次返回 */
  resetSsoClientSecret: (id: number) =>
    request<{ clientSecret: string }>(`/sso/clients/${id}/secret-reset`, {
      method: 'POST',
    }),
  deleteSsoClient: (id: number) =>
    request<{ ok: true }>(`/sso/clients/${id}`, { method: 'DELETE' }),

  /** 模型配置：固定场景列表（apiKey 只返回是否已配置） */
  listModelConfigs: () =>
    request<ModelScenarioConfig[]>('/admin/model-config'),
  /** 保存场景配置：apiKey 未传保持原值，空串清除 */
  saveModelConfig: (scenario: string, input: ModelScenarioSaveInput) =>
    request<ModelScenarioConfig>(`/admin/model-config/${scenario}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  /** 后端代理拉取模型列表；可传未保存的 baseUrl/apiKey 供保存前测试 */
  fetchModelOptions: (
    scenario: string,
    input?: { baseUrl?: string | null; apiKey?: string | null },
  ) =>
    request<string[]>(`/admin/model-config/${scenario}/fetch-models`, {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    }),

  /** 机器人列表（role 筛选；includePersonal=true 仅管理员，含个人 AGENT） */
  listWorkers: (params?: {
    role?: WorkerRole
    includePersonal?: boolean
  }) => {
    const qs = new URLSearchParams()
    if (params?.role) qs.set('role', params.role)
    if (params?.includePersonal) qs.set('includePersonal', 'true')
    const q = qs.toString()
    return request<Worker[]>(`/workers${q ? `?${q}` : ''}`)
  },
  getWorker: (id: number) => request<Worker>(`/workers/${id}`),
  createWorker: (input: {
    name: string
    intro?: string | null
    avatarUrl?: string | null
    role?: WorkerRole
    runtime?: WorkerRuntime
    executorId?: number | null
    providerId?: string | null
    modelId?: string | null
    variant?: string | null
    prompt?: string | null
    skills?: WorkerSkill[] | null
    standards?: WorkerStandard[] | null
    mcps?: number[] | null
    taskDefs?: WorkerTaskDef[] | null
    ownerUserId?: number | null
    enabled?: boolean
    githubPermission?: WorkerGithubPermission
    resourcePermission?: WorkerResourcePermission
  }) =>
    request<Worker>('/workers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateWorker: (
    id: number,
    input: Partial<{
      name: string
      intro: string | null
      avatarUrl: string | null
      role: WorkerRole
      runtime: WorkerRuntime
      executorId: number | null
      providerId: string | null
      modelId: string | null
      variant: string | null
      prompt: string | null
      skills: WorkerSkill[] | null
      standards: WorkerStandard[] | null
      mcps: number[] | null
      taskDefs: WorkerTaskDef[] | null
      ownerUserId: number | null
      enabled: boolean
      githubPermission: WorkerGithubPermission
      resourcePermission: WorkerResourcePermission
    }>,
  ) =>
    request<Worker>(`/workers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteWorker: (id: number) =>
    request<void>(`/workers/${id}`, { method: 'DELETE' }),
  /** 启动 AGENTS.md 优化：异步执行立即返回运行快照，进度与结果经 SSE 推送 */
  startWorkerPromptOptimize: (input: {
    prompt: string
    workerId?: number | null
    executorId?: number | null
    providerId?: string | null
    modelId?: string | null
    variant?: string | null
  }) =>
    request<WorkerOptimizeSnapshot>('/workers/optimize-prompt', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 优化任务快照（刷新页面/晚订阅时恢复进度与结果） */
  getWorkerPromptOptimize: (runId: string) =>
    request<WorkerOptimizeSnapshot>(
      `/workers/optimize-prompt/${encodeURIComponent(runId)}`,
    ),
  /** 技能库目录：从 Gitea docs/skills 发现可选 SKILL.md */
  listWorkerSkillCatalog: (q?: string) => {
    const qs = new URLSearchParams()
    if (q?.trim()) qs.set('q', q.trim())
    return request<WorkerSkillCatalogItem[]>(
      `/workers/skill-catalog${qs.toString() ? `?${qs.toString()}` : ''}`,
    )
  },
  /** 规范库目录：从 Gitea docs/standard 发现可选目录 README.md（不含根目录） */
  listWorkerStandardCatalog: (q?: string) => {
    const qs = new URLSearchParams()
    if (q?.trim()) qs.set('q', q.trim())
    return request<WorkerStandardCatalogItem[]>(
      `/workers/standard-catalog${qs.toString() ? `?${qs.toString()}` : ''}`,
    )
  },
  /** 启动工作环境初始化：异步执行立即返回运行快照，进度经 SSE /workers/:id/initialize/stream 推送 */
  initializeWorker: (id: number) =>
    request<WorkerInitializeSnapshot>(`/workers/${id}/initialize`, {
      method: 'POST',
    }),
  /** 最近一次初始化快照（无任务为 idle；页面刷新后恢复进度展示用） */
  getWorkerInitialize: (id: number) =>
    request<WorkerInitializeSnapshot>(`/workers/${id}/initialize`),
  /** 工作概览卡片数据（实时状态，前端轮询） */
  listWorkersLive: () => request<Worker[]>('/workers/live'),
  /** 顶部「机器人」：可对话机器人清单，按名称/简介/ID 联想 */
  listWorkerChatWorkers: (q?: string) => {
    const query = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''
    return request<WorkerDebugOption[]>(`/worker-chats/workers${query}`)
  },
  /** 顶部「机器人」：当前用户已有会话，按首条消息时间倒序，最多 20 条 */
  listWorkerChatSessions: () =>
    request<WorkerChatSession[]>('/worker-chats/sessions'),
  /** 顶部「机器人」：当前用户与指定机器人的唯一聊天会话 */
  getWorkerChatSnapshot: (workerId: number) =>
    request<WorkerDebugSnapshot>(`/worker-chats/${workerId}`),
  /** 顶部「机器人」：发送文字与附件 */
  sendWorkerChatMessage: (
    workerId: number,
    content: string,
    files?: WorkerDebugAttachment[],
  ) =>
    request<WorkerDebugSnapshot>(`/worker-chats/${workerId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, files }),
    }),
  /** 顶部「机器人」：回答（answers）或跳过（null）提问 */
  replyWorkerChatQuestion: (
    workerId: number,
    questionId: string,
    answers: string[][] | null,
  ) =>
    request<WorkerDebugSnapshot>(
      `/worker-chats/${workerId}/questions/${encodeURIComponent(questionId)}/reply`,
      {
        method: 'POST',
        body: JSON.stringify(answers ? { answers } : { reject: true }),
      },
    ),
  /** 顶部「机器人」：清空消息并解绑 opencode 会话 */
  resetWorkerChat: (workerId: number) =>
    request<WorkerDebugSnapshot>(`/worker-chats/${workerId}/reset`, {
      method: 'POST',
    }),
  /** 当前用户与机器人的调试会话快照（含最近一次 todowrite 待办） */
  getWorkerDebugSnapshot: (workerId: number) =>
    request<WorkerDebugSnapshot>(`/workers/${workerId}/debug`),
  /** 发送一轮消息；立即返回 running，轮询快照取得最终回复 */
  sendWorkerDebugMessage: (workerId: number, content: string) =>
    request<WorkerDebugSnapshot>(`/workers/${workerId}/debug/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  /** 中断当前轮次，保留 opencode 会话与多轮上下文 */
  interruptWorkerDebug: (workerId: number) =>
    request<WorkerDebugSnapshot>(`/workers/${workerId}/debug/interrupt`, {
      method: 'POST',
    }),
  /** 回答（answers）或跳过（null）调试对话中的机器人提问 */
  replyWorkerDebugQuestion: (
    workerId: number,
    questionId: string,
    answers: string[][] | null,
  ) =>
    request<WorkerDebugSnapshot>(
      `/workers/${workerId}/debug/questions/${encodeURIComponent(questionId)}/reply`,
      {
        method: 'POST',
        body: JSON.stringify(answers ? { answers } : { reject: true }),
      },
    ),
  /** 清空对话并解绑旧会话；下一条消息创建新会话 */
  resetWorkerDebug: (workerId: number) =>
    request<WorkerDebugSnapshot>(`/workers/${workerId}/debug/reset`, {
      method: 'POST',
    }),

  /** 工单列表（category/status/q/workflowDefinitionId/scope 可选；scope=mine 仅当前用户提出） */
  listTickets: (params?: {
    category?: string
    status?: string
    q?: string
    workflowDefinitionId?: number
    scope?: 'mine'
  }) => {
    const qs = new URLSearchParams()
    if (params?.category) qs.set('category', params.category)
    if (params?.workflowDefinitionId)
      qs.set('workflowDefinitionId', String(params.workflowDefinitionId))
    if (params?.status) qs.set('status', params.status)
    if (params?.q) qs.set('q', params.q)
    if (params?.scope) qs.set('scope', params.scope)
    const q = qs.toString()
    return request<Ticket[]>(`/tickets${q ? `?${q}` : ''}`)
  },
  /** 工单详情：工单 + 关联任务 + 工作流运行视图 */
  getTicket: (id: number) => request<Ticket>(`/tickets/${id}`),
  /** 创建工单：工作流工单按配置起始字段提交 */
  createTicket: (input: {
    workflowDefinitionId?: number
    title?: string
    inputValues?: Record<string, unknown>
  }) =>
    request<Ticket>('/tickets', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 工单工作流验收（仅发起机器人/发起人） */
  acceptTicketWorkflow: (id: number, action: 'accept' | 'reject', remark?: string) =>
    request<Ticket>(`/tickets/${id}/workflow/${action}`, {
      method: 'POST',
      body: JSON.stringify({ remark }),
    }),
  /** 审批节点通过（发起人/当前审批处理人/管理员），remark 为可选审批意见 */
  approveTicketWorkflow: (id: number, remark?: string) =>
    request<Ticket>(`/tickets/${id}/workflow/approve`, {
      method: 'POST',
      body: JSON.stringify({ remark }),
    }),
  /** 审批节点驳回（驳回意见必填） */
  rejectTicketApproval: (id: number, remark: string) =>
    request<Ticket>(`/tickets/${id}/workflow/approval-reject`, {
      method: 'POST',
      body: JSON.stringify({ remark }),
    }),
  /** 审批类型任务：按任务通过（remark 可选） */
  approveTaskApproval: (taskId: number, remark?: string) =>
    request<Ticket>(`/tasks/${taskId}/approval/approve`, {
      method: 'POST',
      body: JSON.stringify({ remark }),
    }),
  /** 审批类型任务：按任务驳回（remark 必填） */
  rejectTaskApproval: (taskId: number, remark: string) =>
    request<Ticket>(`/tasks/${taskId}/approval/reject`, {
      method: 'POST',
      body: JSON.stringify({ remark }),
    }),

  /** 管理端工单配置（工单工作流） */
  listTicketWorkflowDefinitions: () =>
    request<TicketWorkflowDefinitionSummary[]>('/ticket-workflow-definitions'),
  createTicketWorkflowDefinition: (input: {
    name: string
    description?: string | null
    definition?: WorkflowDefinitionJson
  }) =>
    request<TicketWorkflowDefinitionDetail>('/ticket-workflow-definitions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteTicketWorkflowDefinition: (id: number) =>
    request<void>(`/ticket-workflow-definitions/${id}`, { method: 'DELETE' }),
  getTicketWorkflowDefinition: (id: number) =>
    request<TicketWorkflowDefinitionDetail>(`/ticket-workflow-definitions/${id}`),
  saveTicketWorkflowDraft: (
    id: number,
    input: {
      name?: string
      description?: string | null
      enabled?: boolean
      definition: WorkflowDefinitionJson
    },
  ) =>
    request<TicketWorkflowDefinitionDetail>(
      `/ticket-workflow-definitions/${id}/draft`,
      {
        method: 'PUT',
        body: JSON.stringify(input),
      },
    ),
  publishTicketWorkflow: (
    id: number,
    input: {
      name?: string
      description?: string | null
      enabled?: boolean
      definition: WorkflowDefinitionJson
    },
  ) =>
    request<TicketWorkflowDefinitionDetail>(
      `/ticket-workflow-definitions/${id}/publish`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),

  /** 任务定义列表 */
  listTaskTemplates: () => request<TaskTemplate[]>('/task-templates'),
  getTaskTemplate: (id: number) =>
    request<TaskTemplate>(`/task-templates/${id}`),
  /** 任务定义最近匹配的任务（最多 5 个，含根任务与子任务，按更新时间倒序） */
  listTaskTemplateTasks: (id: number) =>
    request<TaskPackage[]>(`/task-templates/${id}/tasks`),
  createTaskTemplate: (input: {
    name: string
    description?: string | null
    agentIds?: number[] | null
  }) =>
    request<TaskTemplate>('/task-templates', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTaskTemplate: (
    id: number,
    input: Partial<{
      name: string
      description: string | null
      agentIds: number[] | null
    }>,
  ) =>
    request<TaskTemplate>(`/task-templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteTaskTemplate: (id: number) =>
    request<void>(`/task-templates/${id}`, { method: 'DELETE' }),
  /** 关注任务定义（个人中心「我的任务定义」） */
  followTaskTemplate: (id: number) =>
    request<TaskTemplate>(`/task-templates/${id}/follow`, { method: 'POST' }),
  /** 取消关注任务定义 */
  unfollowTaskTemplate: (id: number) =>
    request<TaskTemplate>(`/task-templates/${id}/follow`, {
      method: 'DELETE',
    }),

  /** 任务概览统计 */
  taskOverview: () => request<TaskOverview>('/tasks/overview'),
  /** 任务列表（默认根任务树；q=编号/标题） */
  listTaskPackages: (params?: {
    q?: string
    status?: TaskStatus
    subStatus?: TaskSubStatus
    rootOnly?: boolean
  }) => {
    const qs = new URLSearchParams()
    if (params?.q) qs.set('q', params.q)
    if (params?.status) qs.set('status', params.status)
    if (params?.subStatus) qs.set('subStatus', params.subStatus)
    if (params?.rootOnly === false) qs.set('rootOnly', 'false')
    const q = qs.toString()
    return request<TaskPackage[]>(`/tasks${q ? `?${q}` : ''}`)
  },
  getTaskPackage: (id: number) => request<TaskPackage>(`/tasks/${id}`),
  /** 操作台：绑定机器人 + 我执行/待我处理的任务 */
  getWorkbench: () => request<WorkbenchSummary>('/workbench'),
  /** 单个任务在当前用户视角下的工作台角色 */
  getWorkbenchTask: (id: number) =>
    request<WorkbenchTask>(`/workbench/tasks/${id}`),
  workbenchAccept: (id: number) =>
    request<TaskPackage>(`/workbench/tasks/${id}/accept`, { method: 'POST' }),
  workbenchRefuse: (id: number, reason: string, suggestion?: string) =>
    request<TaskPackage>(`/workbench/tasks/${id}/refuse`, {
      method: 'POST',
      body: JSON.stringify({ reason, suggestion }),
    }),
  workbenchSendMessage: (id: number, content: string) =>
    request<TaskPackage>(`/workbench/tasks/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  workbenchAskQuestion: (
    id: number,
    questions: TaskChatQuestionInfo[],
  ) =>
    request<{ task: TaskPackage; questionId: string }>(
      `/workbench/tasks/${id}/questions`,
      { method: 'POST', body: JSON.stringify({ questions }) },
    ),
  getWorkbenchHandoff: (id: number) =>
    request<TaskHandoffDocument>(`/workbench/tasks/${id}/handoff`),
  updateWorkbenchHandoff: (
    id: number,
    input: { content: string; baseVersion: number },
  ) =>
    request<TaskHandoffDocument>(`/workbench/tasks/${id}/handoff`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  workbenchApplyHandoff: (id: number) =>
    request<TaskPackage>(`/workbench/tasks/${id}/handoff/apply`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  workbenchRevokeHandoff: (id: number) =>
    request<TaskPackage>(`/workbench/tasks/${id}/handoff/revoke`, {
      method: 'POST',
    }),
  workbenchCreateSubtask: (id: number, input: {
    perspective: 'requester' | 'responsible'
    templateId: number
    title: string
    description?: string | null
    input?: string | null
    outputSpec?: string | null
  }) =>
    request<TaskPackage>(`/workbench/tasks/${id}/subtasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  workbenchAcceptHandoff: (id: number) =>
    request<TaskPackage>(`/workbench/tasks/${id}/handoff/accept`, {
      method: 'POST',
    }),
  /** 停止任务（发起者或管理员，级联停止全部未结束子任务） */
  workbenchCancelTask: (id: number) =>
    request<TaskPackage>(`/workbench/tasks/${id}/cancel`, {
      method: 'POST',
    }),
  workbenchRejectHandoff: (id: number, content: string) =>
    request<TaskPackage>(`/workbench/tasks/${id}/handoff/reject`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  workbenchFailTask: (id: number, reason: string) =>
    request<TaskPackage>(`/workbench/tasks/${id}/fail`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  workbenchReplyQuestion: (
    id: number,
    questionId: string,
    body: { answers?: string[][]; reject?: boolean },
  ) =>
    request<TaskPackage>(
      `/workbench/tasks/${id}/questions/${encodeURIComponent(questionId)}/reply`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** 我的 AGENT：可用状态（未创建/执行器离线时带原因） */
  getWorkbenchAgent: () =>
    request<WorkbenchAgentInfo>('/workbench/agent'),
  /** 我的 AGENT：对话快照（taskId / 详情页上下文为空时使用通用会话） */
  getWorkbenchAgentSnapshot: (
    taskId?: number | null,
    context?: AgentPageContext | null,
  ) => {
    const query = [
      taskId ? `taskId=${encodeURIComponent(taskId)}` : '',
      agentPageContextQuery(context),
    ]
      .filter(Boolean)
      .join('&')
    return request<WorkerDebugSnapshot>(
      `/workbench/agent/snapshot${query ? `?${query}` : ''}`,
    )
  },
  /** 我的 AGENT：发送消息；taskId / 详情页上下文同时隔离会话并作为本轮上下文 */
  sendWorkbenchAgentMessage: (
    content: string,
    taskId?: number | null,
    files?: WorkerDebugAttachment[],
    context?: AgentPageContext | null,
  ) =>
    request<WorkerDebugSnapshot>('/workbench/agent/messages', {
      method: 'POST',
      body: JSON.stringify({
        content,
        taskId: taskId ?? null,
        files,
        ...agentPageContextBody(context),
      }),
    }),
  /** 我的 AGENT：可切换的模型与思考等级清单 */
  getWorkbenchAgentModels: (
    taskId?: number | null,
    context?: AgentPageContext | null,
  ) => {
    const query = [
      taskId ? `taskId=${encodeURIComponent(taskId)}` : '',
      agentPageContextQuery(context),
    ]
      .filter(Boolean)
      .join('&')
    return request<WorkerDebugModelCatalog>(
      `/workbench/agent/models${query ? `?${query}` : ''}`,
    )
  },
  /** 我的 AGENT：切换模型/思考等级（返回最新快照） */
  setWorkbenchAgentModel: (
    input: WorkerDebugModelSelection,
    taskId?: number | null,
    context?: AgentPageContext | null,
  ) =>
    request<WorkerDebugSnapshot>('/workbench/agent/model', {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        taskId: taskId ?? null,
        ...agentPageContextBody(context),
      }),
    }),
  /** 我的 AGENT：中断当前轮次 */
  interruptWorkbenchAgent: (
    taskId?: number | null,
    context?: AgentPageContext | null,
  ) =>
    request<WorkerDebugSnapshot>('/workbench/agent/interrupt', {
      method: 'POST',
      body: JSON.stringify({
        taskId: taskId ?? null,
        ...agentPageContextBody(context),
      }),
    }),
  /** 我的 AGENT：回答（answers）或跳过（null）提问 */
  replyWorkbenchAgentQuestion: (
    questionId: string,
    answers: string[][] | null,
    taskId?: number | null,
    context?: AgentPageContext | null,
  ) =>
    request<WorkerDebugSnapshot>(
      `/workbench/agent/questions/${encodeURIComponent(questionId)}/reply`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...(answers ? { answers } : { reject: true }),
          taskId: taskId ?? null,
          ...agentPageContextBody(context),
        }),
      },
    ),
  /** 我的 AGENT：重置当前任务/详情页会话 */
  resetWorkbenchAgent: (
    taskId?: number | null,
    context?: AgentPageContext | null,
  ) =>
    request<WorkerDebugSnapshot>('/workbench/agent/reset', {
      method: 'POST',
      body: JSON.stringify({
        taskId: taskId ?? null,
        ...agentPageContextBody(context),
      }),
    }),
  /** 任务详情页聊天快照：当前任务 + 所属 PIPELINE + 对话消息 */
  getTaskChat: (id: number) => request<TaskChatSnapshot>(`/tasks/${id}/chat`),
  /** 任务详情「交付」Tab：交付文档正文与版本信息 */
  getTaskHandoff: (id: number) =>
    request<TaskHandoffDocument>(`/tasks/${id}/handoff`),
  /** 任务详情「复盘」Tab：复盘文档；尚未生成时为 null */
  getTaskReview: (id: number) =>
    request<TaskDocumentContent | null>(`/tasks/${id}/review`),
  /** 任务详情「文档」Tab：任务目录文档 + 文档引用的图片/文件 */
  listTaskDocuments: (id: number) =>
    request<TaskDocumentsView>(`/tasks/${id}/documents`),
  /** 读取任务目录下某篇 Markdown 文档的正文 */
  getTaskDocument: (id: number, name: string) =>
    request<TaskDocumentContent>(
      `/tasks/${id}/documents/${encodeURIComponent(name)}`,
    ),
  createTaskPackage: (input: {
    /** 可空：按任务描述首行生成标题 */
    title?: string
    description?: string | null
    input?: string | null
    outputSpec?: string | null
    agentId?: number | null
    schedulerId?: number | null
    parentId?: number | null
    templateId?: number | null
  }) =>
    request<TaskPackage>('/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTaskPackage: (
    id: number,
    input: Partial<{
      title: string
      description: string | null
      input: string | null
      outputSpec: string | null
      workPlan: string | null
      agentId: number | null
      result: string | null
      missingItems: TaskMissingItem[] | null
    }>,
  ) =>
    request<TaskPackage>(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteTaskPackage: (id: number) =>
    request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  /** 重新提交：等待中-待反馈 → 等待中-待继续（机器人仍有执行容量后恢复执行） */
  submitTask: (id: number) =>
    request<TaskPackage>(`/tasks/${id}/submit`, { method: 'POST' }),
  /** 提交反馈并等待继续（反馈正文追加到任务描述） */
  provideTaskFeedback: (id: number, content?: string) =>
    request<TaskPackage>(`/tasks/${id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  /** 任务对话发送消息：等待阶段补充需求，执行阶段直接续聊 */
  sendTaskMessage: (
    id: number,
    content: string,
    perspective?: TaskChatPerspective,
  ) =>
    request<TaskPackage>(`/tasks/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, perspective }),
    }),
  /** 人工分配机器人（执行中会中断旧机器人并重新执行） */
  assignTask: (id: number, agentId: number) =>
    request<TaskPackage>(`/tasks/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ agentId }),
    }),
  /** 回答/跳过机器人提问（answers 与问题顺序一致） */
  replyTaskQuestion: (
    id: number,
    questionId: string,
    body: { answers?: string[][]; reject?: boolean },
  ) =>
    request<{ ok: boolean }>(
      `/tasks/${id}/questions/${encodeURIComponent(questionId)}/reply`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** 人工标记待反馈（补充需要用户提供/确认的事项） */
  markTaskMissing: (id: number, items: TaskMissingItem[]) =>
    request<TaskPackage>(`/tasks/${id}/missing`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  /** 中断执行 */
  interruptTask: (id: number) =>
    request<TaskPackage>(`/tasks/${id}/interrupt`, { method: 'POST' }),
  /** 验收通过：等待中-待验收 → 已结束-完成（后台生成任务复盘） */
  acceptTask: (id: number) =>
    request<TaskPackage>(`/tasks/${id}/accept`, { method: 'POST' }),
  /** 验收不通过：前 3 次退回机器人，第 4 次起转任务执行方待反馈 */
  rejectTask: (id: number, content: string) =>
    request<TaskPackage>(`/tasks/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  /** 判定任务失败：等待中-待验收 → 已结束-失败 */
  failTask: (id: number, reason: string) =>
    request<TaskPackage>(`/tasks/${id}/fail`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  /** 重新生成任务复盘（固定覆盖 REVIEW） */
  generateTaskHandoff: (id: number) =>
    request<{ accepted: true }>(`/tasks/${id}/handoff`, {
      method: 'POST',
    }),
  /** 停止任务（发起者或管理员，级联停止全部未结束子任务） */
  cancelTask: (id: number) =>
    request<TaskPackage>(`/tasks/${id}/cancel`, { method: 'POST' }),
  /** 知识目录（目录地址以 /detail/.../ 结尾） */
  getKnowledgeDirectory: (path: string) =>
    request<KnowledgeDirectory>(`/docs/detail${knowledgeApiSuffix(path, true)}`),
  getKnowledgeArticle: (path: string) =>
    request<KnowledgeNode>(`/docs/detail${knowledgeApiSuffix(path, false)}`),
  getKnowledgeNode: (id: string) => request<KnowledgeNode>(`/docs/nodes/${id}`),
  createKnowledgeNode: (input: {
    kind: KnowledgeNodeKind
    parentPath: string
    name: string
    title?: string
    content?: string
  }) =>
    request<KnowledgeNode>('/docs/nodes', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateKnowledgeNode: (
    id: string,
    input: Partial<{
      title: string
      content: string
      name: string
      parentPath: string
    }>,
  ) =>
    request<KnowledgeNode>(`/docs/nodes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteKnowledgeNode: (id: string, recursive = false) =>
    request<void>(`/docs/nodes/${id}${recursive ? '?recursive=true' : ''}`, {
      method: 'DELETE',
    }),
  searchKnowledge: (params: {
    q: string
    path?: string
    page?: number
    pageSize?: number
  }) => {
    const qs = new URLSearchParams({ q: params.q })
    if (params.path && params.path !== '/') qs.set('path', params.path)
    if (params.page) qs.set('page', String(params.page))
    if (params.pageSize) qs.set('pageSize', String(params.pageSize))
    return request<KnowledgeSearchResponse>(`/docs/search?${qs.toString()}`)
  },
}

function knowledgeApiSuffix(path: string, directory: boolean): string {
  const encoded = encodeKnowledgePath(path)
  if (!encoded) return directory ? '/' : ''
  return `/${encoded}${directory ? '/' : ''}`
}
