import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DocumentSource, DocumentType } from '../common/enums';
import { Project } from '../projects/project.entity';

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'enum', enum: DocumentType })
  type: DocumentType;

  @Column({ type: 'enum', enum: DocumentSource })
  source: DocumentSource;

  /** 文档描述（导入/创建时由用户填写，可空） */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Markdown 正文；飞书导入的内容也统一存为 Markdown */
  @Column({ type: 'longtext', nullable: true })
  content: string | null;

  /** 用户备注（为后续 AI 阅读准备），任何来源的文档都可编辑 */
  @Column({ type: 'text', nullable: true })
  remark: string | null;

  /** 来源为飞书时记录原始链接，便于再次同步 */
  @Column({ type: 'varchar', length: 500, nullable: true })
  feishuUrl: string | null;

  /** 飞书同步判重 key：docx:<id> / sheets:<token>#<sheetId> / bitable:<token>#<tableId> */
  @Column({ type: 'varchar', length: 200, nullable: true })
  feishuToken: string | null;

  // 测试库账号无 REFERENCES 权限，暂不建物理外键；获得授权后可移除该选项
  @ManyToOne(() => Project, (project) => project.documents, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column()
  projectId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
