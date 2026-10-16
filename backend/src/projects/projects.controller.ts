import {
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
} from '@nestjs/common';
import { ProjectStatus, ProjectType } from '../common/enums';
import { Project } from './project.entity';
import { ProjectSyncService, SyncProjectsResult } from './project-sync.service';
import {
  ProjectPage,
  ProjectPageQuery,
  ProjectsService,
} from './projects.service';

class CreateProjectDto {
  name: string;
  type?: ProjectType;
  status?: ProjectStatus;
  /** ISO 日期，如 2026-09-01 */
  expectedReleaseAt?: string;
  description?: string;
}

class UpdateProjectDto {
  /** 项目类型 */
  type?: ProjectType;
  /** 项目状态 */
  status?: ProjectStatus;
  /** 优先级（如 S0/P0），空串清除 */
  priority?: string;
  /** 迭代周期（如 "w281：08/19 - 08/25"），空串清除 */
  iterationCycle?: string;
  /** 预期发布时间（YYYY-MM-DD），空串清除 */
  expectedReleaseAt?: string;
  /** 脚本目录：相对 CHECK_SCRIPTS_DIR 的路径，空串清除 */
  scriptsPath?: string;
  /** 飞书通知群：群机器人 webhook 的 secret（粘贴完整地址自动截取），空串清除 */
  feishuWebhook?: string;
  /** 项目描述（Markdown），空串清除 */
  description?: string;
  /** 人员：{frontend?, backend?, qa?}，空值移除键，{} / null 清除 */
  resources?: { frontend?: string; backend?: string; qa?: string } | null;
}

/** AI 用更新（.md 端点）：仅本地字段，刻意不含飞书同步覆盖的字段 */
class UpdateProjectMarkdownDto {
  /** 脚本目录：相对脚本根目录的子目录，空串清除 */
  scriptsPath?: string;
  /** 飞书通知群：webhook secret 或完整 hook 地址（自动截取），空串清除 */
  feishuWebhook?: string;
  /** 项目描述（Markdown），空串清除 */
  description?: string;
  /** 人员：{frontend?, backend?, qa?}，空值移除键，{} / null 清除 */
  resources?: { frontend?: string; backend?: string; qa?: string } | null;
}

class SyncFeishuDto {
  /** true 时忽略时间窗口，全量扫描同步 */
  full?: boolean;
}

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectSyncService: ProjectSyncService,
  ) {}

  @Get()
  findAll(): Promise<Project[]> {
    return this.projectsService.findAll();
  }

  /** Markdown 模糊搜索（须声明在 :id 之前）：按名称匹配 + 创建时间倒序，返回前 5 */
  @Get('search.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  searchMarkdown(@Query('q') q?: string): Promise<string> {
    return this.projectsService.searchMarkdown(q ?? '');
  }

  /** 项目表格分页（须声明在 :id 之前）：page/pageSize/q/iteration/status/type/priority */
  @Get('page')
  findPage(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('iteration') iteration?: string,
    @Query('status') status?: ProjectStatus,
    @Query('type') type?: ProjectType,
    @Query('priority') priority?: string,
  ): Promise<ProjectPage> {
    const query: ProjectPageQuery = {};
    if (page) query.page = +page;
    if (pageSize) query.pageSize = +pageSize;
    if (q) query.q = q;
    if (iteration) query.iteration = iteration;
    if (status) query.status = status;
    if (type) query.type = type;
    if (priority) query.priority = priority;
    return this.projectsService.findPage(query);
  }

  /** 从飞书多维表格同步项目（默认增量：首次近 15 天、后续近 7 天；full=true 全量） */
  @Post('sync-feishu')
  syncFromFeishu(@Body() dto?: SyncFeishuDto): Promise<SyncProjectsResult> {
    return this.projectSyncService.syncFromFeishu(!!dto?.full);
  }

  /** Markdown 视图（须声明在 :id 之前，避免 :id 匹配到带 .md 后缀的路径） */
  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  findOneMarkdown(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.projectsService.findOneMarkdown(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Project> {
    return this.projectsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateProjectDto): Promise<Project> {
    return this.projectsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProjectDto,
  ): Promise<Project> {
    return this.projectsService.update(id, dto);
  }

  /**
   * AI 用：仅本地字段更新并以 Markdown 返回结果（text/markdown）。
   * 可改 脚本目录 / 飞书通知群 / 描述 / 人员，空串清除；用法见项目 .md 视图。
   */
  @Post(':id/update.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  updateMarkdown(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProjectMarkdownDto,
  ): Promise<string> {
    return this.projectsService.updateMarkdown(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.projectsService.remove(id);
  }
}
