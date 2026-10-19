import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import { ProjectRelease } from './project-release.entity';
import { ReleasesService, SubmitReleaseInput } from './releases.service';

/** 提测入参：仅测试人员必填（至少 1 人，须为用户系统内用户），其余可空 */
class SubmitReleaseDto implements SubmitReleaseInput {
  /** 提测内容（Markdown，可空） */
  content?: string;
  /** 访问地址（可空） */
  urls?: string[];
  /** 代码分支（仓库+分支 列表，可空） */
  branches?: { repo: string; branch: string }[];
  /** 测试人员（至少 1 人） */
  testers: string[];
}

/** 项目提测端点（挂在 /projects 前缀下，与 ProjectsController 的路由互不冲突） */
@Controller('projects')
export class ReleasesController {
  constructor(private readonly releasesService: ReleasesService) {}

  /** 提测：创建提测记录 + 项目状态流转「测试中」+ 通知提测群与项目人员 */
  @Post(':id/release')
  submit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitReleaseDto,
    @Req() req: AuthedRequest,
  ): Promise<ProjectRelease> {
    return this.releasesService.submit(id, dto, req.user?.name);
  }

  /** AI 用：提测并返回 Markdown 结果（text/markdown） */
  @Post(':id/release.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  submitMarkdown(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitReleaseDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    return this.releasesService.submitMarkdown(id, dto, req.user?.name);
  }

  /** 提测记录列表（倒序） */
  @Get(':id/releases')
  findByProject(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProjectRelease[]> {
    return this.releasesService.findByProject(id);
  }
}

/** GET /api/releases.md：提测记录清单 Markdown 视图（单段路径经独立控制器挂载） */
@Controller('releases.md')
export class ReleasesMarkdownController {
  constructor(private readonly releasesService: ReleasesService) {}

  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  listMarkdown(@Query('projectId') projectId?: string): Promise<string> {
    return this.releasesService.listMarkdown(
      projectId === undefined ? undefined : Number(projectId),
    );
  }
}
