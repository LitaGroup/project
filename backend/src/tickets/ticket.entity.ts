import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 工单处理方类型（当前由绑定机器人自动担任，保留 user 以兼容历史数据） */
export type TicketAssigneeType = 'user' | 'worker';

/**
 * 工单：独立于任务的业务受理记录，一对一关联一个调度任务。
 * 状态不落库，按关联任务的主/子状态实时推导，避免双状态漂移。
 */
@Entity('tickets')
@Index(['category'])
@Index('IDX_tickets_taskId', ['taskId'], { unique: true })
@Index('IDX_tickets_backlogId', ['backlogId'])
export class Ticket {
  @PrimaryGeneratedColumn()
  id: number;

  /** 工单编号（WO-0001，按 id 生成） */
  @Column({ length: 30, unique: true })
  code: string;

  /** 工单类型：方案工单 / 技术工单 / 数据工单 / 运维工单 / 需求工单 / BUG反馈 */
  @Column({ type: 'varchar', length: 64 })
  category: string;

  @Column({ length: 200 })
  title: string;

  /** 工单原始描述（Markdown），同时作为任务初始描述 */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 创建人（需求方）快照；AI 机器人发起时为空 */
  @Column({ type: 'int', nullable: true })
  createdById: number | null;

  @Column({ type: 'varchar', length: 100 })
  createdByName: string;

  /** 处理方：由工单绑定的默认调度任务定义自动取首个启用机器人（固定 worker） */
  @Column({ type: 'varchar', length: 20 })
  assigneeType: TicketAssigneeType;

  @Column({ type: 'int' })
  assigneeId: number;

  @Column({ type: 'varchar', length: 100 })
  assigneeName: string;

  /** 关联调度任务（tasks.id，旧模型一对一；工作流工单为空） */
  @Column({ type: 'int', nullable: true })
  taskId: number | null;

  /** 关联迭代项（backlogs.id，可空；迭代项提测等入口创建时写入） */
  @Column({ type: 'int', nullable: true })
  backlogId: number | null;

  /** 工单工作流配置（workflow_definitions.id；旧工单为空） */
  @Column({ type: 'int', nullable: true })
  workflowDefinitionId: number | null;

  /** 创建时锁定的发布版本（workflow_definition_versions.id） */
  @Column({ type: 'int', nullable: true })
  workflowVersionId: number | null;

  /** 创建时锁定的发布版本号 */
  @Column({ type: 'int', nullable: true })
  workflowVersion: number | null;

  /** 发起机器人（workers.id，通常是用户绑定的真人机器人） */
  @Column({ type: 'int', nullable: true })
  initiatorWorkerId: number | null;

  /** 发起机器人名称快照 */
  @Column({ type: 'varchar', length: 100, nullable: true })
  initiatorWorkerName: string | null;

  /** 起始节点结构化输入 */
  @Column({ type: 'simple-json', nullable: true })
  inputValues: Record<string, unknown> | null;

  /** 工作流状态：处理中 / 待验收 / 已完成 / 已失败 / 已取消 */
  @Column({ type: 'varchar', length: 20, nullable: true })
  workflowStatus: string | null;

  /** 当前节点 key */
  @Column({ type: 'varchar', length: 64, nullable: true })
  currentNodeKey: string | null;

  /** 当前节点名称快照 */
  @Column({ type: 'varchar', length: 100, nullable: true })
  currentNodeName: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
