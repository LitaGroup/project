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
