import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 机器人在群里的答复策略：
 * - smart：监听全部消息，由 AI 判断是否需要回复；
 * - at：仅被 @ 后回复（敲键盘 + 处理）；
 * - record：仅记录，不回复；
 * - feedback：反馈采集（仅「系统-反馈处理」机器人可用）——话题消息由平台自动收录为反馈/跟帖，
 *   收录后交给机器人判断分发；非话题消息仅记录。
 */
export type FeishuBotGroupPolicy = 'smart' | 'at' | 'record' | 'feedback';

/** 策略取值（保存时校验白名单） */
export const FEISHU_BOT_GROUP_POLICIES: readonly FeishuBotGroupPolicy[] = [
  'smart',
  'at',
  'record',
  'feedback',
];

/** 反馈采集策略（只允许「系统-反馈处理」机器人的群启用，且仅能经收录群批量端点设置） */
export const FEISHU_BOT_FEEDBACK_GROUP_POLICY: FeishuBotGroupPolicy =
  'feedback';

/** 未单独配置策略时的默认值：仅被 @ 后回复 */
export const FEISHU_BOT_DEFAULT_GROUP_POLICY: FeishuBotGroupPolicy = 'at';

/** 判断任意值是否为合法策略 */
export function isFeishuBotGroupPolicy(
  value: unknown,
): value is FeishuBotGroupPolicy {
  return (
    typeof value === 'string' &&
    (FEISHU_BOT_GROUP_POLICIES as readonly string[]).includes(value)
  );
}

/**
 * 机器人绑定的飞书应用被拉入的外部群（不含平台自建的任务群/项目沟通群）。
 * 单群可覆盖默认策略；被移出后保留记录与策略，再次拉入自动恢复。
 */
@Entity('feishu_bot_groups')
@Index('UQ_feishu_bot_groups_config_chat', ['configId', 'chatId'], {
  unique: true,
})
@Index('IDX_feishu_bot_groups_configId', ['configId'])
@Index('IDX_feishu_bot_groups_chatId', ['chatId'])
export class FeishuBotGroup {
  @PrimaryGeneratedColumn()
  id: number;

  /** 所属飞书应用配置（feishu_bot_configs.id，kind=worker） */
  @Column({ type: 'int' })
  configId: number;

  /** 飞书群 chat_id */
  @Column({ type: 'varchar', length: 100 })
  chatId: string;

  /** 群名快照（被拉入时拉取；缺失时下次消息补拉） */
  @Column({ type: 'varchar', length: 200, nullable: true })
  name: string | null;

  /** 单群策略；null = 跟随机器人默认策略 */
  @Column({ type: 'varchar', length: 20, nullable: true })
  policy: FeishuBotGroupPolicy | null;

  /** 首次被拉入群时间 */
  @Column({ type: 'timestamptz' })
  joinedAt: Date;

  /** 最近一次被移出群时间；重新拉入时清空 */
  @Column({ type: 'timestamptz', nullable: true })
  leftAt: Date | null;

  /** 最近一条入站消息时间 */
  @Column({ type: 'timestamptz', nullable: true })
  lastMessageAt: Date | null;

  /** 入站消息累计条数 */
  @Column({ type: 'int', default: 0 })
  messageCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
