import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 反馈跟帖（append-only）：「系统-反馈处理」机器人从飞书反馈群话题自动收录的后续消息。
 * 一个话题一条反馈，话题内除首帖外的所有成员消息各写一条跟帖；
 * (feedbackId, sourceMessageId) 唯一，重复消息事件直接忽略去重。
 * 图片为 `/images/...` 路径数组（飞书图片转存平台后回填）。
 */
@Entity('feedback_replies')
@Index('IDX_feedback_replies_feedback', ['feedbackId', 'id'])
@Index(
  'UQ_feedback_replies_feedback_message',
  ['feedbackId', 'sourceMessageId'],
  {
    unique: true,
  },
)
export class FeedbackReply {
  @PrimaryGeneratedColumn()
  id: number;

  /** 所属反馈（feedbacks.id，应用层维护，无物理外键） */
  @Column({ type: 'int' })
  feedbackId: number;

  /** 发送者展示名（解析出平台用户用平台姓名，否则用飞书昵称快照） */
  @Column({ type: 'varchar', length: 120, nullable: true })
  senderName: string | null;

  /** 解析出的平台用户（未识别为空） */
  @Column({ type: 'int', nullable: true })
  senderUserId: number | null;

  /** 发送者飞书 open_id */
  @Column({ type: 'varchar', length: 100, nullable: true })
  senderOpenId: string | null;

  /** 跟帖正文（Markdown，文本消息原样，非文本给占位） */
  @Column({ type: 'text' })
  content: string;

  /** 图片：/images/... 路径数组（飞书图片转存后回填，最多 9 张） */
  @Column({ type: 'json', nullable: true })
  images: string[] | null;

  /** 飞书消息 id（去重键） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  sourceMessageId: string | null;

  /** 飞书话题 id（所属反馈的来源话题） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  sourceThreadId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
