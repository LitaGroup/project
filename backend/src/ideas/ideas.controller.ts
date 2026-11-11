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
import { IdeaStatus, IdeaType, ProjectType, UserRole } from '../common/enums';
import {
  ChangeIdeaStatusInput,
  CreateIdeaInput,
  IdeaActor,
  IdeasService,
  UpdateIdeaInput,
} from './ideas.service';
import { Idea } from './idea.entity';

class CreateIdeaDto implements CreateIdeaInput {
  /** 标题（可省略，省略时由平台根据正文异步生成） */
  title?: string;
  /** 正文（Markdown，可空） */
  content?: string;
  /** 类型：想法（默认）/ 创意 / 待办 / 建议 / 其它 */
  type?: IdeaType;
  /** 图片：/images/... 路径数组（POST /api/images 上传后返回的 url），最多 9 张 */
  images?: string[];
}

class UpdateIdeaDto implements UpdateIdeaInput {
  title?: string;
  content?: string;
  /** 图片：/images/... 路径数组，全量覆盖（空数组清除） */
  images?: string[];
  type?: IdeaType;
}

class ChangeStatusDto implements ChangeIdeaStatusInput {
  /** 目标状态：构思/废弃/采纳 */
  status: IdeaStatus;
  /** 采纳时在需求池新建需求 */
  createProject?: boolean;
  /** 采纳时关联已有需求（projects.id） */
  projectId?: number | null;
  /** 新建需求的项目类型（默认其它） */
  projectType?: ProjectType;
}

/** 灵感网页操作必须携带真人登录身份（机器人令牌走 MCP 工具） */
function ideaActor(req: AuthedRequest): IdeaActor {
  const user = req.user;
  if (!user) {
    throw new ForbiddenException('灵感操作需要真人登录身份');
  }
  return {
    userId: user.id,
    userName: user.name,
    isAdmin: user.role === UserRole.ADMIN,
  };
}

@Controller('ideas')
export class IdeasController {
  constructor(private readonly ideasService: IdeasService) {}

  /** 灵感列表（不含正文）：q（标题/创建人拼音匹配）/status/type */
  @Get()
  list(
    @Query('q') q?: string,
    @Query('status') status?: IdeaStatus,
    @Query('type') type?: IdeaType,
  ): Promise<Idea[]> {
    return this.ideasService.list({
      q: q?.trim() || undefined,
      status,
      type,
    });
  }

  /** 创建灵感（任何登录用户；机器人经 lita-work MCP 创建） */
  @Post()
  create(@Body() dto: CreateIdeaDto, @Req() req: AuthedRequest): Promise<Idea> {
    return this.ideasService.create(dto, ideaActor(req));
  }

  /** Markdown 详情视图（须声明在 :id 之前） */
  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  findOneMarkdown(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.ideasService.findOneMarkdown(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Idea> {
    return this.ideasService.findOne(id);
  }

  /** 更新灵感：构思期任何登录用户可编辑；采纳/废弃后仅管理员 */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIdeaDto,
    @Req() req: AuthedRequest,
  ): Promise<Idea> {
    return this.ideasService.update(id, dto, ideaActor(req));
  }

  /** 状态流转（仅管理员）：采纳时新建或关联需求池需求 */
  @Post(':id/status')
  changeStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeStatusDto,
    @Req() req: AuthedRequest,
  ): Promise<Idea> {
    return this.ideasService.changeStatus(id, dto, ideaActor(req));
  }

  /** 删除：管理员，或创建人撤销「构思」中的灵感 */
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    return this.ideasService.remove(id, ideaActor(req));
  }
}

/** GET /api/ideas.md：灵感清单 Markdown 视图（独立控制器挂载，避开 :id 路由） */
@Controller('ideas.md')
export class IdeasMarkdownController {
  constructor(private readonly ideasService: IdeasService) {}

  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  listMarkdown(
    @Query('q') q?: string,
    @Query('status') status?: IdeaStatus,
    @Query('type') type?: IdeaType,
  ): Promise<string> {
    return this.ideasService.listMarkdown({
      q: q?.trim() || undefined,
      status,
      type,
    });
  }
}
