import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { FindOptionsWhere, Repository } from 'typeorm';
import type { User } from '../auth/user.entity';
import { FeedbackSource, FeedbackStatus, FeedbackType } from '../common/enums';
import { imageWebroot } from '../common/paths';
import { FeedbackReply } from '../feedbacks/feedback-reply.entity';
import { Feedback } from '../feedbacks/feedback.entity';
import type { Task } from '../tasks/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { SYSTEM_FEEDBACK_TASK_TEMPLATE_ID } from '../tasks/system-task-templates';
import { Worker } from '../workers/worker.entity';
import { FeishuBotClientService } from './feishu-bot-client.service';
import type {
  FeishuBotConfig,
  FeishuBotSecrets,
} from './feishu-bot-config.entity';
import type { FeishuBotGroup } from './feishu-bot-group.entity';
import type { FeishuInboundMessage } from './feishu-bot-p2p.service';

/** 反馈图片上限（与 feedbacks 一致：单条最多 9 张） */
const MAX_IMAGES = 9;

/** 标题兜底（首帖无文字时） */
const FALLBACK_TITLE = '飞书群反馈';

/** 有文字首帖时标题的最大长度（超长截断加省略号） */
const TITLE_SOURCE_LIMIT = 80;

/** 非文本消息在反馈正文/跟帖中的占位 */
const MESSAGE_PLACEHOLDERS: Record<string, string> = {
  image: '[图片]',
  file: '[文件]',
  media: '[视频]',
  audio: '[语音]',
  sticker: '[表情]',
  interactive: '[卡片]',
  share_chat: '[群名片]',
  share_user: '[个人名片]',
};

/** 采集结果 */
export interface CollectedTopicFeedback {
  feedback: Feedback;
  /** 首帖：本轮新建了反馈（需要话题内回执链接、自动创建处理任务并唤起分发判断） */
  isNew: boolean;
  /** 该消息已收录过（事件重复），不要再次唤起 AI */
  duplicated: boolean;
}

/**
 * 话题归属归一：话题内的回复带 root_id（话题根消息 id，飞书话题群以它为准），
 * 首帖自身即话题根（root_id 为空时取消息 id）。thread_id 只在部分事件出现且可能变化，
 * 不能单独作为「一个话题一条反馈」的判重键。
 */
export function topicRootOf(message: FeishuInboundMessage): string {
  const rootId = message.rootId?.trim();
  return rootId || message.messageId;
}

/**
 * 「系统-反馈处理」话题采集：反馈采集群内一个飞书话题对应一条平台反馈。
 * - 首帖自动创建 feedbacks（来源=飞书群，记录 chat_id/thread_id/话题根消息 id），
 *   并英文回执平台反馈链接、自动创建「用户反馈处理」任务派给当前机器人；
 * - 后续成员消息追加 feedback_replies 跟帖（按消息 id 去重，重复事件不再唤起 AI）；
 * - 飞书话题内的回复（含 @ 机器人）以 root_id 指向话题根消息为准：thread_id
 *   可能缺失或不一致，单靠它会把同话题消息误建成新反馈（飞书话题群已知行为）；
 * - 飞书图片转存平台 /images 目录，与网页提交的图片同一存储；
 * - 采集由平台确定性完成，机器人只负责分发判断（PROMPT 定义规则）。
 */
@Injectable()
export class FeishuBotFeedbackService {
  private readonly logger = new Logger(FeishuBotFeedbackService.name);

  constructor(
    private readonly client: FeishuBotClientService,
    @InjectRepository(Feedback)
    private readonly feedbacks: Repository<Feedback>,
    @InjectRepository(FeedbackReply)
    private readonly replies: Repository<FeedbackReply>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly tasks: TasksService,
  ) {}

  /**
   * 收录一条话题消息：首帖建反馈；已有反馈则追加跟帖。
   * 并发首帖靠 (sourceChatId, sourceThreadId) 部分唯一索引兜底，冲突后重查按跟帖处理。
   */
  async collect(input: {
    config: FeishuBotConfig;
    secrets: FeishuBotSecrets;
    group: FeishuBotGroup;
    message: FeishuInboundMessage;
    threadId: string;
    user: User | null;
    senderOpenId: string | null;
    text: string;
  }): Promise<CollectedTopicFeedback> {
    const topicRoot = topicRootOf(input.message);
    this.logger.debug(
      `反馈群话题收录：chat=${input.group.chatId} thread=${input.threadId} ` +
        `root=${topicRoot} message=${input.message.messageId}`,
    );
    const existing = await this.findTopicFeedback(
      input.group.chatId,
      input.threadId,
      topicRoot,
    );
    if (!existing) {
      const created = await this.createFeedback(input, topicRoot);
      if (created) return { feedback: created, isNew: true, duplicated: false };
      // 唯一索引冲突（并发首帖）：重查按跟帖收录
      const concurrent = await this.findTopicFeedback(
        input.group.chatId,
        input.threadId,
        topicRoot,
      );
      if (!concurrent) throw new Error('反馈创建失败且重查不到来源话题记录');
      return this.appendReply(concurrent, input);
    }
    return this.appendReply(existing, input);
  }

  /** 收录时话题内回执文案：英文确认收到，并给出平台反馈详情链接 */
  receiptText(feedback: Feedback): string {
    return `Feedback received, verifying. Recorded at: ${this.client.appUrl}/feedback/${feedback.id}`;
  }

  /**
   * 新反馈收录后自动创建处理任务（任务定义 ID=8「用户反馈处理」）：
   * 执行方固定为当前采集机器人（config.workerId），需求方为该机器人的负责人
   * （有真人机器人时记为真人）。成功后把任务 id 回写 feedback.taskId。
   * 未配置负责人或创建失败只告警、不影响反馈收录（与缺陷自动派单同一策略）。
   */
  async createHandlingTask(
    feedback: Feedback,
    config: FeishuBotConfig,
  ): Promise<Task | null> {
    if (feedback.taskId || !config.workerId) return null;
    const worker = await this.workers.findOne({
      where: { id: config.workerId },
    });
    if (!worker) return null;
    const ownerUserId = worker.ownerUserId ?? 0;
    if (ownerUserId <= 0) {
      this.logger.warn(
        `反馈 #${feedback.id} 未自动创建处理任务：机器人「${worker.name}」#${worker.id} 未配置负责人`,
      );
      return null;
    }
    const human = await this.workers.findOne({
      where: { humanUserId: ownerUserId },
      select: { id: true, name: true },
    });
    const feedbackUrl = `${this.client.appUrl}/feedback/${feedback.id}`;
    const description = [
      '# 用户反馈处理',
      '',
      '本任务由平台收录飞书反馈群话题后自动创建。',
      '',
      '## 反馈信息',
      '',
      `- 反馈：[\`#${feedback.id}\`](${feedbackUrl})（Agent 视图：\`GET /api/feedbacks/${feedback.id}.md\`）`,
      `- 标题：${feedback.title}`,
      `- 类型：${feedback.type}`,
      `- 提交人：${feedback.reporterName ?? '群成员'}`,
      `- 来源：飞书群（群 ${feedback.sourceChatId ?? '-'} / 话题 ${feedback.sourceThreadId ?? '-'}）`,
      '',
      '## 反馈正文',
      '',
      feedback.content,
      '',
      '## 处理要求',
      '',
      `- 处理前先读 \`GET /api/feedbacks/${feedback.id}.md\` 获取最新正文与群内跟帖。`,
      '- 核实反馈是否属实、类型（BUG/建议/其它）与紧急程度，定位相关项目与系统。',
      '- 能处理的完成处理；不能直接处理的给出明确结论与转派建议。',
      '- 在任务 HANDOFF 中记录核实过程与处理结果，完成后申请需求方验收。',
    ].join('\n');
    try {
      const task = await this.tasks.create({
        title: `处理反馈 #${feedback.id}：${feedback.title}`.slice(0, 200),
        description,
        outputSpec:
          '完成该反馈的核实与处理，HANDOFF 给出可复核的结论（定位、处理结果或建议）；无法处理时说明原因。',
        templateId: SYSTEM_FEEDBACK_TASK_TEMPLATE_ID,
        agentId: worker.id,
        createdById: ownerUserId,
        requesterType: human ? 'worker' : 'user',
        requesterId: human?.id ?? ownerUserId,
        operatorName: '反馈收录',
      });
      await this.feedbacks.update({ id: feedback.id }, { taskId: task.id });
      this.logger.log(
        `反馈 #${feedback.id} 已自动创建处理任务 ${task.code}（执行：「${worker.name}」#${worker.id}）`,
      );
      return task;
    } catch (error) {
      this.logger.warn(
        `反馈 #${feedback.id} 自动创建处理任务失败：${(error as Error).message}`,
      );
      return null;
    }
  }

  // ==== 内部 ====

  /**
   * 话题判重：thread_id 与话题根消息 id（root_id 归一）任一命中即同一反馈；
   * 话题内 @ 机器人等 thread_id 缺失/变化的回复据此归并，不再新建反馈。
   */
  private findTopicFeedback(
    chatId: string,
    threadId: string,
    topicRoot: string,
  ): Promise<Feedback | null> {
    const where: FindOptionsWhere<Feedback>[] = [
      {
        source: FeedbackSource.FEISHU_GROUP,
        sourceChatId: chatId,
        sourceThreadId: threadId,
      },
      {
        source: FeedbackSource.FEISHU_GROUP,
        sourceChatId: chatId,
        sourceMessageId: topicRoot,
      },
    ];
    return this.feedbacks.findOne({ where });
  }

  /** 首帖创建反馈；返回 null 表示唯一索引冲突（并发首帖） */
  private async createFeedback(
    input: {
      config: FeishuBotConfig;
      secrets: FeishuBotSecrets;
      group: FeishuBotGroup;
      message: FeishuInboundMessage;
      threadId: string;
      user: User | null;
      senderOpenId: string | null;
      text: string;
    },
    topicRoot: string,
  ): Promise<Feedback | null> {
    const images = await this.transferImages(
      input.config,
      input.secrets,
      input.message,
    ).catch((error: Error) => {
      this.logger.warn(
        `反馈群图片转存失败（message=${input.message.messageId}）: ${error.message}`,
      );
      return [] as string[];
    });
    const feedback = this.feedbacks.create({
      title: deriveTitle(input.text, input.message.messageType),
      type: FeedbackType.BUG,
      status: FeedbackStatus.PENDING,
      source: FeedbackSource.FEISHU_GROUP,
      sourceChatId: input.group.chatId,
      sourceThreadId: input.threadId,
      sourceMessageId: topicRoot,
      content: input.text.trim() || placeholderOf(input.message.messageType),
      images: images.length ? images.slice(0, MAX_IMAGES) : null,
      reporterId: input.user?.id ?? null,
      reporterName: input.user?.name ?? '群成员',
    });
    try {
      return await this.feedbacks.save(feedback);
    } catch (error) {
      // (sourceChatId, sourceThreadId) 部分唯一索引冲突：并发首帖，交由上层重查按跟帖收录
      if ((error as Error).message?.includes('UQ_feedbacks_feishu_thread')) {
        return null;
      }
      throw error;
    }
  }

  /** 已有反馈：追加跟帖（消息 id 去重），并推进 updatedAt */
  private async appendReply(
    feedback: Feedback,
    input: {
      config: FeishuBotConfig;
      secrets: FeishuBotSecrets;
      group: FeishuBotGroup;
      message: FeishuInboundMessage;
      threadId: string;
      user: User | null;
      senderOpenId: string | null;
      text: string;
    },
  ): Promise<CollectedTopicFeedback> {
    const images = await this.transferImages(
      input.config,
      input.secrets,
      input.message,
    ).catch((error: Error) => {
      this.logger.warn(
        `反馈群图片转存失败（message=${input.message.messageId}）: ${error.message}`,
      );
      return [] as string[];
    });
    const result = await this.replies
      .createQueryBuilder()
      .insert()
      .into(FeedbackReply)
      .values({
        feedbackId: feedback.id,
        senderName: input.user?.name ?? '群成员',
        senderUserId: input.user?.id ?? null,
        senderOpenId: input.senderOpenId,
        content: input.text.trim() || placeholderOf(input.message.messageType),
        images: images.length ? images.slice(0, MAX_IMAGES) : null,
        sourceMessageId: input.message.messageId,
        sourceThreadId: input.threadId,
      })
      .orIgnore()
      .execute();
    // ON CONFLICT DO NOTHING 被忽略时无 RETURNING 标识：视为事件重复
    if (!result.identifiers?.[0]?.id) {
      return { feedback, isNew: false, duplicated: true };
    }
    await this.feedbacks.update({ id: feedback.id }, { updatedAt: new Date() });
    return { feedback, isNew: false, duplicated: false };
  }

  /** 下载消息内图片并转存平台图片目录，返回 /images/... 路径数组 */
  private async transferImages(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    message: FeishuInboundMessage,
  ): Promise<string[]> {
    const keys = imageKeysOf(message.messageType, message.content);
    if (keys.length === 0) return [];
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const out: string[] = [];
    for (const imageKey of keys.slice(0, MAX_IMAGES)) {
      try {
        const buffer = await this.client.downloadImage(
          config.id,
          secrets,
          message.messageId,
          imageKey,
        );
        const relPath = path.posix.join('uploads', date, `${randomUUID()}.png`);
        const absPath = path.join(imageWebroot(), relPath);
        await mkdir(path.dirname(absPath), { recursive: true });
        await writeFile(absPath, buffer);
        out.push(`/images/${relPath}`);
      } catch (error) {
        this.logger.warn(
          `反馈群图片下载失败（key=${imageKey}）: ${(error as Error).message}`,
        );
      }
    }
    return out;
  }
}

/** 从消息内容解析图片 image_key 列表（image 单图 / post 富文本内嵌图） */
export function imageKeysOf(messageType: string, content: string): string[] {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(content || '{}') as Record<string, unknown>;
  } catch {
    return [];
  }
  if (messageType === 'image') {
    const key = payload.image_key;
    return typeof key === 'string' && key ? [key] : [];
  }
  if (messageType === 'post') {
    const keys: string[] = [];
    const paragraphs = Array.isArray(payload.content)
      ? (payload.content as unknown[])
      : [];
    for (const paragraph of paragraphs) {
      if (!Array.isArray(paragraph)) continue;
      for (const node of paragraph as Record<string, unknown>[]) {
        if (node.tag === 'img' && typeof node.image_key === 'string') {
          keys.push(node.image_key);
        }
      }
    }
    return keys;
  }
  return [];
}

/** 首帖标题：第一行文字截断；无文字用类型占位 */
export function deriveTitle(text: string, messageType: string): string {
  const line = (text ?? '')
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) {
    return `${FALLBACK_TITLE}（${placeholderOf(messageType)}）`;
  }
  return line.length > TITLE_SOURCE_LIMIT
    ? `${line.slice(0, TITLE_SOURCE_LIMIT)}…`
    : line;
}

/** 非文本消息占位 */
export function placeholderOf(messageType: string): string {
  return MESSAGE_PLACEHOLDERS[messageType] ?? `[${messageType || '消息'}]`;
}
