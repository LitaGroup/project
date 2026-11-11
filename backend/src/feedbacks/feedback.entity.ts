import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FeedbackSource, FeedbackStatus, FeedbackType } from '../common/enums';

/**
 * 用户反馈（BUG REPORT）：业务分区「反馈」收集全员上报的问题，独立于研发内部缺陷。
 * 图片为 `/images/...` 路径数组（POST /api/images 上传后回填）。
 * 状态流转仅管理员；提交人可在「待处理」时编辑与撤销（应用层校验，见 feedbacks.service）。
 * 来源为「飞书群」时由「系统-反馈处理」机器人按话题自动收录：一个话题一条反馈，
 * 后续成员消息写入 feedback_replies 跟帖；(sourceChatId, sourceThreadId) 部分唯一索引防重复建反馈。
 */
@Entity('feedbacks')
@Index('UQ_feedbacks_feishu_thread', ['sourceChatId', 'sourceThreadId'], {
  unique: true,
  where: `"source" = '${FeedbackSource.FEISHU_GROUP}' AND "sourceThreadId" IS NOT NULL`,
})
export class Feedback {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 200 })
  title: string;

  /** 反馈类型：BUG / 建议 / 其它（见 common/enums.ts FeedbackType），默认 BUG */
  @Column({
    type: 'enum',
    enum: FeedbackType,
    default: FeedbackType.BUG,
  })
  type: FeedbackType;

  /** 来源：平台（默认）/ 飞书群（反馈群话题自动收录） */
  @Column({
    type: 'enum',
    enum: FeedbackSource,
    default: FeedbackSource.PLATFORM,
  })
  source: FeedbackSource;

  /** 飞书来源群 chat_id（平台提交为空） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  sourceChatId: string | null;

  /** 飞书来源话题 thread_id（一个话题一条反馈；平台提交为空） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  sourceThreadId: string | null;

  /** 飞书来源首帖消息 id（回执定位用；平台提交为空） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  sourceMessageId: string | null;

  /** 状态：待处理（默认）/ 处理中 / 已解决 / 已关闭（见 common/enums.ts FeedbackStatus） */
  @Column({
    type: 'enum',
    enum: FeedbackStatus,
    default: FeedbackStatus.PENDING,
  })
  status: FeedbackStatus;

  /** 详情描述（Markdown） */
  @Column({ type: 'text' })
  content: string;

  /** 图片：`/images/...` 路径数组（上传接口返回的 url，最多 9 张） */
  @Column({ type: 'json', nullable: true })
  images: string[] | null;

  /** 提交人（users.id，可空兼容历史/系统提交） */
  @Index('IDX_feedbacks_reporterId')
  @Column({ type: 'int', nullable: true })
  reporterId: number | null;

  /** 提交人姓名快照（用户表变动不影响历史反馈展示） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  reporterName: string | null;

  /** 受理人（管理员处理时写入） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  handlerName: string | null;

  /** 处理备注（管理员流转时填写） */
  @Column({ type: 'text', nullable: true })
  handleNote: string | null;

  /** 解决时间：状态置「已解决」时记录 */
  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
