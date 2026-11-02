import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * 任务定义关注：用户关注任务定义后可在「个人中心 - 任务定义 - 我的任务定义」中快速查看。
 * 仅记录关系，无物理外键；任务定义删除时由应用层同步清理。
 */
@Entity('task_template_follows')
@Unique(['templateId', 'userId'])
export class TaskTemplateFollow {
  @PrimaryGeneratedColumn()
  id: number;

  /** 任务定义 ID（task_templates.id） */
  @Index()
  @Column({ type: 'int' })
  templateId: number;

  /** 关注用户 ID（users.id） */
  @Index()
  @Column({ type: 'int' })
  userId: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
