import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * MCP 机器人调用审计：外部 AI Agent 每次 bot_call / bot_answer 终态后落一条。
 * 按用户维度记录（复用个人 agent 访问令牌鉴权，userId=0 为公共 Agent），
 * 管理区「MCP 调用」列表页展示。
 */
@Entity('mcp_call_logs')
@Index('IDX_mcp_call_logs_userId', ['userId'])
@Index('IDX_mcp_call_logs_workerId', ['workerId'])
@Index('IDX_mcp_call_logs_createdAt', ['createdAt'])
export class McpCallLog {
  @PrimaryGeneratedColumn()
  id: number;

  /** 调用方用户 ID（公共 Agent 为 0；未绑定真人的机器人调用为 -workerId） */
  @Column({ type: 'int' })
  userId: number;

  /** 调用方姓名快照 */
  @Column({ type: 'varchar', length: 120 })
  userName: string;

  /** 被调用机器人 ID */
  @Column({ type: 'int' })
  workerId: number;

  /** 被调用机器人名称快照 */
  @Column({ type: 'varchar', length: 120 })
  workerName: string;

  /** 平台会话标识（worker_debug_sessions.contextKey = mcp:{sessionId}） */
  @Column({ type: 'varchar', length: 80 })
  sessionId: string;

  /** 工具名：bot_call / bot_answer */
  @Column({ type: 'varchar', length: 40 })
  tool: string;

  /** 终态：complete / question / error / interrupted / conflict */
  @Column({ type: 'varchar', length: 20 })
  status: string;

  /** 本轮耗时（毫秒） */
  @Column({ type: 'int', default: 0 })
  durationMs: number;

  /** 调用方消息长度 */
  @Column({ type: 'int', default: 0 })
  messageLength: number;

  /** 机器人回复长度（失败为空） */
  @Column({ type: 'int', nullable: true })
  contentLength: number | null;

  /** 失败/中断原因 */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
