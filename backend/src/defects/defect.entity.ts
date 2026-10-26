import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity';

/**
 * 缺陷：仅保留核心属性（端/预期/实际/图片/用例脚本/状态）。
 * 图片为 `/images/...` 路径数组（POST /api/images 上传后回填）。
 */
@Entity('defects')
export class Defect {
  @PrimaryGeneratedColumn()
  id: number;

  /** 端：前端/后端/APP端/未知 */
  @Column({ type: 'varchar', length: 100, nullable: true })
  platform: string | null;

  /** 优先级：高/中/低（见 common/enums.ts DefectPriority），默认中 */
  @Column({ length: 100, default: '中' })
  priority: string;

  /** 预期功能描述 */
  @Column({ type: 'text' })
  expected: string;

  /** 实际结果描述 */
  @Column({ type: 'text' })
  actual: string;

  /** 图片：`/images/...` 路径数组（上传接口返回的 url，最多 9 张） */
  @Column({ type: 'json', nullable: true })
  images: string[] | null;

  /**
   * 状态：开放/修复/关闭（见 common/enums.ts DefectStatus）。
   * 平台内修改只允许枚举值。
   */
  @Column({ length: 100, default: '开放' })
  status: string;

  /** 用例脚本：相对脚本根目录的 .test.ts 路径，可空。
   *  配置后：脚本回归通过（success）时后端自动把"修复"态缺陷流转为"关闭"。 */
  @Column({ type: 'varchar', length: 500, nullable: true })
  testScript: string | null;

  /** 修复时间：状态置"修复"（研发已修复）时记录 */
  @Column({ type: 'timestamp', nullable: true })
  fixedAt: Date | null;

  /** 验证时间：脚本回归通过自动关闭、或人工确认关闭时记录 */
  @Column({ type: 'timestamp', nullable: true })
  verifiedAt: Date | null;

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
