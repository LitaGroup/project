import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DispatchPlanStatus } from '../common/enums';
import { TaskMissingItem } from './task.entity';

/** 方案建议的子任务（管理员确认后物化为 Task） */
export interface PlanSubtask {
  title: string;
  /** 任务类型（TaskType 值） */
  type: string;
  input?: string;
  outputSpec?: string;
  /** 建议的机器人（workers.id） */
  agentId?: number | null;
  /** 建议机器人名（展示快照） */
  agentName?: string;
}

/** 调度方案内容（PI 调度器结构化输出） */
export interface DispatchPlanContent {
  /** 任务识别结果 */
  identification: {
    type?: string;
    input?: string;
    output?: string;
    summary?: string;
  };
  /** 材料缺失清单（有缺失时不拆解，任务转「待补材料」） */
  missingItems?: TaskMissingItem[];
  /** 拆解出的子任务（单一任务也用一条 subtask 表达分配建议） */
  subtasks?: PlanSubtask[];
}

/** AI 调度方案：调度器产出 → 管理员确认（物化子任务并派发）/ 驳回（打回重调度） */
@Entity('dispatch_plans')
@Index(['taskId'])
export class DispatchPlan {
  @PrimaryGeneratedColumn()
  id: number;

  /** 根任务 id */
  @Column()
  taskId: number;

  /** 产出方案的调度器（workers.id，可空=人工） */
  @Column({ type: 'int', nullable: true })
  schedulerId: number | null;

  @Column({ type: 'simple-json' })
  plan: DispatchPlanContent;

  @Column({
    type: 'enum',
    enum: DispatchPlanStatus,
    default: DispatchPlanStatus.PENDING,
  })
  status: DispatchPlanStatus;

  /** 确认/驳回人 */
  @Column({ type: 'varchar', length: 100, nullable: true })
  operator: string | null;

  @Column({ type: 'datetime', nullable: true })
  operatedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
