import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { OpencodeTodo } from '../executors/opencode-todos';
import type { WorkerDebugMessage } from './worker-debug.types';

/**
 * 机器人调试会话绑定：每个「登录用户 × 机器人」固定一个 opencode 会话。
 * 平台自己存一份消息/待办，重进页面直接展示；opencode 侧只追加新消息。
 * updatedAt 超过 7 天视为过期，清理时删除并下次新建会话。
 */
@Entity('worker_debug_sessions')
@Index(['userId', 'workerId'], { unique: true })
@Index(['workerId'])
@Index(['updatedAt'])
export class WorkerDebugSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  userId: number;

  @Column({ type: 'int' })
  workerId: number;

  /** 建会话时绑定的执行器/供应商/模型（配置变更后须重置会话） */
  @Column({ type: 'int', nullable: true })
  executorId: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  providerId: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  modelId: string | null;

  /** opencode 会话 id（首条消息创建后写入） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  sessionId: string | null;

  @Column({ type: 'simple-json', default: '[]' })
  messages: WorkerDebugMessage[];

  @Column({ type: 'simple-json', default: '[]' })
  todos: OpencodeTodo[];

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
