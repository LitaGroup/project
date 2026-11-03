import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { OpencodeTodo } from '../executors/opencode-todos';
import type { WorkerDebugMessage, WorkerDebugMode } from './worker-debug.types';

/**
 * 机器人调试 / 我的 AI / 顶部机器人聊天会话绑定：每个「登录用户 × 机器人 × 会话范围」
 * 固定一个 opencode 会话。contextKey 区分顶部机器人聊天（chat）、机器人调试（debug）、
 * 我的 AI 通用会话（agent:global）与每个任务独立会话（agent:task:{taskId}）。
 * 平台自己存一份消息/待办，重进页面直接展示；opencode 侧只追加新消息。
 * updatedAt 超过 7 天视为过期，清理时删除并下次新建会话。
 */
@Entity('worker_debug_sessions')
@Index(
  'IDX_worker_debug_sessions_scope',
  ['userId', 'workerId', 'contextKey'],
  {
    unique: true,
  },
)
@Index('IDX_worker_debug_sessions_workerId', ['workerId'])
@Index('IDX_worker_debug_sessions_updatedAt', ['updatedAt'])
export class WorkerDebugSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  userId: number;

  @Column({ type: 'int' })
  workerId: number;

  /** 会话范围：chat / debug / agent:global / agent:task:{taskId} */
  @Column({ type: 'varchar', length: 120, default: 'debug' })
  contextKey: string;

  /** opencode 主 Agent：build（默认）或 plan */
  @Column({ type: 'varchar', length: 20, default: 'build' })
  activeAgent: WorkerDebugMode;

  /** 建会话时绑定的执行器/供应商/模型（配置变更后须重置会话） */
  @Column({ type: 'int', nullable: true })
  executorId: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  providerId: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  modelId: string | null;

  /** 会话当前选择的供应商/模型/思考等级（为空回退机器人配置） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  activeProviderId: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  activeModelId: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  activeVariant: string | null;

  /** opencode 会话 id（首条消息创建后写入） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  sessionId: string | null;

  @Column({ type: 'simple-json', default: '[]' })
  messages: WorkerDebugMessage[];

  @Column({ type: 'simple-json', default: '[]' })
  todos: OpencodeTodo[];

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
