import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TASK_TYPE_DEFAULT } from '../task-types/task-type.entity';

/** 系统「未知任务」定义固定 ID（系统任务定义 ID 段 <1000） */
export const UNKNOWN_TASK_TEMPLATE_ID = 6;

/**
 * 任务定义（TaskTemplate）：一类任务的复用定义（类型 + 描述 + 默认处理机器人）。
 * 描述中用 Markdown 章节统一说明任务范围、所需输入与交付方式。
 */
@Entity('task_templates')
export class TaskTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  /** 模板名称（唯一） */
  @Column({ length: 100, unique: true })
  name: string;

  /** 任务类型（task_types.name，默认兜底「其它」；无物理外键，改名由任务类型服务同步） */
  @Column({ type: 'varchar', length: 64, default: TASK_TYPE_DEFAULT })
  type: string;

  /**
   * 任务定义描述（Markdown）：
   * 统一说明任务范围、完成任务所需输入以及最终交付方式。
   */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 默认处理机器人列表（workers.id，无物理外键；空数组=创建任务时不指定） */
  @Column({ type: 'simple-json', default: '[]' })
  agentIds: number[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
