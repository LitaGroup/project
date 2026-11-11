import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IdeaStatus, IdeaType } from '../common/enums';

/**
 * 灵感：业务分区「灵感」收集想法/创意/待办/建议。
 * 正文为 Markdown，图片为 `/images/...` 路径数组（POST /api/images 上传后回填）。
 * 构思期任何登录用户可编辑（协作完善）；采纳/废弃后仅管理员可改，状态流转仅管理员。
 * 采纳时在需求池新建或关联项目，`projectId` 为应用层软引用（不建物理外键）。
 */
@Entity('ideas')
export class Idea {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 200 })
  title: string;

  /** 类型：想法（默认）/ 创意 / 待办 / 建议 / 其它（见 common/enums.ts IdeaType） */
  @Column({
    type: 'enum',
    enum: IdeaType,
    default: IdeaType.IDEA,
  })
  type: IdeaType;

  /** 状态：构思（默认）/ 废弃 / 采纳（见 common/enums.ts IdeaStatus） */
  @Column({
    type: 'enum',
    enum: IdeaStatus,
    default: IdeaStatus.DRAFT,
  })
  status: IdeaStatus;

  /** 正文（Markdown，允许为空：快速捕捉一句话灵感） */
  @Column({ type: 'text', default: '' })
  content: string;

  /** 图片：`/images/...` 路径数组（上传接口返回的 url，最多 9 张） */
  @Column({ type: 'json', nullable: true })
  images: string[] | null;

  /** 创建人（users.id；机器人创建且未绑定真人时为空） */
  @Index('IDX_ideas_creatorId')
  @Column({ type: 'int', nullable: true })
  creatorId: number | null;

  /** 创建人姓名快照（机器人创建时为机器人名称） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  creatorName: string | null;

  /** 采纳后进入需求池的需求（projects.id 应用层软引用；退回构思时保留作历史关联） */
  @Index('IDX_ideas_projectId')
  @Column({ type: 'int', nullable: true })
  projectId: number | null;

  /** 采纳时间：置「采纳」时记录，退回构思/废弃时清空 */
  @Column({ type: 'timestamptz', nullable: true })
  adoptedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
