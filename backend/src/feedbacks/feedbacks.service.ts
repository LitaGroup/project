import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsSelect, FindOptionsWhere, Repository } from 'typeorm';
import { FeedbackSource, FeedbackStatus, FeedbackType } from '../common/enums';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { matchesPinyinSearch } from '../common/pinyin-search';
import { FeedbackReply } from './feedback-reply.entity';
import { Feedback } from './feedback.entity';

/** 图片上限（单条反馈最多 9 张，经 POST /api/images 上传） */
const MAX_IMAGES = 9;

/** 列表查询上限（反馈为轻量记录，全量倒序拉取后前端展示） */
const LIST_LIMIT = 1000;

export const FEEDBACK_LIST_SELECT: FindOptionsSelect<Feedback> = {
  id: true,
  title: true,
  type: true,
  source: true,
  status: true,
  images: true,
  reporterId: true,
  reporterName: true,
  handlerName: true,
  handleNote: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
};

/** 操作人身份：反馈面向真人提交与管理，机器人令牌未绑定真人时不产生身份 */
export interface FeedbackActor {
  userId: number;
  userName: string;
  isAdmin: boolean;
}

export interface CreateFeedbackInput {
  title: string;
  content: string;
  /** BUG / 建议 / 其它（默认 BUG） */
  type?: FeedbackType;
  /** 图片：/images/... 路径数组，最多 9 张 */
  images?: string[];
}

export interface UpdateFeedbackInput {
  title?: string;
  content?: string;
  images?: string[];
  type?: FeedbackType;
  /** 处理备注（仅管理员可写，空串清除） */
  handleNote?: string;
}

export interface ChangeFeedbackStatusInput {
  /** 目标状态：待处理/处理中/已解决/已关闭 */
  status: FeedbackStatus;
  /** 处理备注（一并写入，可空保持不变） */
  handleNote?: string;
}

export interface FeedbackListQuery {
  q?: string;
  status?: FeedbackStatus;
  type?: FeedbackType;
}

/** Markdown 表格单元格转义（换行与竖线） */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

@Injectable()
export class FeedbacksService {
  constructor(
    @InjectRepository(Feedback)
    private readonly feedbacks: Repository<Feedback>,
    @InjectRepository(FeedbackReply)
    private readonly replies: Repository<FeedbackReply>,
  ) {}

  /**
   * 反馈列表（不含 content 大正文）：状态/类型走 SQL 过滤，
   * 关键词复用拼音匹配（标题 + 提交人，支持原文/全拼/首字母）。
   */
  async list(query: FeedbackListQuery): Promise<Feedback[]> {
    const where: FindOptionsWhere<Feedback> = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    const rows = await this.feedbacks.find({
      where,
      select: FEEDBACK_LIST_SELECT,
      order: { createdAt: 'DESC' },
      take: LIST_LIMIT,
    });
    if (!query.q) return rows;
    return rows.filter((f) =>
      matchesPinyinSearch(query.q as string, [f.title, f.reporterName]),
    );
  }

  async findOne(id: number): Promise<Feedback> {
    const feedback = await this.feedbacks.findOne({ where: { id } });
    if (!feedback) throw new NotFoundException(`Feedback ${id} not found`);
    return feedback;
  }

  /** 反馈跟帖列表（按时间正序）：飞书群话题收录的后续消息；平台提交无跟帖 */
  async listReplies(id: number): Promise<FeedbackReply[]> {
    await this.findOne(id);
    return this.replies.find({
      where: { feedbackId: id },
      order: { id: 'ASC' },
    });
  }

  async create(
    input: CreateFeedbackInput,
    actor: FeedbackActor,
  ): Promise<Feedback> {
    const title = this.normalizeTitle(input.title);
    const content = (input.content ?? '').trim();
    if (!content) throw new BadRequestException('问题描述不能为空');
    const feedback = this.feedbacks.create({
      title,
      content,
      type: this.normalizeType(input.type),
      status: FeedbackStatus.PENDING,
      images: this.normalizeImages(input.images),
      reporterId: actor.userId,
      reporterName: actor.userName,
    });
    return this.feedbacks.save(feedback);
  }

  /**
   * 更新反馈：标题/正文/图片/类型 —— 管理员随时可改，提交人仅「待处理」时；
   * 处理备注仅管理员。
   */
  async update(
    id: number,
    input: UpdateFeedbackInput,
    actor: FeedbackActor,
  ): Promise<Feedback> {
    const feedback = await this.findOne(id);
    this.assertEditable(feedback, actor, input);

    if (input.title !== undefined)
      feedback.title = this.normalizeTitle(input.title);
    if (input.content !== undefined) {
      const content = input.content.trim();
      if (!content) throw new BadRequestException('问题描述不能为空');
      feedback.content = content;
    }
    if (input.images !== undefined) {
      feedback.images = this.normalizeImages(input.images);
    }
    if (input.type !== undefined)
      feedback.type = this.normalizeType(input.type);
    if (input.handleNote !== undefined) {
      this.assertAdmin(actor, '仅管理员可填写处理备注');
      feedback.handleNote = input.handleNote.trim() || null;
    }
    return this.feedbacks.save(feedback);
  }

  /**
   * 状态流转（仅管理员）：置已解决/已关闭时补记 resolvedAt，
   * 退回待处理/处理中时清空；目标状态不变时仅更新处理信息。
   */
  async changeStatus(
    id: number,
    input: ChangeFeedbackStatusInput,
    actor: FeedbackActor,
  ): Promise<Feedback> {
    this.assertAdmin(actor, '仅管理员可处理反馈');
    const feedback = await this.findOne(id);
    const status = Object.values(FeedbackStatus).includes(input.status)
      ? input.status
      : undefined;
    if (!status)
      throw new BadRequestException(
        '反馈状态仅允许：待处理/处理中/已解决/已关闭',
      );

    feedback.status = status;
    feedback.handlerName = actor.userName;
    if (input.handleNote !== undefined) {
      feedback.handleNote = input.handleNote.trim() || null;
    }
    if (
      status === FeedbackStatus.RESOLVED ||
      status === FeedbackStatus.CLOSED
    ) {
      if (!feedback.resolvedAt) feedback.resolvedAt = new Date();
    } else {
      feedback.resolvedAt = null;
    }
    return this.feedbacks.save(feedback);
  }

  /** 删除：管理员可删任意；提交人仅能撤销「待处理」的反馈 */
  async remove(id: number, actor: FeedbackActor): Promise<void> {
    const feedback = await this.findOne(id);
    const isOwn =
      feedback.reporterId !== null && feedback.reporterId === actor.userId;
    if (
      !actor.isAdmin &&
      !(isOwn && feedback.status === FeedbackStatus.PENDING)
    ) {
      throw new ForbiddenException('仅管理员或提交人（待处理时）可删除反馈');
    }
    await this.replies.delete({ feedbackId: feedback.id });
    await this.feedbacks.remove(feedback);
  }

  /** GET /api/feedbacks.md：反馈清单 Markdown 视图 */
  async listMarkdown(query: FeedbackListQuery): Promise<string> {
    const rows = await this.list(query);
    const head = mdFrontmatter({
      title: '用户反馈列表',
      description: `共 ${rows.length} 条`,
    });
    const lines: string[] = [
      '# 用户反馈',
      '',
      `共 ${rows.length} 条。详情：GET /api/feedbacks/{id}.md；提交与处理见管理接口说明。`,
      '',
    ];
    if (rows.length === 0) {
      lines.push('（暂无反馈）');
    } else {
      lines.push(
        '| ID | 标题 | 类型 | 来源 | 状态 | 提交人 | 创建时间 | 详情 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
      );
      for (const f of rows) {
        lines.push(
          `| ${f.id} | ${escapeCell(f.title)} | ${f.type} | ${f.source} | ${f.status} | ${escapeCell(
            f.reporterName ?? '-',
          )} | ${beijingTime(f.createdAt)} | /api/feedbacks/${f.id}.md |`,
        );
      }
    }
    return `${head}${lines.join('\n')}\n`;
  }

  /** GET /api/feedbacks/:id.md：反馈详情 Markdown 视图（正文 + 跟帖 + 处理信息） */
  async findOneMarkdown(id: number): Promise<string> {
    const f = await this.findOne(id);
    const replies = await this.listReplies(id);
    const head = mdFrontmatter({
      update: f.updatedAt,
      title: f.title,
      type: f.type,
      status: f.status,
      reporter: f.reporterName ?? undefined,
    });
    const meta = [
      `- 反馈 ID：${f.id}`,
      `- 类型：${f.type}`,
      `- 来源：${f.source}${
        f.source === FeedbackSource.FEISHU_GROUP && f.sourceThreadId
          ? `（群 ${f.sourceChatId ?? '-'} / 话题 ${f.sourceThreadId}）`
          : ''
      }`,
      `- 状态：${f.status}`,
      `- 提交人：${f.reporterName ?? '-'}（创建 ${beijingTime(f.createdAt)}）`,
    ];
    if (f.taskId) meta.push(`- 处理任务：\`GET /api/tasks/${f.taskId}.md\``);
    if (f.handlerName) meta.push(`- 处理人：${f.handlerName}`);
    if (f.resolvedAt) meta.push(`- 解决时间：${beijingTime(f.resolvedAt)}`);
    if (f.images?.length) meta.push(`- 图片：${f.images.join('、')}`);
    const sections = ['# 反馈', '', ...meta, '', '## 问题描述', '', f.content];
    if (replies.length > 0) {
      sections.push('', '## 跟帖（群内后续消息）', '');
      for (const reply of replies) {
        const time = beijingTime(reply.createdAt);
        const images = reply.images?.length
          ? `\n图片：${reply.images.join('、')}`
          : '';
        sections.push(
          `- ${time} ${reply.senderName ?? '群成员'}：${reply.content}${images}`,
        );
      }
    }
    if (f.handleNote) {
      sections.push('', '## 处理备注', '', f.handleNote);
    }
    return `${head}${sections.join('\n')}\n`;
  }

  private assertEditable(
    feedback: Feedback,
    actor: FeedbackActor,
    input: UpdateFeedbackInput,
  ): void {
    const touchesBody =
      input.title !== undefined ||
      input.content !== undefined ||
      input.images !== undefined ||
      input.type !== undefined;
    if (!touchesBody) return;
    const isOwn =
      feedback.reporterId !== null && feedback.reporterId === actor.userId;
    if (
      !actor.isAdmin &&
      !(isOwn && feedback.status === FeedbackStatus.PENDING)
    ) {
      throw new ForbiddenException('反馈进入处理后仅管理员可修改内容');
    }
  }

  private assertAdmin(actor: FeedbackActor, message: string): void {
    if (!actor.isAdmin) throw new ForbiddenException(message);
  }

  private normalizeTitle(title: string): string {
    const trimmed = (title ?? '').trim();
    if (!trimmed) throw new BadRequestException('标题不能为空');
    if (trimmed.length > 200) throw new BadRequestException('标题最长 200 字');
    return trimmed;
  }

  private normalizeType(type?: FeedbackType): FeedbackType {
    if (type === undefined) return FeedbackType.BUG;
    if (!Object.values(FeedbackType).includes(type)) {
      throw new BadRequestException('反馈类型仅允许：BUG/建议/其它');
    }
    return type;
  }

  private normalizeImages(images?: string[]): string[] | null {
    if (images === undefined) return null;
    if (!Array.isArray(images))
      throw new BadRequestException('images 必须为数组');
    if (images.length > MAX_IMAGES) {
      throw new BadRequestException(`图片最多 ${MAX_IMAGES} 张`);
    }
    for (const url of images) {
      if (typeof url !== 'string' || !url.startsWith('/images/')) {
        throw new BadRequestException(
          '图片仅接受 /api/images 上传返回的 /images/... 地址',
        );
      }
    }
    return images.length ? images : null;
  }
}
