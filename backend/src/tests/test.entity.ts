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

/** 测试：本质是一个脚本，这里登记其元信息（编号/描述/脚本位置），同检查但脚本后缀为 .test.ts */
@Entity('tests')
@Index(['projectId', 'code'], { unique: true })
export class Test {
  @PrimaryGeneratedColumn()
  id: number;

  /** 编号（手工定义，项目内唯一） */
  @Column({ length: 100 })
  code: string;

  /** 描述：脚本测试的内容 */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 脚本位置：相对 CHECK_SCRIPTS_DIR 的路径，如 rank/daily.test.ts */
  @Column({ length: 500 })
  scriptPath: string;

  /** 运行设备/目标：server/h5 本地直跑；android/ios 走 appium-agent 远程 */
  @Column({ type: 'varchar', length: 20, nullable: true })
  device: string | null;

  // 测试库账号无 REFERENCES 权限，暂不建物理外键（同 Check，见 AGENTS.md）
  @ManyToOne(() => Project, (project) => project.tests, {
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
