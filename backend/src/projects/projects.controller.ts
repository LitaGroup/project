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
} from '@nestjs/common';
import { ProjectStatus, ProjectType } from '../common/enums';
import { Project } from './project.entity';
import { ProjectSyncService, SyncProjectsResult } from './project-sync.service';
import { ProjectsService } from './projects.service';

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
  /** 飞书群机器人 webhook：任务运行结束后推送结果，空串清除 */
  feishuWebhook?: string;
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

  /** 从飞书多维表格增量同步项目（首次取近 15 天更新，后续取近 7 天） */
  @Post('sync-feishu')
  syncFromFeishu(): Promise<SyncProjectsResult> {
    return this.projectSyncService.syncFromFeishu();
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
