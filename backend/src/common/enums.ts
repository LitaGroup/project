/**
 * 领域枚举，与 AGENTS.md 中已确认的模型一一对应，勿改名。
 * value 使用中文原文，避免中英映射漂移。
 */

export enum DocumentType {
  REQUIREMENT = '需求',
  FEATURE = '功能',
  TEST = '测试',
  TECH = '技术',
  API = '接口',
  CONFIG = '配置',
}

export enum DocumentSource {
  /** 飞书一键同步，单向导入（飞书 → 平台，不回写） */
  FEISHU = '飞书',
  /** APIPOST 接口文档导入（swagger JSON 单向拉取，content 存原始 JSON） */
  APIPOST = 'apipost',
  /** 平台内直接编写，无外部来源 */
  MARKDOWN = '-',
}

export enum ProjectType {
  ACTIVITY = '活动',
  FEATURE = '功能',
  GAME = '游戏',
  DATA = '数据',
  ADMIN = '后台',
  TECH = '技术',
  OTHER = '其它',
}

export enum ProjectStatus {
  PLANNED = '待分配',
  IN_PROGRESS = '开发中',
  FINISHED = '已关闭',
  /** 飞书源表"需求状态"为「暂停」的项目（人工确认新增） */
  PAUSED = '暂停中',
  /** 项目提测后的流程态（仅平台内产生；飞书同步不覆盖，见 project-sync.service） */
  IN_TEST = '测试中',
  /** 已发布上线（飞书"✅ 已上线"同步映射，见 project-sync.service） */
  PUBLISHED = '已发布',
}

/**
 * 提测记录状态：提测后默认「待冒烟」，由测试同学判定「已通过 / 未通过」
 * （可从已通过/未通过改回待冒烟重新冒烟，判定人/判定时间随之清空）。
 */
export enum ReleaseStatus {
  PENDING = '待冒烟',
  PASSED = '已通过',
  FAILED = '未通过',
}

/** 缺陷状态：平台侧统一为 开放/修复/关闭 */
export enum DefectStatus {
  OPEN = '开放',
  FIXED = '修复',
  CLOSED = '关闭',
}

/** 缺陷优先级：高/中/低（默认中） */
export enum DefectPriority {
  HIGH = '高',
  MEDIUM = '中',
  LOW = '低',
}

/**
 * 脚本运行设备/目标：决定运行位置。
 * server/h5 → project 本地 node 直跑；android/ios → appium-agent 远程执行。
 */
export enum RunDevice {
  H5 = 'h5',
  ANDROID = 'android',
  IOS = 'ios',
  SERVER = 'server',
}

/** APP 自动化测试目标应用（app_versions 用） */
export enum AppTarget {
  LITA = 'lita',
  LITA_LITE = 'lita lite',
}

/**
 * 资源类型：项目完成需要需求方提供的素材/信息。
 * 配置=飞书配置文档（绑定文档模块）；多语言=固定 Google Sheet 内的命名空间前缀；
 * 文件资源=图片/视频等文件的链接；UI=蓝湖设计稿地址（仅原样保存链接，不做任何处理）；其它=自由登记。
 */
export enum ResourceType {
  CONFIG = '配置',
  I18N = '多语言',
  FILE = '文件资源',
  UI = 'UI',
  OTHER = '其它',
}

/** 多语言前缀的 SHEET 段（对应固定 Google Sheet 的工作表名），Activity 为默认值 */
export enum I18nSheet {
  ACTIVITY = 'Activity',
  FRONTEND = 'Frontend',
  FE = 'FE',
  BACKEND = 'Backend',
}

/**
 * 资源状态流转：缺失 → 草稿 → 确认；废弃为软删除终态（列表默认隐藏，仍可硬删）。
 * 状态间不强制单向流转（需求方可能返工回草稿）。
 */
export enum ResourceStatus {
  MISSING = '缺失',
  DRAFT = '草稿',
  CONFIRMED = '确认',
  DISCARDED = '废弃',
}

/**
 * 节点达成标记：no（默认）/yes/cancel。
 * yes 须研发验收后标记（标记时自动记录北京时间当天为实际达成日期）。
 */
export enum MilestoneAchieved {
  NO = 'no',
  YES = 'yes',
  CANCEL = 'cancel',
}

/**
 * 节点状态（不落库，由 达成 + 实际达成日期 + 日期 推导）：
 * cancel → 取消；yes → 达成日期早于日期1天以上=提前达成 / 等于日期=达成 / 晚于日期=延期；
 * no → 今天（北京）超过日期=延期，否则=准备中。
 */
export enum MilestoneStatus {
  PREPARING = '准备中',
  EARLY = '提前达成',
  ACHIEVED = '达成',
  DELAYED = '延期',
  CANCELLED = '取消',
}

/**
 * 用户角色：飞书登录落库的身份（仅身份展示，不拦截接口）。
 * 首个登录的用户自动授予管理员。
 */
export enum UserRole {
  ADMIN = '管理员',
  MEMBER = '成员',
}

/**
 * 项目代码分支归类：该项目涉及修改的 仓库+分支 属于哪一端。
 */
export enum CodeBranchCategory {
  BACKEND = '后端',
  H5 = 'H5',
  ANDROID = '安卓',
  IOS = 'IOS',
  OTHER = '其它',
}

/**
 * 代码仓库的端（仓库列表展示/筛选用；新建项目代码分支未指定归类时按此推导默认归类）。
 */
export enum RepoPlatform {
  FRONTEND = '前端',
  BACKEND = '后端',
  ANDROID = '安卓',
  IOS = '苹果',
  OTHER = '其它',
}

/**
 * 代码仓库状态：有效（参与联想与代码分支登记）/ 忽略（不再出现在联想等候选，存量登记保留）。
 */
export enum RepoStatus {
  ACTIVE = '有效',
  IGNORED = '忽略',
}

/**
 * 任务处理中心（FEATURE-02）领域枚举。
 */

/** 执行器类型：本期仅 opencode，预留后续扩展 */
export enum ExecutorType {
  OPENCODE = 'opencode',
  CODEX = 'codex',
  CLAUDE_CODE = 'claude-code',
}

/** 机器人角色：工作者（干活）/ 调度器（任务识别、拆解、分配建议；当前为系统内置机器人） */
export enum WorkerRole {
  WORKER = '工作者',
  SCHEDULER = '调度器',
}

/**
 * 机器人运行时：统一走执行器（opencode 等）。
 * PI 为历史值（原平台进程内 PI Agent），仅兼容存量数据，启动时迁移为 opencode，禁止再创建。
 */
export enum WorkerRuntime {
  OPENCODE = 'opencode',
  CODEX = 'codex',
  CLAUDE_CODE = 'claude-code',
  /** @deprecated 平台进程内 PI Agent 已移除（调度并入机器人，统一走执行器） */
  PI = 'pi',
}

/** 机器人实时状态（不落库，由名下任务实时推导，见 workers.service） */
export enum WorkerLiveStatus {
  IDLE = '空闲中',
  WORKING = '工作中',
  WAITING = '等待中',
  ACCEPTING = '验收中',
}

/**
 * 任务主状态（三态：等待中 / 进行中 / 已结束）。
 * 子状态见 TaskSubStatus；LOOP（每秒）按 主状态 + 子状态 推进任务。
 */
export enum TaskStatus {
  WAITING = '等待中',
  RUNNING = '进行中',
  FINISHED = '已结束',
}

/**
 * 任务子状态（与主状态严格对应）：
 * - 等待中：待分配 / 待接受 / 待反馈 / 待继续 / 待验收
 * - 进行中：执行中
 * - 已结束：完成 / 已拒绝 / 失败 / 取消
 *
 * 待识别/识别中仅保留给历史数据迁移与旧客户端兼容，新流程不再使用。
 */
export enum TaskSubStatus {
  PENDING_ASSIGNMENT = '待分配',
  PENDING_ACCEPTANCE = '待接受',
  PENDING_FEEDBACK = '待反馈',
  PENDING_RESUME = '待继续',
  PENDING_ACCEPT = '待验收',
  EXECUTING = '执行中',
  COMPLETED = '完成',
  REFUSED = '已拒绝',
  FAILED = '失败',
  CANCELED = '取消',
  /** @deprecated 新流程创建后直接待分配 */
  PENDING_IDENTIFY = '待识别',
  /** @deprecated 新流程不再有识别阶段 */
  IDENTIFYING = '识别中',
}

/** 调度方案状态：PI 产出 → 管理员确认/驳回 */
export enum DispatchPlanStatus {
  PENDING = '待确认',
  CONFIRMED = '已确认',
  REJECTED = '已驳回',
}
