import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { FindOptionsSelect, Repository } from 'typeorm';
import { DefectSource, DefectStatus } from '../common/enums';
import { imageWebroot } from '../common/paths';
import { BitableRecord, FeishuService } from '../feishu/feishu.service';
import { Project } from '../projects/project.entity';
import { TestRun } from '../tests/test-run.entity';
import { TestsService } from '../tests/tests.service';
import { Defect } from './defect.entity';

/**
 * 列表查询不取 text/json 大字段：description/steps/expected/actual 与 images
 * 仅经 GET /defects/:id 返回。
 */
export const DEFECT_LIST_SELECT: FindOptionsSelect<Defect> = {
  id: true,
  title: true,
  platform: true,
  status: true,
  source: true,
  developer: true,
  tester: true,
  remark: true,
  testScript: true,
  feishuRecordId: true,
  projectId: true,
  fixedAt: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
};

export interface SyncDefectsResult {
  /** 视图内记录总数 */
  scanned: number;
  created: number;
  updated: number;
}

export interface CreateDefectInput {
  projectId: number;
  title: string;
  /** 来源：脚本/录入（飞书来源只能由同步产生），缺省录入 */
  source?: string;
  platform?: string;
  steps?: string;
  expected?: string;
  actual?: string;
  testScript?: string;
  developer?: string;
  tester?: string;
  remark?: string;
}

export interface UpdateDefectInput {
  title?: string;
  platform?: string;
  status?: string;
  testScript?: string;
  remark?: string;
  steps?: string;
  expected?: string;
  actual?: string;
  developer?: string;
  tester?: string;
}

/** 飞书附件字段（截图/截图2/截图3）的单项结构 */
interface FeishuAttachment {
  file_token?: string;
  name?: string;
  type?: string;
}

/**
 * 平台侧端取值：只保留 前端/后端/APP端/未知（默认）。
 * 同步时飞书单选里除 前端/后端/APP端 外的值统一映射为 未知。
 */
export const DEFECT_PLATFORMS = ['前端', '后端', 'APP端', '未知'] as const;
const REAL_PLATFORMS: readonly string[] = ['前端', '后端', 'APP端'];

/**
 * 飞书状态别名 → 平台状态（开放/修复/关闭）。
 * new/reopen 及任何未识别值 → 开放；fixed → 修复；close/invalid → 关闭。
 */
const FEISHU_STATUS_ALIAS: Record<string, string> = {
  new: DefectStatus.OPEN,
  reopen: DefectStatus.OPEN,
  fixed: DefectStatus.FIXED,
  close: DefectStatus.CLOSED,
  closed: DefectStatus.CLOSED,
  invalid: DefectStatus.CLOSED,
};
/** 平台状态 → 飞书状态（回写时还原飞书侧原名，避免在飞书表新建选项） */
const FEISHU_STATUS_ALIAS_REVERSE: Record<string, string> = {
  [DefectStatus.OPEN]: 'new',
  [DefectStatus.FIXED]: 'fixed',
  [DefectStatus.CLOSED]: 'close',
};

/** 附件 MIME → 扩展名（name 无扩展名时兜底） */
const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/** 文本字段：segment 数组（含 mention）→ 纯文本 */
function extractText(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (!Array.isArray(value)) return null;
  const text = value
    .map((seg: { text?: string; name?: string }) => seg.name ?? seg.text ?? '')
    .join('')
    .trim();
  return text || null;
}

/** 人员字段：[{name, email, id}] → 姓名（多人顿号连接） */
function extractPeople(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const names = value
    .map((seg: { name?: string; text?: string }) =>
      (seg.name ?? seg.text ?? '').replace(/^@/, '').trim(),
    )
    .filter(Boolean);
  return names.length ? names.join('、') : null;
}

/** 飞书状态 → 平台状态：别名映射，未识别值一律归为"开放" */
function mapStatus(value: unknown): string {
  if (typeof value !== 'string' || !value) return DefectStatus.OPEN;
  return FEISHU_STATUS_ALIAS[value] ?? DefectStatus.OPEN;
}

/** 平台状态 → 飞书状态：还原飞书侧原名（开放→new、修复→fixed、关闭→close），回写用 */
function toFeishuStatus(status: string): string {
  return FEISHU_STATUS_ALIAS_REVERSE[status] ?? status;
}

/** 飞书端 → 平台端：只保留 前端/后端/APP端，其余统一为 未知（默认） */
function mapPlatform(value: unknown): string {
  if (typeof value === 'string' && REAL_PLATFORMS.includes(value)) {
    return value;
  }
  return '未知';
}

@Injectable()
export class DefectsService implements OnModuleInit {
  private readonly logger = new Logger(DefectsService.name);

  constructor(
    @InjectRepository(Defect)
    private readonly defects: Repository<Defect>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly feishu: FeishuService,
    private readonly testsService: TestsService,
  ) {}

  onModuleInit(): void {
    // 测试运行通过后自动流转关联缺陷为"修复"（脚本来源闭环）
    this.testsService.onRunFinalized(
      (run) => void this.handleTestRunFinal(run),
    );
    // 存量数据一次性迁移（幂等）
    void this.migrateLegacy().catch((e: Error) =>
      this.logger.warn(`缺陷存量迁移失败: ${e.message}`),
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

  /** 人工/脚本一键生成缺陷（来源为录入或脚本） */
  async create(input: CreateDefectInput): Promise<Defect> {
    const title = (input.title ?? '').trim();
    if (!title) throw new BadRequestException('简述（标题）不能为空');
    const project = await this.projects.findOne({
      where: { id: input.projectId },
    });
    if (!project)
      throw new NotFoundException(`Project ${input.projectId} not found`);
    const source =
      input.source === DefectSource.SCRIPT
        ? DefectSource.SCRIPT
        : DefectSource.MANUAL;
    return this.defects.save(
      this.defects.create({
        projectId: input.projectId,
        title: title.length > 500 ? title.slice(0, 500) : title,
        source,
        status: DefectStatus.OPEN,
        platform:
          input.platform !== undefined
            ? this.normalizePlatform(input.platform)
            : null,
        steps: this.normalizeText(input.steps),
        expected: this.normalizeText(input.expected),
        actual: this.normalizeText(input.actual),
        testScript:
          input.testScript !== undefined
            ? this.normalizeTestScript(input.testScript)
            : null,
        developer: this.normalizeText(input.developer),
        tester: this.normalizeText(input.tester),
        remark: this.normalizeText(input.remark),
      }),
    );
  }

  /**
   * 从项目绑定的飞书多维表格全量同步缺陷（直接覆盖本地字段）。
   * 本地专有字段（steps/expected/actual/testScript/developer/tester/时间）不受影响；
   * 飞书侧已删除的记录本地保留。
   */
  async syncFromFeishu(projectId: number): Promise<SyncDefectsResult> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    if (!project.defectBitableUrl) {
      throw new BadRequestException(
        '请先在项目详情右侧设置缺陷多维表格地址，再执行同步',
      );
    }
    const { appToken, tableId, viewId } = await this.parseBitableUrl(
      project.defectBitableUrl,
    );
    const records = await this.feishu.searchBitableRecords(
      appToken,
      tableId,
      viewId,
    );
    let created = 0;
    let updated = 0;
    for (const record of records) {
      const result = await this.upsert(projectId, record);
      if (result === 'created') created++;
      if (result === 'updated') updated++;
    }
    return { scanned: records.length, created, updated };
  }

  /**
   * 更新缺陷（端/状态/测试脚本/备注/正文与人员字段）。
   * 状态改为"修复"时校验：配置了测试脚本则须其最近一次运行通过；未配置则允许手动改。
   * 状态变更时维护修复/验证时间；状态或端变更后异步回写飞书多维表格。
   */
  async update(id: number, input: UpdateDefectInput): Promise<Defect> {
    const defect = await this.findOne(id);
    // 端归一化后比较（空串/未识别一律归为"未知"），避免无变化也触发回写
    const nextPlatform =
      input.platform !== undefined
        ? this.normalizePlatform(input.platform)
        : defect.platform;
    const statusChanged =
      input.status !== undefined && input.status !== defect.status;
    const platformChanged = nextPlatform !== defect.platform;

    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new BadRequestException('简述（标题）不能为空');
      defect.title = title.length > 500 ? title.slice(0, 500) : title;
    }
    if (input.status !== undefined) {
      const allowed = Object.values(DefectStatus) as string[];
      if (!allowed.includes(input.status)) {
        throw new BadRequestException(`状态只能是：${allowed.join(' / ')}`);
      }
      if (
        input.status === (DefectStatus.FIXED as string) &&
        defect.status !== (DefectStatus.FIXED as string)
      ) {
        await this.assertFixable(defect);
      }
      defect.status = input.status;
      this.applyStatusTimestamps(defect);
    }
    if (input.platform !== undefined) {
      defect.platform = nextPlatform;
    }
    if (input.remark !== undefined) {
      defect.remark = this.normalizeText(input.remark);
    }
    if (input.steps !== undefined) {
      defect.steps = this.normalizeText(input.steps);
    }
    if (input.expected !== undefined) {
      defect.expected = this.normalizeText(input.expected);
    }
    if (input.actual !== undefined) {
      defect.actual = this.normalizeText(input.actual);
    }
    if (input.developer !== undefined) {
      defect.developer = this.normalizeText(input.developer);
    }
    if (input.tester !== undefined) {
      defect.tester = this.normalizeText(input.tester);
    }
    if (input.testScript !== undefined) {
      defect.testScript = this.normalizeTestScript(input.testScript);
    }
    const saved = await this.defects.save(defect);
    if (statusChanged || platformChanged) {
      void this.pushToFeishu(saved);
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
    await this.defects.remove(defect);
    void this.cleanImages(defect.projectId, defect.feishuRecordId);
  }

  /** 删除项目时的应用层级联清理（测试库无物理外键） */
  async removeByProject(projectId: number): Promise<void> {
    await this.defects.delete({ projectId });
    void this.cleanImages(projectId);
  }

  // ---- 内部 ----

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
   * 测试运行终态回调：脚本通过（success）时把关联缺陷（同项目 + 同脚本 + 开放）
   * 自动流转为"修复"并记录修复时间，同时回写飞书。
   */
  private async handleTestRunFinal(run: TestRun): Promise<void> {
    if (run.status !== 'success') return;
    const test = await this.testsService.findOne(run.testId).catch(() => null);
    if (!test) return;
    const defects = await this.defects.find({
      where: {
        projectId: test.projectId,
        testScript: test.scriptPath,
        status: DefectStatus.OPEN,
      },
    });
    if (defects.length === 0) return;
    const now = new Date();
    for (const defect of defects) {
      defect.status = DefectStatus.FIXED;
      defect.fixedAt = now;
      defect.verifiedAt = null;
      const saved = await this.defects.save(defect);
      void this.pushToFeishu(saved);
    }
  }

  /** 存量数据一次性迁移：旧英文状态 → 中文三态；飞书来源按 record_id 回填 */
  private async migrateLegacy(): Promise<void> {
    await this.defects
      .createQueryBuilder()
      .update()
      .set({ status: DefectStatus.OPEN })
      .where('status IN (:...values)', { values: ['open', 'reopen'] })
      .execute();
    await this.defects
      .createQueryBuilder()
      .update()
      .set({ status: DefectStatus.FIXED })
      .where('status = :value', { value: 'fixed' })
      .execute();
    await this.defects
      .createQueryBuilder()
      .update()
      .set({ status: DefectStatus.CLOSED })
      .where('status IN (:...values)', { values: ['closed', 'invalid'] })
      .execute();
    await this.defects
      .createQueryBuilder()
      .update()
      .set({ source: DefectSource.FEISHU })
      .where('feishuRecordId IS NOT NULL')
      .andWhere('source != :source', { source: DefectSource.FEISHU })
      .execute();
  }

  /** fixed 前置校验：配置了测试脚本时，须最近一次运行通过 */
  private async assertFixable(defect: Defect): Promise<void> {
    if (!defect.testScript) return;
    const test = await this.testsService.findByScriptPath(
      defect.projectId,
      defect.testScript,
    );
    if (!test) {
      throw new BadRequestException(
        '测试脚本未在本项目用例中登记，请先在"测试"板块登记该脚本',
      );
    }
    const run = await this.testsService.findLatestRun(test.id);
    if (!run || run.status !== 'success') {
      throw new BadRequestException(
        '测试脚本最近一次运行未通过，请先运行验证通过后再标记修复',
      );
    }
  }

  /** 回写飞书多维表格（单条）：状态必写，端有值时一并写 */
  private async pushToFeishu(defect: Defect): Promise<void> {
    try {
      if (!defect.feishuRecordId) return;
      const project = await this.projects.findOne({
        where: { id: defect.projectId },
      });
      if (!project?.defectBitableUrl) return;
      const { appToken, tableId } = await this.parseBitableUrl(
        project.defectBitableUrl,
      );
      const fields: Record<string, unknown> = {
        // 状态回写用飞书侧原名（开放→new、修复→fixed、关闭→close），不新建选项
        状态: toFeishuStatus(defect.status),
      };
      if (defect.platform && REAL_PLATFORMS.includes(defect.platform)) {
        fields['端'] = defect.platform;
      }
      await this.feishu.updateBitableRecord(
        appToken,
        tableId,
        defect.feishuRecordId,
        fields,
      );
    } catch (e) {
      this.logger.warn(
        `缺陷 ${defect.id} 回写飞书失败: ${(e as Error).message}`,
      );
    }
  }

  /** 按 record_id upsert：命中即覆盖飞书侧字段（steps 等本地字段保留） */
  private async upsert(
    projectId: number,
    record: BitableRecord,
  ): Promise<'created' | 'updated' | null> {
    const f = record.fields;
    const fullText = extractText(f['问题描述']);
    if (!fullText) return null; // 无问题描述的记录跳过
    // 标题单行化（多行正文存 description），截断至列宽 500
    const oneLine = fullText.replace(/\s*\n\s*/g, ' ');
    const title = oneLine.length > 500 ? oneLine.slice(0, 500) : oneLine;
    const defect =
      (await this.defects.findOne({
        where: { projectId, feishuRecordId: record.record_id },
      })) ??
      this.defects.create({ projectId, feishuRecordId: record.record_id });
    const isNew = defect.id === undefined;

    defect.title = title;
    defect.description = fullText !== oneLine ? fullText : null;
    defect.platform = mapPlatform(f['端']);
    defect.status = mapStatus(f['状态']);
    defect.source = DefectSource.FEISHU;
    defect.developer = extractPeople(f['人员']);
    defect.remark = extractText(f['备注']);
    defect.images = await this.syncImages(projectId, record.record_id, f);
    await this.defects.save(defect);
    return isNew ? 'created' : 'updated';
  }

  /**
   * 同步截图：合并飞书 截图/截图2/截图3 三个附件字段，下载到
   * imageWebroot()/defects/{projectId}/{recordId}/ 下，返回相对 webroot 的路径数组。
   * 已存在的文件跳过下载；单个附件失败仅记日志不影响整体同步。
   */
  private async syncImages(
    projectId: number,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<string[] | null> {
    const attachments: FeishuAttachment[] = [];
    for (const key of ['截图', '截图2', '截图3']) {
      const value = fields[key];
      if (Array.isArray(value)) {
        attachments.push(...(value as FeishuAttachment[]));
      }
    }
    if (attachments.length === 0) return null;

    const relDir = path.posix.join('defects', String(projectId), recordId);
    const absDir = path.join(imageWebroot(), relDir);
    const relPaths: string[] = [];
    for (const att of attachments) {
      if (!att.file_token) continue;
      const ext =
        path.extname(att.name ?? '') || MIME_EXT[att.type ?? ''] || '';
      const relPath = path.posix.join(relDir, `${att.file_token}${ext}`);
      const absPath = path.join(imageWebroot(), relPath);
      try {
        await fs.access(absPath);
      } catch {
        try {
          const buf = await this.feishu.downloadMedia(att.file_token);
          await fs.mkdir(absDir, { recursive: true });
          await fs.writeFile(absPath, buf);
        } catch (e) {
          this.logger.warn(
            `缺陷截图下载失败 ${att.file_token}: ${(e as Error).message}`,
          );
          continue;
        }
      }
      relPaths.push(relPath);
    }
    return relPaths.length > 0 ? relPaths : null;
  }

  /** 清理缺陷截图目录（fire-and-forget）：传 recordId 清单条，否则清整个项目 */
  private async cleanImages(
    projectId: number,
    recordId?: string | null,
  ): Promise<void> {
    const relDir = recordId
      ? path.join('defects', String(projectId), recordId)
      : path.join('defects', String(projectId));
    await fs
      .rm(path.join(imageWebroot(), relDir), { recursive: true, force: true })
      .catch(() => undefined);
  }

  /** 解析缺陷多维表格地址：飞书 wiki/base 链接，须带 table 参数（view 可选） */
  private async parseBitableUrl(url: string): Promise<{
    appToken: string;
    tableId: string;
    viewId?: string;
  }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException(`缺陷多维表格地址不合法: ${url}`);
    }
    const tableId = parsed.searchParams.get('table');
    if (!tableId) {
      throw new BadRequestException('缺陷多维表格地址缺少 table 参数');
    }
    const viewId = parsed.searchParams.get('view') ?? undefined;
    const pathMatch = parsed.pathname.match(/\/(wiki|base)\/([A-Za-z0-9]+)/);
    if (!pathMatch) {
      throw new BadRequestException(
        '缺陷多维表格地址必须是飞书 wiki/base 链接',
      );
    }
    const [, kind, token] = pathMatch;
    if (kind === 'base') return { appToken: token, tableId, viewId };
    const ref = await this.feishu.resolveWiki(token);
    if (ref.type !== 'bitable') {
      throw new BadRequestException('缺陷多维表格地址必须指向多维表格');
    }
    return { appToken: ref.token, tableId, viewId };
  }

  /** 端归一化：空串/非规范值一律归为"未知"（默认） */
  private normalizePlatform(platform: string): string {
    const normalized = platform.trim() || '未知';
    return (DEFECT_PLATFORMS as readonly string[]).includes(normalized)
      ? normalized
      : '未知';
  }

  /** 文本字段归一：空串清除 */
  private normalizeText(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
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
