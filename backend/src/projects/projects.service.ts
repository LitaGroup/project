import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as path from 'path';
import { FindOptionsWhere, Like, Repository } from 'typeorm';
import { ProjectStatus, ProjectType } from '../common/enums';
import { ChecksService } from '../checks/checks.service';
import { Check } from '../checks/check.entity';
import { TestsService } from '../tests/tests.service';
import { Test } from '../tests/test.entity';
import { ExportsService } from '../exports/exports.service';
import { Export } from '../exports/export.entity';
import { TasksService } from '../tasks/tasks.service';
import { Task } from '../tasks/task.entity';
import {
  DOCUMENT_LIST_SELECT,
  DocumentsService,
} from '../documents/documents.service';
import { Document } from '../documents/document.entity';
import { DEFECT_LIST_SELECT, DefectsService } from '../defects/defects.service';
import { Defect } from '../defects/defect.entity';
import { AppVersionsService } from '../app-versions/app-versions.service';
import { runSummaryLine, RunDetailLike } from '../common/run-markdown';
import { Project } from './project.entity';

export interface CreateProjectInput {
  name: string;
  type?: ProjectType;
  status?: ProjectStatus;
  expectedReleaseAt?: string;
  description?: string;
}

/** 项目表格分页查询参数（GET /projects/page） */
export interface ProjectPageQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  iteration?: string;
  status?: ProjectStatus;
  type?: ProjectType;
  priority?: string;
}

/** 项目表格分页响应（items 只含当前页，total/iterations/priorities 供分页与筛选用） */
export interface ProjectPage {
  items: Project[];
  total: number;
  iterations: string[];
  priorities: string[];
}

/** 编号的自然排序（数字段按数值比较，如 check-2 < check-10） */
const codeCollator = new Intl.Collator('zh-Hans', { numeric: true });

/**
 * 项目列表列（GET /projects 及全局列表的"项目"下拉都用它）：
 * 排除 longtext description 与只在详情页用到的字段，缩少 3.6k 条记录的网络/序列化开销。
 */
const PROJECT_LIST_SELECT = {
  id: true,
  name: true,
  type: true,
  status: true,
  expectedReleaseAt: true,
  priority: true,
  iterationCycle: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly documentsService: DocumentsService,
    private readonly checksService: ChecksService,
    private readonly testsService: TestsService,
    private readonly exportsService: ExportsService,
    private readonly tasksService: TasksService,
    private readonly defectsService: DefectsService,
    private readonly appVersionsService: AppVersionsService,
  ) {}

  findAll(): Promise<Project[]> {
    return this.projects.find({
      select: PROJECT_LIST_SELECT,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 项目表格分页（GET /projects/page）：只返回当前页 + total + 筛选项取值。
   * 避免一次把 3.6k 条项目全量拉回（远程 RDS 上全量扫描 ~1s+，分页 ~100ms）。
   */
  async findPage(query: ProjectPageQuery): Promise<ProjectPage> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const where: FindOptionsWhere<Project> = {};
    if (query.q) where.name = Like(`%${query.q}%`);
    if (query.iteration) where.iterationCycle = query.iteration;
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.priority) where.priority = query.priority;
    const [items, total, iterations, priorities] = await Promise.all([
      this.projects.find({
        where,
        select: PROJECT_LIST_SELECT,
        order: { createdAt: 'DESC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.projects.count({ where }),
      this.distinctColumn('iterationCycle'),
      this.distinctColumn('priority'),
    ]);
    return { items, total, iterations, priorities };
  }

  /** 某列的去重取值（供筛选下拉），仅返回非空值 */
  private async distinctColumn(
    column: 'iterationCycle' | 'priority',
  ): Promise<string[]> {
    const rows = await this.projects
      .createQueryBuilder('p')
      .select(`DISTINCT p.${column}`, 'v')
      .where(`p.${column} IS NOT NULL`)
      .andWhere(`p.${column} <> ''`)
      .orderBy('v', 'ASC')
      .getRawMany<{ v: string }>();
    return rows.map((r) => r.v);
  }

  /**
   * 项目 + 关联（文档/检查/测试/导出/任务/缺陷）。
   * 不用 relations 巨型 LEFT JOIN：测试 RDS 上该 JOIN 要 ~2.5s，
   * 拆成并行小查询仅 ~250ms（见 AGENTS.md 工作约定）。
   */
  async findOne(id: number): Promise<Project> {
    const project = await this.projects.findOne({ where: { id } });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    const { manager } = this.projects;
    const [documents, checks, tests, exportList, tasks, defects] =
      await Promise.all([
        // 文档列表不取 longtext 正文（列表展示只需元信息）
        manager.find(Document, {
          where: { projectId: id },
          select: DOCUMENT_LIST_SELECT,
        }),
        manager.find(Check, { where: { projectId: id } }),
        manager.find(Test, { where: { projectId: id } }),
        manager.find(Export, { where: { projectId: id } }),
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
    project.exports = exportList;
    project.tasks = tasks;
    project.defects = defects;
    // 检查/测试/导出按编号自然排序
    project.checks.sort((a, b) => codeCollator.compare(a.code, b.code));
    project.tests.sort((a, b) => codeCollator.compare(a.code, b.code));
    project.exports.sort((a, b) => codeCollator.compare(a.code, b.code));
    return project;
  }

  create(input: CreateProjectInput): Promise<Project> {
    return this.projects.save(this.projects.create(input));
  }

  /**
   * 项目 Markdown 模糊搜索（GET /projects/search.md）：
   * LIKE 捞候选后在应用层按匹配度分级排序（精确 > 前缀 > 包含），同级创建时间倒序，取前 5。
   */
  async searchMarkdown(query: string): Promise<string> {
    const q = query.trim();
    if (!q) {
      return [
        '# 项目搜索',
        '',
        '缺少查询参数 `q`，用法：`GET /api/projects/search.md?q={项目名称关键词}`',
        '',
      ].join('\n');
    }
    const candidates = await this.projects.find({
      select: PROJECT_LIST_SELECT,
      where: { name: Like(`%${q}%`) },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    const lower = q.toLowerCase();
    const rank = (name: string): number => {
      const n = name.toLowerCase();
      if (n === lower) return 0;
      if (n.startsWith(lower)) return 1;
      return 2;
    };
    const matched = candidates
      .map((p) => ({ p, r: rank(p.name) }))
      .sort(
        (a, b) =>
          a.r - b.r || b.p.createdAt.getTime() - a.p.createdAt.getTime(),
      )
      .slice(0, 5)
      .map(({ p }) => p);
    const items = matched.map(
      (p) =>
        `- **${p.name}**（${p.type} / ${p.status}）— id：${p.id}，更新：${p.updatedAt.toISOString()} — [详情](/api/projects/${p.id}.md)`,
    );
    return [
      `# 项目搜索：${q}`,
      '',
      `共 ${candidates.length} 个命中（按匹配度 + 创建时间倒序），返回前 ${items.length} 个：`,
      '',
      ...(items.length > 0 ? items : ['（无命中）']),
      '',
    ].join('\n');
  }

  /** Markdown 视图（GET /projects/:id.md）：项目描述 + 文档/检查/测试/导出/任务清单（含运行信息） */
  async findOneMarkdown(id: number): Promise<string> {
    const project = await this.findOne(id);
    // 并行补齐运行信息：各检查/测试/导出/任务的最近几次运行 + 任务视图（下次执行时间）
    const [checkRuns, testRuns, exportRuns, taskRuns, taskViews] =
      await Promise.all([
        this.checksService.recentRunsByCheckIds(
          project.checks.map((c) => c.id),
        ),
        this.testsService.recentRunsByTestIds(project.tests.map((t) => t.id)),
        this.exportsService.recentRunsByExportIds(
          project.exports.map((e) => e.id),
        ),
        this.checksService.recentRunsByTaskIds(project.tasks.map((t) => t.id)),
        this.tasksService.findByProject(project.id),
      ]);
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
    /** 检查/测试/导出条目：编号、描述、运行命令、最近结果、最近记录（多行列表项，用换行连接） */
    const runEntry = (
      kind: 'checks' | 'tests' | 'exports',
      item: {
        id: number;
        code: string;
        scriptPath: string;
        description: string | null;
      },
      runs: Pick<
        RunDetailLike,
        'id' | 'status' | 'success' | 'fail' | 'skip'
      >[],
    ): string => {
      const head = `- \`${item.code}\`（脚本：${item.scriptPath}）`;
      const lines = [item.description ? `${head}— ${item.description}` : head];
      lines.push(`  - 运行命令：\`POST /api/${kind}/${item.id}/run.md\``);
      if (runs.length > 0) {
        const [latest, ...rest] = runs;
        lines.push(
          `  - 最近一次：#${latest.id} ${runSummaryLine(latest)} — 详情：\`GET /api/${kind}/runs/${latest.id}.md\``,
        );
        if (rest.length > 0) {
          lines.push(
            `  - 最近记录：${rest.map((r) => `#${r.id} ${runSummaryLine(r)}`).join('、')}`,
          );
        }
      }
      lines.push(`  - 运行历史：\`GET /api/${kind}/${item.id}/runs\``);
      return lines.join('\n');
    };
    const checks = project.checks.map((c) =>
      runEntry('checks', c, checkRuns.get(c.id) ?? []),
    );
    const tests = project.tests.map((t) =>
      runEntry('tests', t, testRuns.get(t.id) ?? []),
    );
    const exports = project.exports.map((e) =>
      runEntry('exports', e, exportRuns.get(e.id) ?? []),
    );
    const checkName = (checkId: number) =>
      project.checks.find((c) => c.id === checkId)?.code ?? `#${checkId}`;
    const tasks = project.tasks.map((t) => {
      const view = taskViews.find((v) => v.id === t.id);
      const lines = [
        `- **${t.title}**（cron：\`${t.cron}\`，检查：\`${checkName(t.checkId)}\`${t.enabled ? '' : '，已停用'}）`,
        `  - 上次执行：${t.lastRunAt ? new Date(t.lastRunAt).toISOString() : '未执行过'}；下次执行：${view?.nextRunAt ?? '-'}`,
      ];
      const lastRun = (taskRuns.get(t.id) ?? [])[0];
      if (lastRun) {
        lines.push(
          `  - 上次结果：#${lastRun.id} ${runSummaryLine(lastRun)} — 详情：\`GET /api/checks/runs/${lastRun.id}.md\``,
        );
      }
      lines.push(
        `  - 执行地址：\`POST /api/tasks/${t.id}/run.md\`；运行记录：\`GET /api/tasks/${t.id}/runs\``,
      );
      return lines.join('\n');
    });
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
      `## 导出（${project.exports.length}）`,
      '',
      ...(exports.length > 0 ? exports : ['（暂无）']),
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
      '搜索项目：`GET /api/projects/search.md?q={名称关键词}`（匹配度 + 创建时间倒序，前 5）',
      '',
      '运行检查/测试/导出/任务并流式获取结果（text/markdown，运行中逐行返回脚本输出，结束时附"结果"小节）：',
      '',
      '```bash',
      'curl -N -X POST /api/checks/{checkId}/run.md',
      'curl -N -X POST /api/tests/{testId}/run.md',
      'curl -N -X POST /api/exports/{exportId}/run.md',
      'curl -N -X POST /api/tasks/{taskId}/run.md',
      '```',
      '',
      '运行详情（Markdown 视图）与系统设置：',
      '',
      '```bash',
      'curl /api/checks/runs/{runId}.md   # 检查/任务运行的详情（Test 同理：/api/tests/runs/{runId}.md）',
      'curl /api/exports/runs/{runId}.md  # 导出运行的详情（含产物文件下载链接）',
      'curl /api/settings.md              # 平台设置（环境、目录、域名、agent 状态等）',
      'curl -N -X POST /api/settings/scripts/pull.md  # 更新脚本仓库（流式返回 git 输出与结果）',
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

  /** 更新项目可编辑字段：类型/状态/优先级/迭代周期/预期发布时间 + 脚本目录（scriptsPath）、飞书群机器人 webhook（feishuWebhook）、缺陷多维表格地址（defectBitableUrl）、描述（description），空串清除。注意：飞书同步项目的同步字段（类型/状态/优先级/迭代/预期发布）会在下次同步时被飞书侧覆盖 */
  async update(
    id: number,
    input: {
      type?: ProjectType;
      status?: ProjectStatus;
      priority?: string;
      iterationCycle?: string;
      expectedReleaseAt?: string;
      scriptsPath?: string;
      feishuWebhook?: string;
      defectBitableUrl?: string;
      description?: string;
    },
  ): Promise<Project> {
    const project = await this.findOne(id);
    if (input.type !== undefined) {
      if (!Object.values(ProjectType).includes(input.type)) {
        throw new BadRequestException(`非法的项目类型：${input.type}`);
      }
      project.type = input.type;
    }
    if (input.status !== undefined) {
      if (!Object.values(ProjectStatus).includes(input.status)) {
        throw new BadRequestException(`非法的项目状态：${input.status}`);
      }
      project.status = input.status;
    }
    if (input.priority !== undefined) {
      project.priority = this.normalizeShortText(input.priority, 20, '优先级');
    }
    if (input.iterationCycle !== undefined) {
      project.iterationCycle = this.normalizeShortText(
        input.iterationCycle,
        50,
        '迭代周期',
      );
    }
    if (input.expectedReleaseAt !== undefined) {
      const v = input.expectedReleaseAt.trim();
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        throw new BadRequestException('预期发布时间须为 YYYY-MM-DD 格式');
      }
      project.expectedReleaseAt = v || null;
    }
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
    if (input.description !== undefined) {
      project.description = input.description.trim() || null;
    }
    return this.projects.save(project);
  }

  /** 短文本字段（优先级/迭代周期）：trim，空串清除，超长拒绝 */
  private normalizeShortText(
    value: string,
    max: number,
    label: string,
  ): string | null {
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > max) {
      throw new BadRequestException(`${label}长度不能超过 ${max} 个字符`);
    }
    return normalized;
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
   * 删除项目。测试库无物理外键（见 AGENTS.md），文档/检查/测试/导出/任务需在应用层先清理。
   */
  async remove(id: number): Promise<void> {
    const project = await this.findOne(id);
    await this.documentsService.removeByProject(project.id);
    await this.defectsService.removeByProject(project.id);
    // 任务先于检查清理（任务依赖检查脚本；检查删除时也会再兜底清理）
    await this.tasksService.removeByProject(project.id);
    await this.checksService.removeByProject(project.id);
    await this.testsService.removeByProject(project.id);
    await this.exportsService.removeByProject(project.id);
    await this.appVersionsService.removeByProject(project.id);
    await this.projects.remove(project);
  }
}
