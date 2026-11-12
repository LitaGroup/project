import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import {
  BacklogStatus,
  IterationStatus,
  IterationType,
  UserRole,
} from '../common/enums';
import { BacklogsService } from './backlogs.service';
import { IterationsService } from './iterations.service';
import {
  BacklogMemberInput,
  CreateBacklogItemInput,
  CreateIterationInput,
  IterationActor,
  UpdateIterationInput,
} from './iteration.types';
import { Backlog } from './backlog.entity';
import { Iteration } from './iteration.entity';

/** 迭代网页操作必须携带真人登录身份 */
function iterationActor(req: AuthedRequest): IterationActor {
  const user = req.user;
  if (!user) {
    throw new ForbiddenException('迭代操作需要真人登录身份');
  }
  return {
    userId: user.id,
    userName: user.name,
    isAdmin: user.role === UserRole.ADMIN,
  };
}

class CreateIterationDto implements CreateIterationInput {
  /** 唯一标识（W1，如 W2026-46） */
  code: string;
  /** 迭代名称 */
  name: string;
  /** 开始日期 YYYY-MM-DD */
  startAt?: string | null;
  /** 结束日期 YYYY-MM-DD */
  endAt?: string | null;
}

class UpdateIterationDto implements UpdateIterationInput {
  name?: string;
  startAt?: string | null;
  endAt?: string | null;
  /** 进行中 / 已结束 */
  status?: IterationStatus;
}

class CreateBacklogItemDto implements CreateBacklogItemInput {
  /** 原始需求（projects.id） */
  projectId: number;
  /** 负责人机器人（AI 或真人，workers.id） */
  ownerWorkerId: number;
  /** 成员：角色 + 平台用户 */
  members?: BacklogMemberInput[];
}

class CreateBacklogsDto {
  items: CreateBacklogItemDto[];
}

class UpdateBacklogStatusDto {
  /** 等待 / 执行 / 测试 / 发布 / 完成 / 取消 */
  status: BacklogStatus;
}

class MoveBacklogDto {
  /** 目标迭代（iterations.id） */
  iterationId: number;
}

class UpdateBacklogMembersDto {
  members: BacklogMemberInput[];
}

@Controller('iterations')
export class IterationsController {
  constructor(
    private readonly iterationsService: IterationsService,
    private readonly backlogsService: BacklogsService,
  ) {}

  /** 迭代列表（T0 置顶，W1 按开始日期倒序），含 backlog 进度 */
  @Get()
  list(
    @Query('type') type?: IterationType,
    @Query('status') status?: IterationStatus,
  ): ReturnType<IterationsService['list']> {
    return this.iterationsService.list({ type, status });
  }

  /** 创建 W1 周迭代（仅管理员） */
  @Post()
  create(
    @Body() dto: CreateIterationDto,
    @Req() req: AuthedRequest,
  ): Promise<Iteration> {
    return this.iterationsService.create(dto, iterationActor(req));
  }

  /** Markdown 详情视图（须声明在 :id 之前） */
  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  findOneMarkdown(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.iterationsService.findOneMarkdown(id);
  }

  /** 迭代详情：迭代信息 + 迭代项列表 */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.iterationsService.findOne(id);
  }

  /** 更新迭代：名称 / 起止日期 / 结束或重开（仅管理员） */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIterationDto,
    @Req() req: AuthedRequest,
  ): Promise<Iteration> {
    return this.iterationsService.update(id, dto, iterationActor(req));
  }

  /** 批量转入：选中需求转为该迭代的 backlog（每条必填负责人） */
  @Post(':id/backlogs')
  createBacklogs(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateBacklogsDto,
    @Req() req: AuthedRequest,
  ): Promise<Backlog[]> {
    return this.backlogsService.createBatch(
      id,
      dto.items ?? [],
      iterationActor(req),
    );
  }
}

/** GET /api/iterations.md：迭代清单 Markdown 视图 */
@Controller('iterations.md')
export class IterationsMarkdownController {
  constructor(private readonly iterationsService: IterationsService) {}

  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  listMarkdown(
    @Query('type') type?: IterationType,
    @Query('status') status?: IterationStatus,
  ): Promise<string> {
    return this.iterationsService.listMarkdown({ type, status });
  }
}

@Controller('backlogs')
export class BacklogsController {
  constructor(private readonly backlogsService: BacklogsService) {}

  /** Markdown 详情视图（须声明在 :id 之前） */
  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  findOneMarkdown(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.backlogsService.findOneMarkdown(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Backlog> {
    return this.backlogsService.findOne(id);
  }

  /** 状态流转（成员或管理员）：等待 → 执行 → 测试 → 发布 → 完成，允许取消 */
  @Post(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBacklogStatusDto,
    @Req() req: AuthedRequest,
  ): Promise<Backlog> {
    return this.backlogsService.updateStatus(
      id,
      dto.status,
      iterationActor(req),
    );
  }

  /** 移动迭代项到另一个迭代（不重建交付任务与沟通群） */
  @Post(':id/move')
  move(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveBacklogDto,
    @Req() req: AuthedRequest,
  ): Promise<Backlog> {
    return this.backlogsService.move(id, dto.iterationId, iterationActor(req));
  }

  /** 更新成员（仅管理员） */
  @Patch(':id/members')
  updateMembers(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBacklogMembersDto,
    @Req() req: AuthedRequest,
  ): Promise<Backlog> {
    return this.backlogsService.updateMembers(
      id,
      dto.members ?? [],
      iterationActor(req),
    );
  }
}
