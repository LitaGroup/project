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
import { CodeBranchCategory } from '../common/enums';
import { Project } from '../projects/project.entity';

/**
 * 项目代码分支：项目涉及修改的 GitHub 仓库与分支登记（一条 = 一个仓库的一个分支归属某一端）。
 * 监听服务按全平台去重后的 (repo, branch) 轮询新提交，落 code_events。
 */
@Entity('project_branches')
@Index('IDX_project_branches_unique', ['projectId', 'repo', 'branch'], {
  unique: true,
})
export class ProjectBranch {
  @PrimaryGeneratedColumn()
  id: number;

  /** 仓库全名（owner/name，如 LitaGroup/lita-android） */
  @Column({ type: 'varchar', length: 200 })
  repo: string;

  /** 分支名（通常为 test/main/stable 等被监听的分支） */
  @Column({ type: 'varchar', length: 200 })
  branch: string;

  /** 归类：后端/H5/安卓/IOS/其它 */
  @Column({
    type: 'enum',
    enum: CodeBranchCategory,
    default: CodeBranchCategory.OTHER,
  })
  category: CodeBranchCategory;

  /** 备注 */
  @Column({ type: 'text', nullable: true })
  remark: string | null;

  // 测试库账号无 REFERENCES 权限，暂不建物理外键；获得授权后可移除该选项
  @ManyToOne(() => Project, (project) => project.projectBranches, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column()
  projectId: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
