import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  TaskChatMessage,
  TaskChatQuestion,
  TaskChatSender,
  TaskChatTool,
} from './task-chat.types';

/**
 * 任务对话消息持久化：机器人思考/回复、提问卡片在此落库，
 * 内存中的实时流仅用于推送，页面刷新与服务重启后仍可恢复完整多轮记录。
 * 用户消息继续由任务反馈事件承载。
 */
@Entity('task_messages')
@Index(['taskId'])
@Index(['taskId', 'messageKey'], { unique: true })
export class TaskMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  taskId: number;

  /** 前端消息 id（与实时流一致，用于快照去重） */
  @Column({ type: 'varchar', length: 200 })
  messageKey: string;

  @Column({ type: 'varchar', length: 20 })
  role: TaskChatMessage['role'];

  @Column({ type: 'simple-json' })
  sender: TaskChatSender;

  @Column({ type: 'text' })
  content: string;

  /** 思考过程（opencode session.reasoning.*） */
  @Column({ type: 'text', nullable: true })
  reasoning: string | null;

  @Column({ type: 'varchar', length: 20 })
  status: TaskChatMessage['status'];

  @Column({ type: 'varchar', length: 20 })
  kind: TaskChatMessage['kind'];

  @Column({ type: 'simple-json', nullable: true })
  tools: TaskChatTool[] | null;

  @Column({ type: 'simple-json', nullable: true })
  question: TaskChatQuestion | null;

  @Column({ type: 'simple-json', nullable: true })
  meta: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
