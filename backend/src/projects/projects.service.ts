import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as path from 'path';
import { Repository } from 'typeorm';
import { ProjectStatus, ProjectType } from '../common/enums';
import { ChecksService } from '../checks/checks.service';
import { TestsService } from '../tests/tests.service';
import { DocumentsService } from '../documents/documents.service';
import { Project } from './project.entity';

export interface CreateProjectInput {
  name: string;
  type?: ProjectType;
  status?: ProjectStatus;
  expectedReleaseAt?: string;
  description?: string;
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly documentsService: DocumentsService,
    private readonly checksService: ChecksService,
    private readonly testsService: TestsService,
  ) {}

  findAll(): Promise<Project[]> {
    return this.projects.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: number): Promise<Project> {
    const project = await this.projects.findOne({
      where: { id },
      relations: { documents: true, checks: true, tests: true },
    });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  create(input: CreateProjectInput): Promise<Project> {
    return this.projects.save(this.projects.create(input));
  }

  /** Markdown 视图（GET /projects/:id.md）：项目描述 + 文档/检查/测试/任务清单 */
  async findOneMarkdown(id: number): Promise<string> {
    const project = await this.findOne(id);
    const meta = [`- 类型：${project.type}`, `- 状态：${project.status}`];
    if (project.priority) meta.push(`- 优先级：${project.priority}`);
    if (project.expectedReleaseAt) {
      meta.push(`- 预期发布时间：${project.expectedReleaseAt}`);
    }
    if (project.iterationCycle) {
      meta.push(`- 迭代周期：${project.iterationCycle}`);
    }
    if (project.resources) {
      const { frontend, backend, qa } = project.resources;
      if (frontend || backend || qa) {
        meta.push(
          `- 资源：前端 ${frontend ?? '-'} / 后端 ${backend ?? '-'} / 测试 ${qa ?? '-'}`,
        );
      }
    }
    if (project.scriptsPath) meta.push(`- 脚本目录：${project.scriptsPath}`);
    meta.push(`- 更新时间：${project.updatedAt.toISOString()}`);

    const documents = project.documents.map((d) => {
      const parts = [`**${d.type}** [${d.title}](/api/documents/${d.id}.md)`];
      if (d.description) parts.push(d.description);
      if (d.remark) parts.push(`备注：${d.remark}`);
      return `- ${parts.join(' — ')}`;
    });
    const checks = project.checks.map((c) => {
      const parts = [`\`${c.code}\`（脚本：${c.scriptPath}）`];
      if (c.description) parts.push(c.description);
      return `- ${parts.join(' — ')}`;
    });
    const tests = project.tests.map((t) => {
      const parts = [`\`${t.code}\`（脚本：${t.scriptPath}）`];
      if (t.description) parts.push(t.description);
      return `- ${parts.join(' — ')}`;
    });

    return [
      `# ${project.name}`,
      '',
      ...meta,
      '',
      '## 描述',
      '',
      project.description ?? '（暂无）',
      '',
      `## 文档（${project.documents.length}）`,
      '',
      ...(documents.length > 0 ? documents : ['（暂无）']),
      '',
      `## 检查（${project.checks.length}）`,
      '',
      ...(checks.length > 0 ? checks : ['（暂无）']),
      '',
      `## 测试（${project.tests.length}）`,
      '',
      ...(tests.length > 0 ? tests : ['（暂无）']),
      '',
      '## 任务',
      '',
      '（定时任务模块尚未实现）',
      '',
    ].join('\n');
  }

  /** 设置脚本目录（相对 CHECK_SCRIPTS_DIR，空串清除）；登记检查时只在该子目录下扫描 */
  async updateScriptsPath(id: number, scriptsPath: string): Promise<Project> {
    const project = await this.findOne(id);
    const normalized = scriptsPath
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');
    if (
      normalized &&
      (path.isAbsolute(normalized) || normalized.split('/').includes('..'))
    ) {
      throw new BadRequestException(
        '脚本目录必须是相对脚本根目录的路径，如 projects/active/pk',
      );
    }
    project.scriptsPath = normalized || null;
    return this.projects.save(project);
  }

  /**
   * 删除项目。测试库无物理外键（见 AGENTS.md），文档/检查/测试需在应用层先清理。
   */
  async remove(id: number): Promise<void> {
    const project = await this.findOne(id);
    await this.documentsService.removeByProject(project.id);
    await this.checksService.removeByProject(project.id);
    await this.testsService.removeByProject(project.id);
    await this.projects.remove(project);
  }
}
