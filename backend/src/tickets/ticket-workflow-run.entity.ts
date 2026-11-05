import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 工单工作流节点运行记录：一个节点在一次工单中可因驳回/失败多次进入。
 * taskId 指向任务中心节点任务；起始/验收节点没有任务。
 */
@Entity('ticket_workflow_runs')
@Index(['ticketId', 'nodeKey', 'attempt'], { unique: true })
@Index(['ticketId'])
@Index(['taskId'])
export class TicketWorkflowRun {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  ticketId: number;

  /** 节点 key（版本内稳定） */
  @Column({ type: 'varchar', length: 64 })
  nodeKey: string;

  /** 节点名称快照 */
  @Column({ type: 'varchar', length: 100 })
  nodeName: string;

  /** 节点类型：start/operation/approval/acceptance */
  @Column({ type: 'varchar', length: 20 })
  nodeKind: string;

  /** 第几次进入该节点（从 1 开始） */
  @Column({ type: 'int', default: 1 })
  attempt: number;

  /** 节点任务定义快照 */
  @Column({ type: 'int', nullable: true })
  taskTemplateId: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  taskTemplateName: string | null;

  /** 节点处理机器人快照（审批固定负责；操作按任务定义自动分配） */
  @Column({ type: 'int', nullable: true })
  agentId: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  agentName: string | null;

  /** 节点任务（tasks.id；起始/验收为空） */
  @Column({ type: 'int', nullable: true })
  taskId: number | null;

  /** 节点运行状态：等待中/执行中/待验收/已完成/已失败/已取消/待人工验收 */
  @Column({ type: 'varchar', length: 20 })
  status: string;

  /** 进入下一节点使用的流转结果 */
  @Column({ type: 'varchar', length: 20, nullable: true })
  outcome: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
