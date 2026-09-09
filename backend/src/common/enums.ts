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
  PLANNED = '计划中',
  IN_PROGRESS = '进行中',
  FINISHED = '已结束',
  /** 飞书源表"需求状态"为「暂停」的项目（人工确认新增） */
  PAUSED = '暂停',
}

/**
 * 缺陷状态：平台侧统一为 open/reopen/fixed/closed/invalid。
 * 飞书侧对应选项为 new/fixed/close/reopen/invalid（new→open、close→closed），
 * 同步时按别名映射，飞书侧乱填的选项统一映射为 open。
 */
export enum DefectStatus {
  OPEN = 'open',
  REOPEN = 'reopen',
  FIXED = 'fixed',
  CLOSED = 'closed',
  INVALID = 'invalid',
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
