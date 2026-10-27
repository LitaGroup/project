/** 与后端 common/enums.ts 对应，枚举值用中文原文 */
export const PROJECT_TYPES = ['活动', '功能', '游戏', '数据', '后台', '技术', '其它'] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

export const PROJECT_STATUSES = ['待分配', '开发中', '已关闭', '暂停中', '测试中', '已发布'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** 提测记录状态（与后端 ReleaseStatus 对应）：提测默认待冒烟，由测试同学判定 已通过/未通过 */
export const RELEASE_STATUSES = ['待冒烟', '已通过', '未通过'] as const
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number]

/** 与后端 DefectStatus 对应，平台侧统一为 开放/修复/关闭 */export const DEFECT_STATUSES = ['开放', '修复', '关闭'] as const
export type DefectStatus = (typeof DEFECT_STATUSES)[number]

/** 缺陷端：只保留这四类，非规范值统一为"未知"（默认） */
export const DEFECT_PLATFORMS = ['前端', '后端', 'APP端', '未知'] as const

/** 缺陷优先级：高/中/低（默认中，与后端 DefectPriority 对应） */
export const DEFECT_PRIORITIES = ['高', '中', '低'] as const
export type DefectPriority = (typeof DEFECT_PRIORITIES)[number]

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
  score: number
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
  /** 提测人姓名 */
  operator: string | null
  /** 提测状态：待冒烟（默认）/ 已通过 / 未通过（由测试同学判定） */
  status: ReleaseStatus
  /** 判定人姓名（已通过/未通过时记录，待冒烟为空） */
  verifier: string | null
  /** 判定时间（已通过/未通过时记录，待冒烟为空） */
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
  resources?: { frontend?: string; backend?: string; qa?: string; client?: string } | null
  /** 飞书同步的项目有 record_id，可据此判断来源 */
  feishuRecordId?: string | null
  description?: string | null
  /** 脚本目录：相对脚本根目录的路径，登记检查时只在该子目录下扫描 */
  scriptsPath?: string | null
  /** 飞书通知群：群机器人 webhook 的 secret，任务运行时向该群推送通知 */
  feishuWebhook?: string | null
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
  createdAt: string
  updatedAt: string
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
  /** Lita 平台 API 地址（LITA_API_HOST，飞书 token 服务） */
  litaApiHost: string
  /** 项目同步源多维表格地址（FEISHU_PROJECT_SOURCE_URL，未配置用内置默认） */
  feishuProjectSourceUrl: string
  /** 飞书 token 来源：lita（LITA_USER_TOKEN 已配置）/ app-credential（自建应用凭据兜底） */
  feishuTokenSource: 'lita' | 'app-credential'
  /** 兜底通知 webhook 是否已配置（不暴露 secret） */
  feishuWebhookConfigured: boolean
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

export const WORKER_RUNTIMES = ['opencode'] as const
export type WorkerRuntime = (typeof WORKER_RUNTIMES)[number]

export const WORKER_LIVE_STATUSES = ['空闲中', '工作中', '等待中', '验收中'] as const
export type WorkerLiveStatus = (typeof WORKER_LIVE_STATUSES)[number]

/** 任务类型名称（动态字典，来源 /api/task-types） */
export type TaskType = string

/** 任务类型定义（task_types 表，平台内维护） */
export interface TaskTypeDef {
  id: number
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

/** 任务主状态：等待中 / 进行中 / 已结束 */
export const TASK_STATUSES = ['等待中', '进行中', '已结束'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** 任务子状态：与主状态严格对应（等待中：待识别/待反馈/待验收；进行中：识别中/执行中；已结束：完成/取消） */
export const TASK_SUB_STATUSES = [
  '待识别',
  '待反馈',
  '待验收',
  '识别中',
  '执行中',
  '完成',
  '取消',
] as const
export type TaskSubStatus = (typeof TASK_SUB_STATUSES)[number]

/** 执行器：实际执行任务的工具实例（本期 opencode server） */
export interface ExecutorProviderModel {
  id: string
  name: string
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

/** 机器人技能引用（保存后安装到工位 .opencode/skills） */
export interface WorkerSkill {
  name: string
  path: string
  url: string
  description?: string | null
  version?: string | null
  sourceUrl?: string | null
}
export interface WorkerTaskDef {
  type: string
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
  prompt: string | null
  skills: WorkerSkill[] | null
  taskDefs: WorkerTaskDef[] | null
  ownerUserId: number | null
  ownerName: string | null
  enabled: boolean
  /** 系统机器人（代码内置，网页不可新增/删除） */
  system: boolean
  /** 工位路径 {WORKER_BASE_DIR}/worker/{id}（未配置 env 为 null） */
  workdir: string | null
  liveStatus: WorkerLiveStatus
  activeTask: { id: number; code: string; title: string; status: string } | null
  createdAt: string
  updatedAt: string
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

export interface WorkerDebugMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 流式累积的思考内容（session.reasoning.* 事件；可能为空） */
  reasoning?: string
  status: 'running' | 'complete' | 'error'
  createdAt: string
  /** message=普通对话气泡；question=机器人提问卡片（缺省按 message 处理） */
  kind?: 'message' | 'question'
  /** kind=question 时的问答卡片数据 */
  question?: WorkerDebugQuestion
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
  sessionId: string | null
  status: 'idle' | 'running'
  messages: WorkerDebugMessage[]
  /** 最近一次 todowrite 的待办清单（右侧待办面板数据源） */
  todos: WorkerDebugTodo[]
  error: string | null
  updatedAt: string
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

/** 任务：明确输入/输出/类型，可挂子任务形成工作流 */
export interface TaskPackage {
  id: number
  code: string
  title: string
  type: TaskType
  /** 任务定义（task_templates.id，可空） */
  templateId: number | null
  /** 任务定义名称快照 */
  templateName: string | null
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
  status: TaskStatus
  /** 子状态：待识别 / 待反馈 / 待验收 / 识别中 / 执行中 / 完成 / 取消 */
  subStatus: TaskSubStatus
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
  acceptedAt: string | null
  acceptedBy: string | null
  deliveredAt: string | null
  archivedAt: string | null
  canceledAt: string | null
  createdAt: string
  updatedAt: string
  /** 列表接口附带的子任务（调度拆解产物） */
  children?: TaskPackage[]
  /** 详情接口附带的事件时间线与实时输出行 */
  events?: TaskEvent[]
  liveLines?: string[]
}

/** 任务看板 SSE（GET /api/tasks/stream）：初始快照 + 增量事件 */
export type TaskRealtimeMessage =
  | { type: 'snapshot'; tasks: TaskPackage[]; at: number }
  | { type: 'task.upsert'; task: TaskPackage; at: number }
  | { type: 'task.line'; taskId: number; line: string; at: number }
  | { type: 'task.delete'; ids: number[]; at: number }
  | { type: 'ping'; at: number }

/** 任务聊天发送方：用户 / 机器人 / 调度机器人 / 系统 */
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
  detail?: string
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
  /** 当前任务需求人姓名 */
  requesterName: string | null
  /** 当前执行机器人负责人姓名 */
  agentOwnerName: string | null
  /** 人工介入次数 */
  interventionCount: number
  /** 当前任务事件时间线（倒序） */
  events: TaskEvent[]
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

/** 任务定义：一类任务的可复用定义（任务类型 + 描述 + 默认处理机器人） */
export interface TaskTemplate {
  id: number
  name: string
  /** 任务类型名称（task_types.name） */
  type: string
  /** Markdown 描述：包含任务范围、所需输入与交付方式 */
  description: string | null
  /** 默认处理机器人 workers.id 列表 */
  agentIds: number[]
  createdAt: string
  updatedAt: string
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
  /** 缺陷列表：传 projectId 按项目过滤，不传返回全部。不含 description/images */
  listDefects: (projectId?: number) =>
    request<Defect[]>(
      `/defects${projectId === undefined ? '' : `?projectId=${projectId}`}`,
    ),
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
  /** 项目提测：创建提测记录 + 状态流转「测试中」+ 通知提测群与项目人员（testers 至少 1 人且须为用户系统内用户） */
  submitRelease: (
    projectId: number,
    input: {
      content?: string
      urls?: string[]
      branches?: ReleaseBranch[]
      testers: string[]
    },
  ) =>
    request<ProjectRelease>(`/projects/${projectId}/release`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** 提测记录列表（倒序） */
  listReleases: (projectId: number) =>
    request<ProjectRelease[]>(`/projects/${projectId}/releases`),
  /** 判定提测结果（测试同学操作）：待冒烟 → 已通过 / 未通过，改回待冒烟清空判定人/时间 */
  updateReleaseStatus: (releaseId: number, status: ReleaseStatus) =>
    request<ProjectRelease>(`/releases/${releaseId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  /** 用户系统全量名单（项目人员/提测测试人员等场景选择用户，亦供管理端用户列表页展示） */
  listUsers: () =>
    request<{ users: PlatformUser[] }>('/auth/users').then((r) => r.users),
  /** 当前登录用户（未登录 401，调用方 catch 视为未登录态） */
  getMe: () => request<{ user: User }>('/auth/me').then((r) => r.user),
  /** 当前用户的 agent 访问令牌（调 .md 端点鉴权用；尚未发放则自动生成） */
  getAgentToken: () =>
    request<{ token: string }>('/auth/agent-token').then((r) => r.token),
  /** 重置 agent 访问令牌（旧令牌立即失效，需同步更新 agent 侧配置） */
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

  /** 机器人列表（role 筛选） */
  listWorkers: (params?: { role?: WorkerRole }) => {
    const qs = new URLSearchParams()
    if (params?.role) qs.set('role', params.role)
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
    prompt?: string | null
    skills?: WorkerSkill[] | null
    taskDefs?: WorkerTaskDef[] | null
    ownerUserId?: number | null
    enabled?: boolean
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
      prompt: string | null
      skills: WorkerSkill[] | null
      taskDefs: WorkerTaskDef[] | null
      ownerUserId: number | null
      enabled: boolean
    }>,
  ) =>
    request<Worker>(`/workers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteWorker: (id: number) =>
    request<void>(`/workers/${id}`, { method: 'DELETE' }),
  /** AI 优化机器人 AGENTS.md：结构补全 + 清晰化（统一走 opencode 等执行器） */
  optimizeWorkerPrompt: (input: {
    prompt: string
    workerId?: number | null
    executorId?: number | null
    providerId?: string | null
    modelId?: string | null
  }) =>
    request<{ prompt: string }>('/workers/optimize-prompt', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.prompt),
  /** 技能库目录：从 Gitea docs/skills 发现可选 SKILL.md */
  listWorkerSkillCatalog: (q?: string) => {
    const qs = new URLSearchParams()
    if (q?.trim()) qs.set('q', q.trim())
    return request<WorkerSkillCatalogItem[]>(
      `/workers/skill-catalog${qs.toString() ? `?${qs.toString()}` : ''}`,
    )
  },
  /** 初始化/同步工作环境：写入工位 AGENTS.md 并按清单同步 .opencode/skills */
  initializeWorker: (id: number) =>
    request<{ status: 'success'; workdir: string }>(
      `/workers/${id}/initialize`,
      { method: 'POST' },
    ),
  /** 工作概览卡片数据（实时状态，前端轮询） */
  listWorkersLive: () => request<Worker[]>('/workers/live'),
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

  /** 任务定义列表 */
  listTaskTemplates: () => request<TaskTemplate[]>('/task-templates'),
  getTaskTemplate: (id: number) =>
    request<TaskTemplate>(`/task-templates/${id}`),
  createTaskTemplate: (input: {
    name: string
    type?: string | null
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
      type: string | null
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

  /** 任务类型字典（识别与筛选用，平台内维护） */
  listTaskTypes: () => request<TaskTypeDef[]>('/task-types'),
  createTaskType: (input: { name: string; description?: string | null }) =>
    request<TaskTypeDef>('/task-types', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTaskType: (
    id: number,
    input: { name?: string; description?: string | null },
  ) =>
    request<TaskTypeDef>(`/task-types/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteTaskType: (id: number) =>
    request<void>(`/task-types/${id}`, { method: 'DELETE' }),

  /** 任务概览统计 */
  taskOverview: () => request<TaskOverview>('/tasks/overview'),
  /** 任务列表（默认根任务树；q=编号/标题） */
  listTaskPackages: (params?: {
    q?: string
    status?: TaskStatus
    subStatus?: TaskSubStatus
    type?: TaskType
    rootOnly?: boolean
  }) => {
    const qs = new URLSearchParams()
    if (params?.q) qs.set('q', params.q)
    if (params?.status) qs.set('status', params.status)
    if (params?.subStatus) qs.set('subStatus', params.subStatus)
    if (params?.type) qs.set('type', params.type)
    if (params?.rootOnly === false) qs.set('rootOnly', 'false')
    const q = qs.toString()
    return request<TaskPackage[]>(`/tasks${q ? `?${q}` : ''}`)
  },
  getTaskPackage: (id: number) => request<TaskPackage>(`/tasks/${id}`),
  /** 任务详情页聊天快照：当前任务 + 所属 PIPELINE + 对话消息 */
  getTaskChat: (id: number) => request<TaskChatSnapshot>(`/tasks/${id}/chat`),
  createTaskPackage: (input: {
    /** 可空：按任务描述首行生成标题 */
    title?: string
    type?: TaskType
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
      type: TaskType
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
  /** 重新识别：等待中-待反馈 → 等待中-待识别（LOOP 下一轮自动处理） */
  submitTask: (id: number) =>
    request<TaskPackage>(`/tasks/${id}/submit`, { method: 'POST' }),
  /** 提交反馈并重新识别（反馈正文追加到任务描述） */
  provideTaskFeedback: (id: number, content?: string) =>
    request<TaskPackage>(`/tasks/${id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  /** 任务对话发送消息：识别阶段补充需求，执行阶段直接续聊 */
  sendTaskMessage: (id: number, content: string) =>
    request<TaskPackage>(`/tasks/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
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
  /** 验收通过：等待中-待验收 → 已结束-完成 */
  acceptTask: (id: number) =>
    request<TaskPackage>(`/tasks/${id}/accept`, { method: 'POST' }),
  /** 取消（任意未结束任务） */
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
