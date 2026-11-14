import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Sse,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthedRequest } from '../auth/auth.guard';
import { TopicStatus, TopicSubjectType, TopicType } from '../common/enums';
import { topicActorOf } from './topics.actor';
import { renderTopicDetail, renderTopicList } from './topics.markdown';
import { TopicsService } from './topics.service';
import type {
  AnswerTopicInput,
  CreateTopicInput,
  ReplyTopicInput,
  UpdateTopicInput,
} from './topics.types';

function parseSubjectType(value?: string): TopicSubjectType {
  const type = (value ?? '').trim() as TopicSubjectType;
  if (!Object.values(TopicSubjectType).includes(type)) {
    throw new BadRequestException(
      `subjectType 必须是 ${Object.values(TopicSubjectType).join(' / ')}`,
    );
  }
  return type;
}

function parseTopicType(value?: string): TopicType | undefined {
  if (!value) return undefined;
  if (!Object.values(TopicType).includes(value as TopicType)) {
    throw new BadRequestException('type 必须是 content / question / system');
  }
  return value as TopicType;
}

function parseTopicStatus(value?: string): TopicStatus | undefined {
  if (!value) return undefined;
  if (!Object.values(TopicStatus).includes(value as TopicStatus)) {
    throw new BadRequestException('status 必须是 open / resolved / closed');
  }
  return value as TopicStatus;
}

class CreateTopicDto implements CreateTopicInput {
  subjectType: TopicSubjectType;
  subjectId: string;
  title?: string;
  content: string;
  type?: TopicType;
  tags?: string[];
  mentions?: number[];
  images?: string[];
}

class UpdateTopicDto implements UpdateTopicInput {
  title?: string | null;
  tags?: string[];
  status?: TopicStatus;
  pinned?: boolean;
  locked?: boolean;
}

class ReplyTopicDto implements ReplyTopicInput {
  content: string;
  mentions?: number[];
  images?: string[];
}

class AnswerTopicDto implements AnswerTopicInput {
  answers?: string[][];
  reject?: boolean;
}

class MarkNotificationsReadDto {
  ids?: number[];
}

/** 话题 REST 接口：网页与内部调用共用 */
@Controller('topics')
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  @Get()
  list(
    @Req() req: AuthedRequest,
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('tag') tag?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    if (!subjectId?.trim()) {
      throw new BadRequestException('缺少 subjectId');
    }
    return this.topics.list(
      {
        subjectType: parseSubjectType(subjectType),
        subjectId: subjectId.trim(),
        q,
        type: parseTopicType(type),
        status: parseTopicStatus(status),
        tag,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      },
      topicActorOf(req),
    );
  }

  @Get('notifications')
  notifications(@Req() req: AuthedRequest) {
    return this.topics.notificationsOf(topicActorOf(req));
  }

  @Post('notifications/read')
  markNotificationsRead(
    @Req() req: AuthedRequest,
    @Body() dto: MarkNotificationsReadDto,
  ) {
    return this.topics.markNotificationsRead(topicActorOf(req), dto.ids);
  }

  @Sse('stream')
  stream(
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
  ): Observable<MessageEvent> {
    if (!subjectId?.trim()) {
      throw new BadRequestException('缺少 subjectId');
    }
    return this.topics.stream(parseSubjectType(subjectType), subjectId.trim());
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateTopicDto) {
    if (!dto?.subjectId) throw new BadRequestException('缺少 subjectId');
    return this.topics.create(
      {
        ...dto,
        subjectId: String(dto.subjectId),
        content: dto.content ?? '',
      },
      topicActorOf(req),
    );
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.topics.get(id, topicActorOf(req));
  }

  @Patch(':id')
  update(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTopicDto,
  ) {
    return this.topics.update(id, dto, topicActorOf(req));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.topics.remove(id, topicActorOf(req));
  }

  @Post(':id/replies')
  reply(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplyTopicDto,
  ) {
    return this.topics.reply(
      id,
      {
        content: dto?.content ?? '',
        mentions: dto?.mentions,
        images: dto?.images,
      },
      topicActorOf(req),
    );
  }

  @Post(':id/answer')
  answer(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AnswerTopicDto,
  ) {
    return this.topics.answer(id, dto, topicActorOf(req));
  }

  @Post(':id/read')
  markRead(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.topics.markRead(id, topicActorOf(req));
  }
}

/** GET /api/topics.md：Agent 话题清单（单段路径独立控制器） */
@Controller('topics.md')
export class TopicsListMarkdownController {
  constructor(private readonly topics: TopicsService) {}

  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async list(
    @Req() req: AuthedRequest,
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('tag') tag?: string,
  ): Promise<string> {
    if (!subjectId?.trim()) {
      throw new BadRequestException('缺少 subjectId');
    }
    const result = await this.topics.list(
      {
        subjectType: parseSubjectType(subjectType),
        subjectId: subjectId.trim(),
        q,
        type: parseTopicType(type),
        status: parseTopicStatus(status),
        tag,
        pageSize: 100,
      },
      topicActorOf(req),
    );
    return renderTopicList(result);
  }
}

/** 话题 Agent 写接口：详情 / 新开 / 回复 / 答复 / 解决 */
@Controller('topics')
export class TopicsMarkdownController {
  constructor(private readonly topics: TopicsService) {}

  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async detail(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<string> {
    return renderTopicDetail(await this.topics.get(id, topicActorOf(req)));
  }

  @Post('create.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async create(
    @Req() req: AuthedRequest,
    @Body() dto: CreateTopicDto,
  ): Promise<string> {
    if (!dto?.subjectId) throw new BadRequestException('缺少 subjectId');
    const topic = await this.topics.create(
      {
        ...dto,
        subjectId: String(dto.subjectId),
        content: dto.content ?? '',
      },
      topicActorOf(req),
    );
    return [
      `话题已创建：#${topic.id}`,
      '',
      `- 标题：${topic.title || '（无）'}`,
      `- 主体：${topic.subjectTitle}`,
      `- 阅读地址：GET /api/topics/${topic.id}.md`,
      '',
    ].join('\n');
  }

  @Post(':id/reply.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async reply(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplyTopicDto,
  ): Promise<string> {
    const result = await this.topics.reply(
      id,
      {
        content: dto?.content ?? '',
        mentions: dto?.mentions,
        images: dto?.images,
      },
      topicActorOf(req),
    );
    return [
      `回复已发布：#${result.reply.id}`,
      '',
      `- 话题：${result.topic.title || '主话题'}`,
      `- 阅读地址：GET /api/topics/${result.topic.id}.md`,
      '',
    ].join('\n');
  }

  @Post(':id/answer.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async answer(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AnswerTopicDto,
  ): Promise<string> {
    const topic = await this.topics.answer(id, dto, topicActorOf(req));
    return [`问答话题已答复：#${topic.id}`, ''].join('\n');
  }

  @Post(':id/resolve.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async resolve(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<string> {
    const topic = await this.topics.update(
      id,
      { status: TopicStatus.RESOLVED },
      topicActorOf(req),
    );
    return [`话题已标记为已解决：#${topic.id}`, ''].join('\n');
  }
}
