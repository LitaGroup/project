import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 默认任务类型（兜底分类；不允许改名与删除，仅可编辑描述） */
export const TASK_TYPE_DEFAULT = '其它';

/** 自动识别分配无法匹配时使用的系统任务类型 */
export const TASK_TYPE_UNKNOWN = '未知任务';

/** 工单任务使用的系统任务类型 */
export const TASK_TYPE_TICKET = '工单';

/** 系统维护、不可改名或删除的任务类型 */
export const SYSTEM_TASK_TYPE_NAMES: readonly string[] = [
  TASK_TYPE_DEFAULT,
  TASK_TYPE_UNKNOWN,
  TASK_TYPE_TICKET,
];

/** 初始任务类型字典（迁移写入；开发环境无迁移时启动补齐，均按名称幂等） */
export const DEFAULT_TASK_TYPES: Array<{ name: string; description: string }> =
  [
    { name: '需求分析', description: '梳理需求目标、边界与验收标准' },
    { name: '技术设计', description: '输出技术方案与实现设计' },
    { name: '前端开发', description: '页面与前端功能实现' },
    { name: '后端开发', description: '服务端接口与逻辑实现' },
    { name: '客户端开发', description: '移动客户端功能实现' },
    { name: 'UI', description: '界面与视觉设计' },
    { name: '测试', description: '用例编写与功能验证' },
    { name: '发布', description: '构建发布与上线操作' },
    {
      name: TASK_TYPE_DEFAULT,
      description: '未归类的通用任务（默认类型，不可改名与删除）',
    },
    {
      name: TASK_TYPE_UNKNOWN,
      description:
        '平台无法匹配任务定义/类型对应机器人时自动归入，由系统未知任务定义（ID=6）接管',
    },
    {
      name: TASK_TYPE_TICKET,
      description:
        '工单创建的调度任务类型，按工单类型绑定的系统任务定义分发，不允许改名与删除',
    },
  ];

/**
 * 任务类型：平台内维护的分类字典（原固定枚举 TaskType 迁移为本表）。
 * 名称规则：2-8 个中文字符，或 1-64 个英文字符（校验见 task-types.service）。
 */
@Entity('task_types')
export class TaskType {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 64, unique: true })
  name: string;

  /** 类型描述（识别任务时随类型清单下发给调度机器人，辅助分类） */
  @Column({ type: 'text', default: '' })
  description: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
