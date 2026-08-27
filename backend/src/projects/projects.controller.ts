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
  /** 脚本目录：相对 CHECK_SCRIPTS_DIR 的路径，空串清除 */
  scriptsPath?: string;
  /** 飞书通知群：群机器人 webhook 的 secret（粘贴完整地址自动截取），空串清除 */
  feishuWebhook?: string;
  /** 缺陷多维表格地址：带 table 参数的飞书 wiki/base 链接，空串清除 */
  defectBitableUrl?: string;
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

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.projectsService.remove(id);
  }
}
