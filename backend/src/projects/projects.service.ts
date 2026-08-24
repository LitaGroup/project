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
import { Check } from '../checks/check.entity';
import { TestsService } from '../tests/tests.service';
import { Test } from '../tests/test.entity';
import { TasksService } from '../tasks/tasks.service';
import { Task } from '../tasks/task.entity';
import {
  DOCUMENT_LIST_SELECT,
  DocumentsService,
} from '../documents/documents.service';
import { Document } from '../documents/document.entity';
import { Project } from './project.entity';

export interface CreateProjectInput {
  name: string;
  type?: ProjectType;
  status?: ProjectStatus;
  expectedReleaseAt?: string;
  description?: string;
}

/** 编号的自然排序（数字段按数值比较，如 check-2 < check-10） */
const codeCollator = new Intl.Collator('zh-Hans', { numeric: true });

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly documentsService: DocumentsService,
    private readonly checksService: ChecksService,
    private readonly testsService: TestsService,
    private readonly tasksService: TasksService,
  ) {}

  findAll(): Promise<Project[]> {
    return this.projects.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * 项目 + 关联（文档/检查/测试/任务）。
   * 不用 relations 巨型 LEFT JOIN：测试 RDS 上该 JOIN 要 ~2.5s，
   * 拆成并行小查询仅 ~250ms（见 AGENTS.md 工作约定）。
   */
  async findOne(id: number): Promise<Project> {
    const project = await this.projects.findOne({ where: { id } });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    const { manager } = this.projects;
    const [documents, checks, tests, tasks] = await Promise.all([
      // 文档列表不取 longtext 正文（列表展示只需元信息）
      manager.find(Document, {
        where: { projectId: id },
        select: DOCUMENT_LIST_SELECT,
      }),
      manager.find(Check, { where: { projectId: id } }),
      manager.find(Test, { where: { projectId: id } }),
      manager.find(Task, { where: { projectId: id } }),
    ]);
    project.documents = documents;
    project.checks = checks;
    project.tests = tests;
    project.tasks = tasks;
    // 检查/测试按编号自然排序
    project.checks.sort((a, b) => codeCollator.compare(a.code, b.code));
    project.tests.sort((a, b) => codeCollator.compare(a.code, b.code));
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
      parts.push(`运行：\`POST /api/checks/${c.id}/run.md\``);
      return `- ${parts.join(' — ')}`;
    });
    const tests = project.tests.map((t) => {
      const parts = [`\`${t.code}\`（脚本：${t.scriptPath}）`];
      if (t.description) parts.push(t.description);
      parts.push(`运行：\`POST /api/tests/${t.id}/run.md\``);
      return `- ${parts.join(' — ')}`;
    });
    const checkName = (checkId: number) =>
      project.checks.find((c) => c.id === checkId)?.code ?? `#${checkId}`;
    const tasks = project.tasks.map(
      (t) =>
        `- **${t.title}**（cron：\`${t.cron}\`，检查：\`${checkName(t.checkId)}\`${t.enabled ? '' : '，已停用'}）`,
    );

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
      `## 任务（${project.tasks.length}）`,
      '',
      ...(tasks.length > 0 ? tasks : ['（暂无）']),
      '',
      '## AI 操作',
      '',
      '运行检查/测试并流式获取结果（text/markdown，运行中逐行返回脚本输出，结束时附"结果"小节）：',
      '',
      '```bash',
      'curl -N -X POST /api/checks/{checkId}/run.md',
      'curl -N -X POST /api/tests/{testId}/run.md',
      '```',
      '',
    ].join('\n');
  }

  /** 更新项目可编辑字段：脚本目录（scriptsPath）与飞书群机器人 webhook（feishuWebhook），空串清除 */
  async update(
    id: number,
    input: { scriptsPath?: string; feishuWebhook?: string },
  ): Promise<Project> {
    const project = await this.findOne(id);
    if (input.scriptsPath !== undefined) {
      project.scriptsPath = this.normalizeScriptsPath(input.scriptsPath);
    }
    if (input.feishuWebhook !== undefined) {
      project.feishuWebhook = this.normalizeWebhook(input.feishuWebhook);
    }
    return this.projects.save(project);
  }

  /** 脚本目录：相对 CHECK_SCRIPTS_DIR（空串清除）；登记检查时只在该子目录下扫描 */
  private normalizeScriptsPath(scriptsPath: string): string | null {
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
    return normalized || null;
  }

  /** 飞书群机器人 webhook：http(s) 地址，空串清除 */
  private normalizeWebhook(webhook: string): string | null {
    const normalized = webhook.trim();
    if (!normalized) return null;
    if (!/^https?:\/\//.test(normalized)) {
      throw new BadRequestException(
        '飞书 webhook 必须是 http(s) 地址，如 https://open.feishu.cn/open-apis/bot/v2/hook/xxx',
      );
    }
    return normalized;
  }

  /**
   * 删除项目。测试库无物理外键（见 AGENTS.md），文档/检查/测试/任务需在应用层先清理。
   */
  async remove(id: number): Promise<void> {
    const project = await this.findOne(id);
    await this.documentsService.removeByProject(project.id);
    // 任务先于检查清理（任务依赖检查脚本；检查删除时也会再兜底清理）
    await this.tasksService.removeByProject(project.id);
    await this.checksService.removeByProject(project.id);
    await this.testsService.removeByProject(project.id);
    await this.projects.remove(project);
  }
}
