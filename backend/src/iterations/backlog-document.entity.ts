import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 迭代项文档关联：backlog ↔ documents（需求文档转入时一并搬过来，之后可自行增删关联）。
 * 无物理外键：删除文档/迭代项时由应用层清理关联。
 */
@Entity('backlog_documents')
@Index('IDX_backlog_documents_backlogId', ['backlogId'])
@Index('IDX_backlog_documents_documentId', ['documentId'])
@Index(['backlogId', 'documentId'], { unique: true })
export class BacklogDocument {
  @PrimaryGeneratedColumn()
  id: number;

  /** 迭代项（backlogs.id，应用层引用） */
  @Column({ type: 'int' })
  backlogId: number;

  /** 文档（documents.id，应用层引用；通常挂在该 backlog 的原始需求下） */
  @Column({ type: 'int' })
  documentId: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
