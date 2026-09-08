import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ResourceType } from '../common/enums';
import { Project } from '../projects/project.entity';

@Entity('resources')
export class Resource {
  @PrimaryGeneratedColumn()
  id: number;

  /** 资源类型：配置/多语言/文件资源/UI/其它（见 common/enums.ts ResourceType） */
  @Column({ type: 'enum', enum: ResourceType })
  type: ResourceType;

  /** 标题 */
  @Column({ length: 200 })
  title: string;

  /**
   * 状态：缺失/草稿/确认/废弃（见 common/enums.ts ResourceStatus）。
   * 与 Defect 一致用 varchar 存储，服务层校验枚举值；"废弃"为软删除终态。
   */
  @Column({ length: 100, default: '缺失' })
  status: string;

  /** 描述（其它类型的主要内容；配置类型为文档的补充说明） */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * 链接：配置类型=飞书文档 URL（可空——状态"缺失"表示尚未提供，后补时自动绑定/创建文档；
   * 清空则解除文档绑定）；文件资源=文件 URL（图片/视频等，仅存链接不上传）；UI=蓝湖地址（原样保存链接，不做处理）；其它=可选参考链接
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  url: string | null;

  /** 配置类型绑定的文档 ID（应用层引用，不建物理外键；删除资源不影响文档） */
  @Column({ type: 'int', nullable: true })
  documentId: number | null;

  /**
   * 多语言：命名空间前缀 `{SHEET}$NAMESPACE`（SHEET=Activity/Frontend/FE/Backend，
   * 省略时规范化为 Activity；NAMESPACE 以 $ 开头可省略），规范化后存储；
   * 为空表示需求方尚未提供（状态"缺失"），文案经 word/sheet 接口同步进 content
   */
  @Column({ type: 'varchar', length: 300, nullable: true })
  prefix: string | null;

  /** 多语言：同步缓存的文案 Markdown 表格（经 Lita word/sheet 接口拉取填充） */
  @Column({ type: 'longtext', nullable: true })
  content: string | null;

  /** 备注 */
  @Column({ type: 'text', nullable: true })
  remark: string | null;

  // 测试库账号无 REFERENCES 权限，暂不建物理外键；获得授权后可移除该选项
  @ManyToOne(() => Project, (project) => project.projectResources, {
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
