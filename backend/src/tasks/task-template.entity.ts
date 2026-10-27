import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 任务定义（TaskTemplate）：一类任务的复用定义（描述/输入/输出 + 默认处理机器人）。
 * 新建任务时可按模板填充字段，减少重复录入。
 */
@Entity('task_templates')
export class TaskTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  /** 模板名称（唯一） */
  @Column({ length: 100, unique: true })
  name: string;

  /** 任务描述（这类任务要做什么） */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 任务输入（需要提供什么材料/上下文） */
  @Column({ type: 'text', nullable: true })
  input: string | null;

  /** 任务输出（要交付什么） */
  @Column({ type: 'text', nullable: true })
  outputSpec: string | null;

  /** 默认处理机器人（workers.id，可空=创建任务时不指定） */
  @Column({ type: 'int', nullable: true })
  agentId: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
