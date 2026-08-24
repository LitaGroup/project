import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity';

@Entity('defects')
@Index(['projectId', 'feishuRecordId'], { unique: true })
export class Defect {
  @PrimaryGeneratedColumn()
  id: number;

  /** 问题描述（飞书"问题描述"字段，长文本截断至 500） */
  @Column({ length: 500 })
  title: string;

  /** 问题描述全文（多行/超长时保留完整内容，与 title 相同则为 null） */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 端（飞书单选原文：前端/后端/产品/IOS/Android…） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  platform: string | null;

  /**
   * 状态：open/reopen/fixed/closed/invalid（见 common/enums.ts DefectStatus）。
   * 同步时由飞书状态映射（new→open、close→closed，乱填的选项→open），
   * 平台内手动修改只允许枚举值。
   */
  @Column({ length: 100, default: 'open' })
  status: string;

  /** 人员（飞书人员字段，同步姓名，只随同步更新） */
  @Column({ type: 'varchar', length: 200, nullable: true })
  assignee: string | null;

  /** 备注（飞书备注字段） */
  @Column({ type: 'text', nullable: true })
  remark: string | null;

  /** 截图：相对 imageWebroot 的路径数组（同步时把飞书 截图/截图2/截图3 附件下载到本地） */
  @Column({ type: 'json', nullable: true })
  images: string[] | null;

  /**
   * 测试脚本：相对脚本根目录的 .test.ts 路径，可空。
   * 非空时须该脚本最近一次运行通过才允许把状态改为 fixed；为空时允许手动改 fixed。
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  testScript: string | null;

  /** 飞书多维表格 record_id，双向同步判重/回写用 */
  @Column({ type: 'varchar', length: 50, nullable: true })
  feishuRecordId: string | null;

  // 测试库账号无 REFERENCES 权限，暂不建物理外键；获得授权后可移除该选项
  @ManyToOne(() => Project, (project) => project.defects, {
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
