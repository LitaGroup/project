import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TaskStatus, TaskType } from '../common/enums';

/** 创建阶段缺失清单条目（调度器材料审查产出，补齐后清除） */
export interface TaskMissingItem {
  item: string;
  reason?: string;
}

/** 子任务物化时由调度方案带出的建议信息快照（记录用） */
export interface TaskPlanRef {
  planId: number;
  agentName?: string;
}

/**
 * 任务包：具体需要执行的任务内容（明确输入/输出/类型），可挂子任务形成工作流。
 * 无物理外键（测试库无 REFERENCES 权限）：agent/scheduler/executor 仅记 id；
 * 删除根任务时应用层级联删子任务、事件与方案。
 */
@Entity('tasks')
@Index(['rootId'])
@Index(['parentId'])
@Index(['status'])
export class Task {
  @PrimaryGeneratedColumn()
  id: number;

  /** 编号（TK-0001，按 id 生成，唯一） */
  @Column({ length: 30, unique: true })
  code: string;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'enum', enum: TaskType, default: TaskType.OTHER })
  type: TaskType;

  /** 父任务 id（顶层为 null） */
  @Column({ type: 'int', nullable: true })
  parentId: number | null;

  /** 根任务 id（工作流树顶；顶层为自身 id） */
  @Column({ type: 'int' })
  rootId: number;

  /** 同级排序（调度方案物化时按顺序写入） */
  @Column({ default: 0 })
  sortOrder: number;

  /** 任务描述（这类任务要做什么，Markdown） */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 任务输入（提供什么材料/上下文，Markdown） */
  @Column({ type: 'text', nullable: true })
  input: string | null;

  /** 明确输出（要交付什么，Markdown） */
  @Column({ type: 'text', nullable: true })
  outputSpec: string | null;

  /** 缺失材料清单（待补材料状态时非空） */
  @Column({ type: 'simple-json', nullable: true })
  missingItems: TaskMissingItem[] | null;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.DRAFT })
  status: TaskStatus;

  /** 分配的机器人（workers.id，可空=未分配） */
  @Column({ type: 'int', nullable: true })
  agentId: number | null;

  /** 使用的调度器（workers.id，可空=人工调度） */
  @Column({ type: 'int', nullable: true })
  schedulerId: number | null;

  /** 派发绑定的执行器（快照，会话定位用） */
  @Column({ type: 'int', nullable: true })
  executorId: number | null;

  /** opencode 会话 id（派发后绑定，实时事件路由 key） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  opencodeSessionId: string | null;

  /** 交付物/最终产出（会话完成后取最终回复；人工可改） */
  @Column({ type: 'text', nullable: true })
  result: string | null;

  /** 责任人验收（→ 内部完成） */
  @Column({ type: 'datetime', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  acceptedBy: string | null;

  /** 交付确认时间 */
  @Column({ type: 'datetime', nullable: true })
  deliveredAt: Date | null;

  /** 归档（维护中终态）时间 */
  @Column({ type: 'datetime', nullable: true })
  archivedAt: Date | null;

  /** 取消时间 */
  @Column({ type: 'datetime', nullable: true })
  canceledAt: Date | null;

  /** 创建人（users.id，可空） */
  @Column({ type: 'int', nullable: true })
  createdById: number | null;

  /** 调度方案来源标记（子任务由方案物化时写入） */
  @Column({ type: 'simple-json', nullable: true })
  planRef: TaskPlanRef | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
