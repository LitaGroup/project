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
import { DEFECT_LIST_SELECT, DefectsService } from '../defects/defects.service';
import { Defect } from '../defects/defect.entity';
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
    private readonly defectsService: DefectsService,
  ) {}

  findAll(): Promise<Project[]> {
    return this.projects.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * 项目 + 关联（文档/检查/测试/任务/缺陷）。
   * 不用 relations 巨型 LEFT JOIN：测试 RDS 上该 JOIN 要 ~2.5s，
   * 拆成并行小查询仅 ~250ms（见 AGENTS.md 工作约定）。
   */
  async findOne(id: number): Promise<Project> {
    const project = await this.projects.findOne({ where: { id } });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    const { manager } = this.projects;
    const [documents, checks, tests, tasks, defects] = await Promise.all([
      // 文档列表不取 longtext 正文（列表展示只需元信息）
      manager.find(Document, {
        where: { projectId: id },
        select: DOCUMENT_LIST_SELECT,
      }),
      manager.find(Check, { where: { projectId: id } }),
      manager.find(Test, { where: { projectId: id } }),
      manager.find(Task, { where: { projectId: id } }),
      // 缺陷列表不取 description/images（详情经 GET /defects/:id 单独加载）
      manager.find(Defect, {
        where: { projectId: id },
        select: DEFECT_LIST_SELECT,
        order: { updatedAt: 'DESC' },
      }),
    ]);
    project.documents = documents;
    project.checks = checks;
    project.tests = tests;
    project.tasks = tasks;
    project.defects = defects;
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
    const defects = project.defects.map((d) => {
      const parts = [`**${d.status}** ${d.title}`];
      if (d.platform) parts.push(`端：${d.platform}`);
      if (d.assignee) parts.push(`人员：${d.assignee}`);
      if (d.testScript) parts.push(`测试脚本：${d.testScript}`);
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
      `## 任务（${project.tasks.length}）`,
      '',
      ...(tasks.length > 0 ? tasks : ['（暂无）']),
      '',
      `## 缺陷（${project.defects.length}）`,
      '',
      ...(defects.length > 0 ? defects : ['（暂无）']),
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
      '缺陷（与项目设置的飞书多维表格双向绑定）：',
      '',
      '```bash',
      "curl -X POST /api/defects/sync -H 'Content-Type: application/json' -d '{\"projectId\": {id}}'  # 从飞书全量同步（覆盖本地）",
      'curl -X PATCH /api/defects/{defectId} -H \'Content-Type: application/json\' -d \'{"status": "fixed"}\'  # 改状态（异步回写飞书；有测试脚本时须先验证通过）',
      '```',
      '',
    ].join('\n');
  }

  /** 更新项目可编辑字段：脚本目录（scriptsPath）、飞书群机器人 webhook（feishuWebhook）、缺陷多维表格地址（defectBitableUrl），空串清除 */
  async update(
    id: number,
    input: {
      scriptsPath?: string;
      feishuWebhook?: string;
      defectBitableUrl?: string;
    },
  ): Promise<Project> {
    const project = await this.findOne(id);
    if (input.scriptsPath !== undefined) {
      project.scriptsPath = this.normalizeScriptsPath(input.scriptsPath);
    }
    if (input.feishuWebhook !== undefined) {
      project.feishuWebhook = this.normalizeWebhook(input.feishuWebhook);
    }
    if (input.defectBitableUrl !== undefined) {
      project.defectBitableUrl = this.normalizeDefectBitableUrl(
        input.defectBitableUrl,
      );
    }
    return this.projects.save(project);
  }

  /** 缺陷多维表格地址：飞书 wiki/base 链接且须带 table 参数；空串清除 */
  private normalizeDefectBitableUrl(url: string): string | null {
    const normalized = url.trim();
    if (!normalized) return null;
    const isFeishuTable =
      /(?:feishu\.cn|larksuite\.com)\/(wiki|base)\/[A-Za-z0-9]+/.test(
        normalized,
      ) && /[?&]table=[A-Za-z0-9]+/.test(normalized);
    if (!isFeishuTable) {
      throw new BadRequestException(
        '缺陷多维表格地址必须是带 table 参数的飞书 wiki/base 链接，如 https://xxx.feishu.cn/wiki/XXX?table=tblXXX&view=vewXXX',
      );
    }
    return normalized;
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

  /** 飞书通知群：只存 webhook 的 secret 部分；粘贴完整 hook 地址时自动截取，空串清除 */
  private normalizeWebhook(webhook: string): string | null {
    let normalized = webhook.trim();
    if (!normalized) return null;
    const hookMatch = normalized.match(/\/hook\/([0-9a-z-]+)\/?$/i);
    if (hookMatch) normalized = hookMatch[1];
    if (!/^[0-9a-z-]+$/i.test(normalized)) {
      throw new BadRequestException(
        '飞书通知群只需填写 webhook 地址的 secret 部分，如 e09e9672-1f50-4b65-a181-8750bae489fc',
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
    await this.defectsService.removeByProject(project.id);
    // 任务先于检查清理（任务依赖检查脚本；检查删除时也会再兜底清理）
    await this.tasksService.removeByProject(project.id);
    await this.checksService.removeByProject(project.id);
    await this.testsService.removeByProject(project.id);
    await this.projects.remove(project);
  }
}
