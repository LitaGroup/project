import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BacklogMemberRole, BacklogStatus } from '../common/enums';

/** 迭代项成员：角色 + 平台用户 + 姓名快照 */
export interface BacklogMember {
  role: BacklogMemberRole;
  userId: number;
  name: string;
}

/**
 * 迭代项（Backlog）：迭代的组成单元，只从需求转入。
 * - 记录原始需求 ID（projects.id，应用层软引用，不建物理外键）；
 * - 负责人在转入时敲定（AI 或真人机器人），机器人负责人自动创建交付任务；
 * - 状态由成员/管理员手动流转：等待 → 执行 → 测试 → 发布 → 完成，允许取消；
 * - 创建时自动建立飞书沟通群（绑定见 feishu_bot_backlog_chats）。
 */
@Entity('backlogs')
@Index('IDX_backlogs_iterationId', ['iterationId'])
@Index('IDX_backlogs_projectId', ['projectId'])
@Index('IDX_backlogs_status', ['status'])
@Index('IDX_backlogs_ownerWorkerId', ['ownerWorkerId'])
export class Backlog {
  @PrimaryGeneratedColumn()
  id: number;

  /** 编号（BL-0001，按 id 生成，唯一） */
  @Column({ length: 30, unique: true })
  code: string;

  /** 所属迭代（iterations.id，应用层引用） */
  @Column({ type: 'int' })
  iterationId: number;

  /** 原始需求（projects.id，应用层引用） */
  @Column({ type: 'int' })
  projectId: number;

  /** 需求标题快照（转入时的 projects.name） */
  @Column({ length: 200 })
  title: string;

  @Column({
    type: 'enum',
    enum: BacklogStatus,
    default: BacklogStatus.WAITING,
  })
  status: BacklogStatus;

  /** 负责人机器人（workers.id，AI 或真人，转入时指定） */
  @Column({ type: 'int', nullable: true })
  ownerWorkerId: number | null;

  /** 负责人姓名快照 */
  @Column({ type: 'varchar', length: 100, nullable: true })
  ownerName: string | null;

  /** 成员：产品/业务/项目/技术（前端/后端/测试/客户端） */
  @Column({ type: 'simple-json', nullable: true })
  members: BacklogMember[] | null;

  /** 自动创建的交付任务（tasks.id，应用层引用） */
  @Column({ type: 'int', nullable: true })
  taskId: number | null;

  /** 最近一次状态变更操作人快照 */
  @Column({ type: 'varchar', length: 100, nullable: true })
  statusBy: string | null;

  /** 各阶段进入时间（手动流转时记录；回退时清空对应后续阶段时间） */
  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  testingAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  releasingAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  canceledAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
