import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 工单交付文档形态：链接引用 / 独立 Markdown 正文 */
export type TicketDocumentFormat = 'link' | 'content';

/**
 * 工单交付文档：任务执行机器人显式把任务文档交付到工单。
 * 链接形态保存引用，正文形态保存独立副本；不与任务文档自动同步。
 */
@Entity('ticket_documents')
@Index('IDX_ticket_documents_ticketId', ['ticketId'])
@Index('IDX_ticket_documents_sourceTaskId', ['sourceTaskId'])
@Check(
  'CHK_ticket_documents_format',
  `("format" = 'link' AND "url" IS NOT NULL AND "content" IS NULL) OR ("format" = 'content' AND "content" IS NOT NULL AND "url" IS NULL)`,
)
export class TicketDocument {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  ticketId: number;

  /** 交付该文档的任务（tickets.taskId 或 ticket_workflow_runs.taskId） */
  @Column({ type: 'int' })
  sourceTaskId: number;

  /** 来源任务编号快照，任务删除后仍可追溯 */
  @Column({ type: 'varchar', length: 50 })
  sourceTaskCode: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 10 })
  format: TicketDocumentFormat;

  /** 链接形态：完整 http(s) 地址或站内绝对路径 */
  @Column({ type: 'text', nullable: true })
  url: string | null;

  /** 正文形态：独立保存的 Markdown 正文 */
  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'int' })
  createdByWorkerId: number;

  @Column({ type: 'varchar', length: 100 })
  createdByName: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  updatedByName: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
