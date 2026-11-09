import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 系统「未知任务」定义固定 ID（系统任务定义 ID 段 <1000） */
export const UNKNOWN_TASK_TEMPLATE_ID = 6;

/**
 * 任务定义（TaskTemplate）：一类任务的复用定义（描述 + 默认处理机器人）。
 * 描述中用 Markdown 章节统一说明任务范围、所需输入与交付方式。
 */
@Entity('task_templates')
export class TaskTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  /** 模板名称（唯一） */
  @Column({ length: 100, unique: true })
  name: string;

  /**
   * 任务定义描述（Markdown）：
   * 统一说明任务范围、完成任务所需输入以及最终交付方式。
   */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 默认处理机器人列表（workers.id，无物理外键；空数组=创建任务时不指定） */
  @Column({ type: 'simple-json', default: '[]' })
  agentIds: number[];

  /** 创建人用户 ID（users.id，可空；系统内置定义为空） */
  @Column({ type: 'int', nullable: true })
  createdById: number | null;

  /** 创建人姓名快照（用户改名后仍保留创建时姓名） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  createdByName: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
