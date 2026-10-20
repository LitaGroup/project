import {
  Body,
  Controller,
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
import { ReleaseStatus } from '../common/enums';
import { ProjectRelease } from './project-release.entity';
import { ReleasesService, SubmitReleaseInput } from './releases.service';

/** 提测状态判定入参：状态须为 待冒烟 / 已通过 / 未通过 */
class UpdateReleaseStatusDto {
  /** 目标状态（由测试同学判定） */
  status: ReleaseStatus;
}

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

/** 提测记录状态端点（/api/releases/:id/status，由测试同学判定本次提测是否通过） */
@Controller('releases')
export class ReleaseRecordsController {
  constructor(private readonly releasesService: ReleasesService) {}

  /** 状态判定：待冒烟 → 已通过 / 未通过（可改回待冒烟重新冒烟），记录判定人与判定时间 */
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReleaseStatusDto,
    @Req() req: AuthedRequest,
  ): Promise<ProjectRelease> {
    return this.releasesService.updateStatus(id, dto.status, req.user?.name);
  }

  /** AI 用：状态判定并返回 Markdown 结果（text/markdown） */
  @Post(':id/status.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  updateStatusMarkdown(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReleaseStatusDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    return this.releasesService.updateStatusMarkdown(
      id,
      dto.status,
      req.user?.name,
    );
  }
}
