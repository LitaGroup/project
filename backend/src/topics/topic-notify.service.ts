import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import { TopicAuthorType } from '../common/enums';
import { FeishuService } from '../feishu/feishu.service';
import { FeishuBotBacklogChat } from '../feishu-bot/feishu-bot-backlog-chat.entity';
import { FeishuBotClientService } from '../feishu-bot/feishu-bot-client.service';
import { FeishuBotConfigService } from '../feishu-bot/feishu-bot-config.service';
import { markdownCard } from '../feishu-bot/feishu-bot-message.service';
import { FeishuBotProjectChat } from '../feishu-bot/feishu-bot-project-chat.entity';
import { FeishuBotTaskChat } from '../feishu-bot/feishu-bot-task-chat.entity';
import { Worker } from '../workers/worker.entity';
import type { TopicMention } from './topic.entity';
import { TopicNotification } from './topic-notification.entity';
import type { TopicSubjectInfo, TopicView } from './topics.types';

/** 卡片正文截断，避免飞书卡片过长 */
const EXCERPT_LIMIT = 1200;

function excerpt(content: string): string {
  const text = content.trim();
  if (!text) return '（空消息）';
  return text.length > EXCERPT_LIMIT
    ? `${text.slice(0, EXCERPT_LIMIT)}…`
    : text;
}

/**
 * 话题通知：
 * - 主体有群 → 每条主帖/回复发群卡片（单向平台 → 飞书）；
 * - @机器人 → 个人站内通知 + 飞书私聊（机器人负责人）；
 * - 问答待回答 → 需求方个人通知。
 */
@Injectable()
export class TopicNotifyService {
  private readonly logger = new Logger(TopicNotifyService.name);
  private readonly appUrl: string;

  constructor(
    private readonly configs: FeishuBotConfigService,
    private readonly client: FeishuBotClientService,
    private readonly feishu: FeishuService,
    @InjectRepository(FeishuBotBacklogChat)
    private readonly backlogChats: Repository<FeishuBotBacklogChat>,
    @InjectRepository(FeishuBotTaskChat)
    private readonly taskChats: Repository<FeishuBotTaskChat>,
    @InjectRepository(FeishuBotProjectChat)
    private readonly projectChats: Repository<FeishuBotProjectChat>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(TopicNotification)
    private readonly notifications: Repository<TopicNotification>,
    config: ConfigService,
  ) {
    this.appUrl = (
      config.get<string>('APP_URL') ?? 'http://work-test.agent.cinta.team'
    ).replace(/\/+$/, '');
  }

  /** 主体有群时发群卡片；没有群或飞书未配置则静默跳过 */
  async notifyGroup(
    subject: TopicSubjectInfo,
    topic: TopicView,
    content: string,
    authorName: string,
  ): Promise<void> {
    if (!subject.group) return;
    try {
      const chatId = await this.resolveChatId(subject);
      if (!chatId) return;
      const config = await this.configs.loadEnabledOfficial();
      if (!config) return;
      const secrets = this.configs.secretsOf(config);
      const link = `${this.appUrl}${subject.url}?topic=${topic.id}`;
      const body = [
        `**${authorName}** 在「${topic.title?.trim() || '主话题'}」发布：`,
        '',
        excerpt(content),
        '',
        `[查看话题](${link})`,
      ].join('\n');
      await this.client.sendCard(
        config.id,
        secrets,
        'chat_id',
        chatId,
        markdownCard(body, subject.title),
      );
    } catch (error) {
      this.logger.warn(
        `话题群通知失败（${subject.type}:${subject.id}）: ${(error as Error).message}`,
      );
    }
  }

  /** @机器人：给机器人负责人发站内通知 + 飞书私聊 */
  async notifyMentions(
    topic: TopicView,
    mentions: TopicMention[] | null,
    content: string,
    authorName: string,
    replyId: number | null,
  ): Promise<number[]> {
    if (!mentions?.length) return [];
    const notifiedWorkerIds: number[] = [];
    for (const mention of mentions) {
      const worker = await this.workers.findOne({
        where: { id: mention.id },
        select: {
          id: true,
          name: true,
          humanUserId: true,
          ownerUserId: true,
          personalAgentUserId: true,
        },
      });
      if (!worker) continue;
      const userId =
        worker.humanUserId ??
        worker.ownerUserId ??
        worker.personalAgentUserId ??
        null;
      if (!userId) continue;
      await this.notifyUser(
        userId,
        'mention',
        topic,
        replyId,
        `${authorName} 在「${topic.title?.trim() || '主话题'}」@了 ${worker.name}`,
        excerpt(content),
      );
      notifiedWorkerIds.push(worker.id);
    }
    return notifiedWorkerIds;
  }

  /** 回复通知话题作者（有明确用户时） */
  async notifyTopicAuthor(
    topic: TopicView,
    content: string,
    authorName: string,
    replyId: number,
  ): Promise<void> {
    if (topic.author.type !== TopicAuthorType.USER || !topic.author.id) return;
    if (topic.author.name === authorName) return;
    await this.notifyUser(
      topic.author.id,
      'reply',
      topic,
      replyId,
      `${authorName} 回复了「${topic.title?.trim() || '主话题'}」`,
      excerpt(content),
    );
  }

  /** 问答待回答：通知需求方用户 */
  async notifyQuestion(
    topic: TopicView,
    userId: number | null,
    title: string,
    content: string,
  ): Promise<void> {
    if (!userId) return;
    await this.notifyUser(userId, 'question', topic, null, title, content);
  }

  private async notifyUser(
    userId: number,
    type: string,
    topic: TopicView,
    replyId: number | null,
    title: string,
    content: string | null,
  ): Promise<void> {
    await this.notifications
      .save(
        this.notifications.create({
          userId,
          type,
          topicId: topic.id,
          replyId,
          title: title.slice(0, 200),
          content,
        }),
      )
      .catch((error: Error) => {
        this.logger.warn(`话题站内通知写入失败: ${error.message}`);
      });
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, feishuOpenId: true },
    });
    if (!user?.feishuOpenId) return;
    try {
      const link = `${this.appUrl}${topic.subjectUrl}?topic=${topic.id}`;
      const card = markdownCard(
        [content?.trim() || title, '', `[打开话题](${link})`].join('\n'),
        title,
      );
      await this.feishu.sendUserCard(user.feishuOpenId, card);
    } catch (error) {
      this.logger.warn(
        `话题飞书私聊通知失败（user=${userId}）: ${(error as Error).message}`,
      );
    }
  }

  private async resolveChatId(
    subject: TopicSubjectInfo,
  ): Promise<string | null> {
    const group = subject.group;
    if (!group) return null;
    if (group.kind === 'backlog') {
      const row = await this.backlogChats.findOne({
        where: { backlogId: group.id, state: 'active' },
        select: { chatId: true },
      });
      return row?.chatId ?? null;
    }
    if (group.kind === 'task') {
      const row = await this.taskChats.findOne({
        where: { taskId: group.id, state: 'active' },
        select: { chatId: true },
      });
      return row?.chatId ?? null;
    }
    const row = await this.projectChats.findOne({
      where: { projectId: group.id, state: 'active' },
      select: { chatId: true },
    });
    return row?.chatId ?? null;
  }
}
