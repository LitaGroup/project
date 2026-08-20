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

/** 检查：本质是一个脚本，这里登记其元信息（编号/描述/脚本位置） */
@Entity('checks')
@Index(['projectId', 'code'], { unique: true })
export class Check {
  @PrimaryGeneratedColumn()
  id: number;

  /** 编号（手工定义，项目内唯一） */
  @Column({ length: 100 })
  code: string;

  /** 描述：脚本检查的内容 */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 脚本位置：相对 CHECK_SCRIPTS_DIR 的路径，如 rank/daily.check.ts */
  @Column({ length: 500 })
  scriptPath: string;

  // 测试库账号无 REFERENCES 权限，暂不建物理外键（同 Document，见 AGENTS.md）
  @ManyToOne(() => Project, (project) => project.checks, {
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
