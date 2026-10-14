import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as path from 'path';
import { FindOptionsSelect, In, Repository } from 'typeorm';
import { DefectPriority, DefectStatus } from '../common/enums';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { Project } from '../projects/project.entity';
import { TestRun } from '../tests/test-run.entity';
import { TestsService } from '../tests/tests.service';
import {
  DefectChangeRecord,
  DEFECT_RECORD_SOURCES,
} from './defect-change-record.entity';
import { Defect } from './defect.entity';

/** 图片上限（单条缺陷最多 9 张，经 POST /api/images 上传） */
const MAX_IMAGES = 9;

export const DEFECT_LIST_SELECT: FindOptionsSelect<Defect> = {
  id: true,
  platform: true,
  priority: true,
  expected: true,
  actual: true,
  images: true,
  status: true,
  testScript: true,
  projectId: true,
  fixedAt: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
};

export interface CreateDefectInput {
  projectId: number;
  /** 预期功能描述（必填） */
  expected: string;
  /** 实际结果描述（必填） */
  actual: string;
  /** 端：前端/后端/APP端/未知（默认） */
  platform?: string;
  /** 优先级：高/中/低（默认中） */
  priority?: string;
  /** 图片：/images/... 路径数组（POST /api/images 上传后返回的 url），最多 9 张 */
  images?: string[];
  /** 用例脚本：相对脚本根目录的 .test.ts 路径 */
  testScript?: string;
}

/** 变更记录来源：录入（前端表单）/ AI（.md 接口）/ 自动（测试运行流转） */
export type DefectRecordSource = (typeof DEFECT_RECORD_SOURCES)[number];

export interface UpdateDefectInput {
  platform?: string;
  priority?: string;
  status?: string;
  expected?: string;
  actual?: string;
  /** 图片：/images/... 路径数组，全量覆盖（空数组清除） */
  images?: string[];
  testScript?: string;
  /** 变更内容：状态变更并入状态记录，否则单独记一条内容变更记录（可空） */
  changeContent?: string;
  /** 本次变更的备注信息 */
  changeRemark?: string;
}

export interface ChangeStatusInput {
  /** 目标状态：开放/修复/关闭 */
  status: string;
  /** 备注信息（写入变更记录） */
  remark?: string;
  /** 变更内容（缺省生成"状态变更：X → Y"） */
  content?: string;
}

export interface CreateRecordInput {
  /** 变更内容 */
  content: string;
  /** 备注信息 */
  remark?: string;
}

/**
 * 平台侧端取值：只保留 前端/后端/APP端/未知（默认）。
 */
export const DEFECT_PLATFORMS = ['前端', '后端', 'APP端', '未知'] as const;

/** Markdown 表格单元格转义（换行与竖线） */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

/** 缺陷单行摘要（frontmatter title / 列表展示用）：预期功能描述折行截断 */
function defectLabel(expected: string | null | undefined): string {
  const oneLine = (expected ?? '').replace(/\s*\n\s*/g, ' ').trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine;
}

@Injectable()
export class DefectsService implements OnModuleInit {
  constructor(
    @InjectRepository(Defect)
    private readonly defects: Repository<Defect>,
    @InjectRepository(DefectChangeRecord)
    private readonly records: Repository<DefectChangeRecord>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly testsService: TestsService,
  ) {}

  onModuleInit(): void {
    // 脚本回归通过后自动把关联"修复"态缺陷流转为"关闭"（脚本来源闭环）
    this.testsService.onRunFinalized(
      (run) => void this.handleTestRunFinal(run),
    );
  }

  /** 按项目列出缺陷；不传 projectId 时返回全部（全局列表页用）。不含大字段 */
  findByProject(projectId?: number): Promise<Defect[]> {
    return this.defects.find({
      where: projectId === undefined ? {} : { projectId },
      order: { updatedAt: 'DESC' },
      select: DEFECT_LIST_SELECT,
    });
  }

  async findOne(id: number): Promise<Defect> {
    const defect = await this.defects.findOne({ where: { id } });
    if (!defect) throw new NotFoundException(`Defect ${id} not found`);
    return defect;
  }

  /** 变更记录列表（倒序） */
  listRecords(defectId: number): Promise<DefectChangeRecord[]> {
    return this.records.find({
      where: { defectId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  /** 追加一条变更记录（手动：录入/AI），status 取缺陷当前状态 */
  async addRecord(
    id: number,
    input: CreateRecordInput,
    source: DefectRecordSource = '录入',
  ): Promise<DefectChangeRecord> {
    const content = (input.content ?? '').trim();
    if (!content) throw new BadRequestException('变更内容不能为空');
    const defect = await this.findOne(id);
    return this.saveRecord(defect, { content, remark: input.remark, source });
  }

  /** AI 用：追加变更记录并返回 Markdown 结果 */
  async addRecordMarkdown(
    id: number,
    input: CreateRecordInput,
  ): Promise<string> {
    const record = await this.addRecord(id, input, 'AI');
    return [
      mdFrontmatter({ update: record.createdAt, title: record.content }),
      '# 变更记录已添加',
      '',
      `- 缺陷 ID：${record.defectId}`,
      `- 变更内容：${record.content}`,
      `- 备注：${record.remark ?? '—'}`,
      `- 状态：${record.status}`,
      `- 来源：${record.source}`,
      `- 时间：${beijingTime(record.createdAt)}`,
      `- 阅读地址：GET /api/defects/${record.defectId}.md`,
      '',
    ].join('\n');
  }

  /**
   * 专用状态变更：校验 → 时间戳维护 → 落库 → 记录变更记录。
   * 状态与当前一致时幂等返回（changed=false，不记录）；改"修复"同样校验用例最近运行。
   */
  async changeStatus(
    id: number,
    input: ChangeStatusInput,
    source: DefectRecordSource = '录入',
  ): Promise<{ defect: Defect; changed: boolean }> {
    const allowed = Object.values(DefectStatus) as string[];
    if (!allowed.includes(input.status)) {
      throw new BadRequestException(`状态只能是：${allowed.join(' / ')}`);
    }
    const defect = await this.findOne(id);
    if (input.status === defect.status) return { defect, changed: false };
    const prev = defect.status;
    defect.status = input.status;
    this.applyStatusTimestamps(defect);
    const saved = await this.defects.save(defect);
    await this.saveRecord(saved, {
      content: input.content?.trim() || `状态变更：${prev} → ${saved.status}`,
      remark: input.remark,
      source,
    });
    return { defect: saved, changed: true };
  }

  /** AI 用：状态变更并返回 Markdown 结果（状态未变化时如实说明） */
  async changeStatusMarkdown(
    id: number,
    input: ChangeStatusInput,
  ): Promise<string> {
    const { defect, changed } = await this.changeStatus(id, input, 'AI');
    if (!changed) {
      return [
        mdFrontmatter({
          update: defect.updatedAt,
          title: defectLabel(defect.expected),
        }),
        '# 状态未变化',
        '',
        `- ID：${defect.id}`,
        `- 当前状态：${defect.status}（与目标状态一致，未生成变更记录）`,
        '',
      ].join('\n');
    }
    return [
      mdFrontmatter({
        update: defect.updatedAt,
        title: defectLabel(defect.expected),
      }),
      '# 缺陷状态已变更',
      '',
      `- ID：${defect.id}`,
      `- 预期：${defectLabel(defect.expected)}`,
      `- 状态：${defect.status}`,
      `- 修复时间：${defect.fixedAt ? beijingTime(defect.fixedAt) : '—'}`,
      `- 验证时间：${defect.verifiedAt ? beijingTime(defect.verifiedAt) : '—'}`,
      `- 阅读地址：GET /api/defects/${defect.id}.md`,
      '',
    ].join('\n');
  }

  /** Markdown 视图（GET /api/defects/:id.md）：元信息 + 预期/实际/图片 + 变更记录 + AI 操作 */
  async findOneMarkdown(id: number): Promise<string> {
    const defect = await this.findOne(id);
    const project = await this.projects.findOne({
      where: { id: defect.projectId },
      select: { id: true, name: true },
    });
    const meta = [
      `- ID：${defect.id}`,
      `- 项目：${project ? `${project.name}（${defect.projectId}）` : defect.projectId}`,
      `- 状态：${defect.status}`,
      `- 端：${defect.platform ?? '—'}`,
      `- 优先级：${defect.priority}`,
      `- 用例：${defect.testScript ? `\`${defect.testScript}\`` : '—'}`,
      `- 创建时间：${defect.createdAt.toISOString()}`,
      `- 修复时间：${defect.fixedAt ? defect.fixedAt.toISOString() : '—'}`,
      `- 验证时间：${defect.verifiedAt ? defect.verifiedAt.toISOString() : '—'}`,
      `- 更新时间：${defect.updatedAt.toISOString()}`,
    ];
    const lines = [
      mdFrontmatter({
        update: defect.updatedAt,
        title: defectLabel(defect.expected),
      }),
      `# ${defectLabel(defect.expected) || `缺陷 ${defect.id}`}`,
      '',
      ...meta,
      '',
      '## 预期功能描述',
      '',
      defect.expected,
      '',
      '## 实际结果描述',
      '',
      defect.actual,
    ];
    if (defect.images && defect.images.length > 0) {
      lines.push('', '## 图片', '');
      for (const img of defect.images) {
        lines.push(`![缺陷图片](${img})`);
      }
    }
    const records = await this.listRecords(defect.id);
    if (records.length > 0) {
      lines.push('', '## 变更记录', '');
      lines.push(
        '| 时间 | 状态 | 来源 | 变更内容 | 备注 |',
        '| --- | --- | --- | --- | --- |',
      );
      for (const r of records) {
        lines.push(
          `| ${beijingTime(r.createdAt)} | ${r.status} | ${r.source} | ${escapeCell(r.content)} | ${escapeCell(r.remark ?? '-')} |`,
        );
      }
    }
    lines.push(
      '',
      '## AI 操作',
      '',
      '```bash',
      `curl -X POST /api/defects/${defect.id}/status.md -H 'Content-Type: application/json' -d '{"status": "修复", "remark": "备注"}'  # 状态变更（开放/修复/关闭），自动记录`,
      `curl -X POST /api/defects/${defect.id}/records.md -H 'Content-Type: application/json' -d '{"content": "变更内容", "remark": "备注"}'  # 追加变更记录`,
      `curl -X POST /api/defects/${defect.id}/update.md -H 'Content-Type: application/json' -d '{"actual": "新的实际结果", "changeContent": "更新说明"}'  # 更新（changeContent/changeRemark 并入变更记录）`,
      `curl -X POST /api/defects/${defect.id}/delete.md  # 删除`,
      `curl -X POST /api/defects/${defect.id}/verify  # 运行验证（须已配置用例脚本）`,
      '```',
      '',
    );
    return lines.join('\n');
  }

  /** Markdown 视图（GET /api/defects.md）：缺陷清单，供 AI 跨项目检索 */
  async listMarkdown(filter: {
    projectId?: number;
    status?: string;
    priority?: string;
    q?: string;
  }): Promise<string> {
    const all = await this.findByProject(filter.projectId);
    const q = filter.q?.trim().toLowerCase();
    const rows = all.filter(
      (d) =>
        (!filter.status || d.status === filter.status) &&
        (!filter.priority || d.priority === filter.priority) &&
        (!q ||
          d.expected.toLowerCase().includes(q) ||
          d.actual.toLowerCase().includes(q)),
    );
    const names = await this.projectNames(rows.map((d) => d.projectId));
    const lines = [
      mdFrontmatter({ title: '缺陷清单' }),
      '# 缺陷清单',
      '',
      `- 共 ${rows.length} 条${filter.projectId ? `（项目 ${filter.projectId}）` : ''}`,
      '',
      '| ID | 预期 | 端 | 状态 | 优先级 | 项目 |',
      '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const d of rows) {
      lines.push(
        `| [${d.id}](/api/defects/${d.id}.md) | ${escapeCell(defectLabel(d.expected))} | ${d.platform ?? '-'} | ${d.status} | ${d.priority} | ${escapeCell(names.get(d.projectId) ?? `#${d.projectId}`)} |`,
      );
    }
    if (rows.length === 0) {
      lines.push('| - | （无匹配缺陷） | - | - | - | - |');
    }
    lines.push(
      '',
      '## 详情',
      '',
      '表格 ID 列即详情链接；单条完整内容（预期/实际/图片/变更记录）见 `GET /api/defects/{id}.md`',
      '',
      '## AI 操作',
      '',
      '```bash',
      'curl -X POST /api/defects/create.md -H \'Content-Type: application/json\' -d \'{"projectId": 123, "expected": "预期功能描述", "actual": "实际结果描述", "platform": "前端", "priority": "高"}\'  # 新建（platform 可选：前端/后端/APP端/未知；priority 可选：高/中/低；images 传 /images/... 数组，testScript 可选）',
      'curl -X POST /api/defects/{id}/status.md -H \'Content-Type: application/json\' -d \'{"status": "修复", "remark": "备注"}\'  # 状态变更（开放/修复/关闭），自动记录',
      'curl -X POST /api/defects/{id}/records.md -H \'Content-Type: application/json\' -d \'{"content": "变更内容", "remark": "备注"}\'  # 追加变更记录',
      'curl -X POST /api/defects/{id}/delete.md  # 删除',
      '```',
      '',
      '创建/更新也支持 `POST /api/defects` 与 `PATCH /api/defects/{id}`（返回 JSON）。',
      '',
    );
    return lines.join('\n');
  }

  /** AI 用：创建缺陷并返回 Markdown 结果 */
  async createMarkdown(input: CreateDefectInput): Promise<string> {
    const defect = await this.create(input, 'AI');
    return this.renderMutationMarkdown('创建', defect);
  }

  /** AI 用：更新缺陷并返回 Markdown 结果 */
  async updateMarkdown(id: number, input: UpdateDefectInput): Promise<string> {
    const defect = await this.update(id, input, 'AI');
    return this.renderMutationMarkdown('更新', defect);
  }

  /** AI 用：删除缺陷并返回 Markdown 结果 */
  async removeMarkdown(id: number): Promise<string> {
    const defect = await this.findOne(id);
    await this.remove(id);
    return [
      mdFrontmatter({ title: defectLabel(defect.expected) }),
      '# 缺陷已删除',
      '',
      `- ID：${defect.id}`,
      `- 预期：${defectLabel(defect.expected)}`,
      '',
    ].join('\n');
  }

  /** 变更类操作的 Markdown 结果（创建/更新共用） */
  private renderMutationMarkdown(action: string, defect: Defect): string {
    return [
      mdFrontmatter({
        update: defect.updatedAt,
        title: defectLabel(defect.expected),
      }),
      `# 缺陷已${action}`,
      '',
      `- ID：${defect.id}`,
      `- 预期：${defectLabel(defect.expected)}`,
      `- 状态：${defect.status}`,
      `- 项目：${defect.projectId}`,
      `- 阅读地址：GET /api/defects/${defect.id}.md`,
      '',
    ].join('\n');
  }

  /** 批量取项目名（Markdown 清单用） */
  private async projectNames(ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids)];
    const map = new Map<number, string>();
    if (unique.length === 0) return map;
    const projects = await this.projects.find({
      where: { id: In(unique) },
      select: { id: true, name: true },
    });
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }

  /** 人工/AI 生成缺陷，创建后自动记一条"创建缺陷"变更记录。预期与实际为必填 */
  async create(
    input: CreateDefectInput,
    recordSource: DefectRecordSource = '录入',
  ): Promise<Defect> {
    const expected = (input.expected ?? '').trim();
    const actual = (input.actual ?? '').trim();
    if (!expected) throw new BadRequestException('预期功能描述不能为空');
    if (!actual) throw new BadRequestException('实际结果描述不能为空');
    const project = await this.projects.findOne({
      where: { id: input.projectId },
    });
    if (!project)
      throw new NotFoundException(`Project ${input.projectId} not found`);
    const saved = await this.defects.save(
      this.defects.create({
        projectId: input.projectId,
        expected,
        actual,
        status: DefectStatus.OPEN,
        platform:
          input.platform !== undefined
            ? this.normalizePlatform(input.platform)
            : null,
        priority:
          input.priority !== undefined
            ? this.normalizePriority(input.priority)
            : DefectPriority.MEDIUM,
        images:
          input.images !== undefined
            ? this.normalizeImages(input.images)
            : null,
        testScript:
          input.testScript !== undefined
            ? this.normalizeTestScript(input.testScript)
            : null,
      }),
    );
    await this.saveRecord(saved, { content: '创建缺陷', source: recordSource });
    return saved;
  }

  /**
   * 更新缺陷（端/状态/预期/实际/图片/用例脚本）。
   * 标记"修复"无前置校验（表示研发已修复，等待脚本回归验证）；
   * 状态变更时维护修复/验证时间并记一条变更记录（changeContent 缺省"状态变更：X → Y"）；
   * 无状态变更但传了 changeContent/changeRemark 时记一条内容变更记录。
   */
  async update(
    id: number,
    input: UpdateDefectInput,
    recordSource: DefectRecordSource = '录入',
  ): Promise<Defect> {
    const defect = await this.findOne(id);
    // 端归一化（空串/未识别一律归为"未知"）
    const nextPlatform =
      input.platform !== undefined
        ? this.normalizePlatform(input.platform)
        : defect.platform;
    const statusChanged =
      input.status !== undefined && input.status !== defect.status;
    const prevStatus = defect.status;

    if (input.status !== undefined) {
      const allowed = Object.values(DefectStatus) as string[];
      if (!allowed.includes(input.status)) {
        throw new BadRequestException(`状态只能是：${allowed.join(' / ')}`);
      }
      defect.status = input.status;
      this.applyStatusTimestamps(defect);
    }
    if (input.platform !== undefined) {
      defect.platform = nextPlatform;
    }
    if (input.priority !== undefined) {
      defect.priority = this.normalizePriority(input.priority);
    }
    if (input.expected !== undefined) {
      const expected = input.expected.trim();
      if (!expected) throw new BadRequestException('预期功能描述不能为空');
      defect.expected = expected;
    }
    if (input.actual !== undefined) {
      const actual = input.actual.trim();
      if (!actual) throw new BadRequestException('实际结果描述不能为空');
      defect.actual = actual;
    }
    if (input.images !== undefined) {
      defect.images = this.normalizeImages(input.images);
    }
    if (input.testScript !== undefined) {
      defect.testScript = this.normalizeTestScript(input.testScript);
    }
    const saved = await this.defects.save(defect);
    const changeContent = input.changeContent?.trim();
    const changeRemark = input.changeRemark?.trim();
    if (statusChanged) {
      await this.saveRecord(saved, {
        content: changeContent || `状态变更：${prevStatus} → ${saved.status}`,
        remark: input.changeRemark,
        source: recordSource,
      });
    } else if (changeContent || changeRemark) {
      await this.saveRecord(saved, {
        content: changeContent || '内容更新',
        remark: input.changeRemark,
        source: recordSource,
      });
    }
    return saved;
  }

  /** 运行验证：启动缺陷测试脚本的一次运行（须已在本项目用例中登记），返回 running 记录 */
  async verify(id: number): Promise<TestRun> {
    const defect = await this.findOne(id);
    if (!defect.testScript) {
      throw new BadRequestException('该缺陷未配置测试脚本');
    }
    const test = await this.testsService.findByScriptPath(
      defect.projectId,
      defect.testScript,
    );
    if (!test) {
      throw new BadRequestException(
        '测试脚本未在本项目用例中登记，请先在"测试"板块登记该脚本',
      );
    }
    return this.testsService.startRun(test.id);
  }

  async remove(id: number): Promise<void> {
    const defect = await this.findOne(id);
    await this.records.delete({ defectId: id });
    await this.defects.remove(defect);
  }

  /** 删除项目时的应用层级联清理（测试库无物理外键） */
  async removeByProject(projectId: number): Promise<void> {
    await this.records.delete({ projectId });
    await this.defects.delete({ projectId });
  }

  // ---- 内部 ----

  /** 写入一条变更记录（status 取缺陷当前状态；source 缺省录入） */
  private saveRecord(
    defect: Defect,
    input: {
      content: string;
      remark?: string | null;
      source?: DefectRecordSource;
    },
  ): Promise<DefectChangeRecord> {
    return this.records.save(
      this.records.create({
        defectId: defect.id,
        projectId: defect.projectId,
        content: input.content,
        remark: this.normalizeText(input.remark),
        status: defect.status,
        source: input.source ?? '录入',
      }),
    );
  }

  /** 状态变更时维护修复/验证时间：开放清空；修复记 fixedAt；关闭记 verifiedAt */
  private applyStatusTimestamps(defect: Defect): void {
    if (defect.status === (DefectStatus.OPEN as string)) {
      defect.fixedAt = null;
      defect.verifiedAt = null;
    } else if (defect.status === (DefectStatus.FIXED as string)) {
      defect.fixedAt = defect.fixedAt ?? new Date();
      defect.verifiedAt = null;
    } else if (defect.status === (DefectStatus.CLOSED as string)) {
      defect.fixedAt = defect.fixedAt ?? new Date();
      defect.verifiedAt = new Date();
    }
  }

  /**
   * 测试运行终态回调：脚本回归通过（success）时把关联缺陷（同项目 + 同脚本 +
   * "修复"态，即研发已修复、等待脚本回归验证）自动流转为"关闭"并记录验证时间。
   */
  private async handleTestRunFinal(run: TestRun): Promise<void> {
    if (run.status !== 'success') return;
    const test = await this.testsService.findOne(run.testId).catch(() => null);
    if (!test) return;
    const defects = await this.defects.find({
      where: {
        projectId: test.projectId,
        testScript: test.scriptPath,
        status: DefectStatus.FIXED,
      },
    });
    if (defects.length === 0) return;
    const now = new Date();
    for (const defect of defects) {
      defect.status = DefectStatus.CLOSED;
      defect.fixedAt = defect.fixedAt ?? now;
      defect.verifiedAt = now;
      const saved = await this.defects.save(defect);
      await this.saveRecord(saved, {
        content: '脚本回归通过，自动流转为关闭',
        source: '自动',
      });
    }
  }

  /** 端归一化：空串/非规范值一律归为"未知"（默认） */
  private normalizePlatform(platform: string): string {
    const normalized = platform.trim() || '未知';
    return (DEFECT_PLATFORMS as readonly string[]).includes(normalized)
      ? normalized
      : '未知';
  }

  /** 优先级归一化：非规范值一律归为"中"（默认） */
  private normalizePriority(priority: string): string {
    const normalized = priority.trim();
    return (Object.values(DefectPriority) as string[]).includes(normalized)
      ? normalized
      : DefectPriority.MEDIUM;
  }

  /** 文本字段归一：空串清除 */
  private normalizeText(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
  }

  /**
   * 图片归一：仅接受 POST /api/images 返回的 /images/... 路径，去重，空数组/空串清除。
   * 超过上限拒绝；非法路径拒绝（防止存入任意 URL）。
   */
  private normalizeImages(images: string[]): string[] | null {
    const normalized: string[] = [];
    for (const raw of images ?? []) {
      const item = String(raw ?? '').trim();
      if (!item) continue;
      if (!item.startsWith('/images/') || item.includes('..')) {
        throw new BadRequestException(
          '图片必须是 POST /api/images 上传后返回的 /images/... 路径',
        );
      }
      if (!normalized.includes(item)) normalized.push(item);
    }
    if (normalized.length > MAX_IMAGES) {
      throw new BadRequestException(`图片最多 ${MAX_IMAGES} 张`);
    }
    return normalized.length > 0 ? normalized : null;
  }

  /** 测试脚本：相对脚本根目录的 .test.ts 路径，空串清除；拒绝绝对路径与目录穿越 */
  private normalizeTestScript(testScript: string): string | null {
    const normalized = testScript.trim().replace(/\\/g, '/');
    if (!normalized) return null;
    if (
      path.isAbsolute(normalized) ||
      normalized.split('/').includes('..') ||
      !normalized.endsWith('.test.ts')
    ) {
      throw new BadRequestException(
        '测试脚本必须是相对脚本根目录的 .test.ts 路径，如 projects/active/pk/tests/xxx.test.ts',
      );
    }
    return normalized;
  }
}
