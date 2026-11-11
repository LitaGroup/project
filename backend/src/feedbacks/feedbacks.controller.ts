import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import { UserRole, FeedbackStatus, FeedbackType } from '../common/enums';
import {
  ChangeFeedbackStatusInput,
  CreateFeedbackInput,
  FeedbackActor,
  FeedbacksService,
  UpdateFeedbackInput,
} from './feedbacks.service';
import { FeedbackReply } from './feedback-reply.entity';
import { Feedback } from './feedback.entity';

class CreateFeedbackDto implements CreateFeedbackInput {
  /** 标题（必填，≤200 字） */
  title: string;
  /** 问题描述（Markdown，必填） */
  content: string;
  /** 类型：BUG（默认）/ 建议 / 其它 */
  type?: FeedbackType;
  /** 图片：/images/... 路径数组（POST /api/images 上传后返回的 url），最多 9 张 */
  images?: string[];
}

class UpdateFeedbackDto implements UpdateFeedbackInput {
  title?: string;
  content?: string;
  /** 图片：/images/... 路径数组，全量覆盖（空数组清除） */
  images?: string[];
  type?: FeedbackType;
  /** 处理备注（仅管理员，空串清除） */
  handleNote?: string;
}

class ChangeStatusDto implements ChangeFeedbackStatusInput {
  /** 目标状态：待处理/处理中/已解决/已关闭 */
  status: FeedbackStatus;
  /** 处理备注（一并写入） */
  handleNote?: string;
}

/** 反馈操作必须携带真人登录身份（机器人令牌未绑定真人时拒绝） */
function feedbackActor(req: AuthedRequest): FeedbackActor {
  const user = req.user;
  if (!user) {
    throw new ForbiddenException('反馈操作需要真人登录身份');
  }
  return {
    userId: user.id,
    userName: user.name,
    isAdmin: user.role === UserRole.ADMIN,
  };
}

@Controller('feedbacks')
export class FeedbacksController {
  constructor(private readonly feedbacksService: FeedbacksService) {}

  /** 反馈列表（不含正文）：q（标题/提交人拼音匹配）/status/type */
  @Get()
  list(
    @Query('q') q?: string,
    @Query('status') status?: FeedbackStatus,
    @Query('type') type?: FeedbackType,
  ): Promise<Feedback[]> {
    return this.feedbacksService.list({
      q: q?.trim() || undefined,
      status,
      type,
    });
  }

  /** 提交反馈（任何登录用户；BUG REPORT / 建议 / 其它） */
  @Post()
  create(
    @Body() dto: CreateFeedbackDto,
    @Req() req: AuthedRequest,
  ): Promise<Feedback> {
    return this.feedbacksService.create(dto, feedbackActor(req));
  }

  /** Markdown 详情视图（须声明在 :id 之前） */
  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  findOneMarkdown(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.feedbacksService.findOneMarkdown(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Feedback> {
    return this.feedbacksService.findOne(id);
  }

  /** 反馈跟帖列表（飞书群话题收录的后续消息，按时间正序） */
  @Get(':id/replies')
  listReplies(@Param('id', ParseIntPipe) id: number): Promise<FeedbackReply[]> {
    return this.feedbacksService.listReplies(id);
  }

  /** 更新反馈：提交人仅「待处理」可改内容；管理员随时可改；处理备注仅管理员 */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFeedbackDto,
    @Req() req: AuthedRequest,
  ): Promise<Feedback> {
    return this.feedbacksService.update(id, dto, feedbackActor(req));
  }

  /** 状态流转（仅管理员）：待处理/处理中/已解决/已关闭 */
  @Post(':id/status')
  changeStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeStatusDto,
    @Req() req: AuthedRequest,
  ): Promise<Feedback> {
    return this.feedbacksService.changeStatus(id, dto, feedbackActor(req));
  }

  /** 删除：管理员，或提交人撤销「待处理」的反馈 */
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    return this.feedbacksService.remove(id, feedbackActor(req));
  }
}

/** GET /api/feedbacks.md：反馈清单 Markdown 视图（独立控制器挂载，避开 :id 路由） */
@Controller('feedbacks.md')
export class FeedbacksMarkdownController {
  constructor(private readonly feedbacksService: FeedbacksService) {}

  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  listMarkdown(
    @Query('q') q?: string,
    @Query('status') status?: FeedbackStatus,
    @Query('type') type?: FeedbackType,
  ): Promise<string> {
    return this.feedbacksService.listMarkdown({
      q: q?.trim() || undefined,
      status,
      type,
    });
  }
}
