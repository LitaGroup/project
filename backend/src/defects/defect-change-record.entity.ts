import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 缺陷变更记录来源：
 * 录入=前端表单 / AI=.md 接口 / 自动=脚本回归通过自动流转
 */
export const DEFECT_RECORD_SOURCES = ['录入', 'AI', '自动'] as const;

/**
 * 缺陷变更记录（append-only，不可编辑删除）。
 * 缺陷与项目删除时应用层级联清理（测试库无物理外键）。
 */
@Entity('defect_change_records')
@Index(['defectId', 'createdAt'])
export class DefectChangeRecord {
  @PrimaryGeneratedColumn()
  id: number;

  /** 关联缺陷 ID（应用层引用，无物理外键） */
  @Column()
  defectId: number;

  /** 冗余项目 ID（按项目级联清理用） */
  @Column()
  projectId: number;

  /** 变更内容（本次改了什么） */
  @Column({ type: 'text' })
  content: string;

  /** 备注信息 */
  @Column({ type: 'text', nullable: true })
  remark: string | null;

  /** 记录时缺陷状态（变更后的状态） */
  @Column({ length: 100 })
  status: string;

  /** 记录来源：录入/AI/自动/飞书 */
  @Column({ type: 'varchar', length: 20, default: '录入' })
  source: string;

  /** 操作人姓名：agent 令牌对应用户 / 网页登录用户；系统自动流转为空 */
  @Column({ type: 'varchar', length: 100, nullable: true })
  operator: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
