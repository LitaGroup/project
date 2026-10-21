import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentType, ProjectStatus, ProjectType } from '../common/enums';
import { DocumentsService } from '../documents/documents.service';
import { BitableRecord, FeishuService } from '../feishu/feishu.service';
import { Project } from './project.entity';
import { SyncState } from './sync-state.entity';

const SYNC_KEY = 'projects:feishu';
/** 首次同步只取最近 15 天有更新的记录 */
const FIRST_SYNC_WINDOW_DAYS = 15;
/** 手动同步固定取最近 15 天有更新的记录（不走增量窗口，便于补拉近期变更） */
const MANUAL_SYNC_WINDOW_DAYS = 15;
/** 增量同步窗口缓冲：上次同步时间往前多取 1 小时，防时钟偏差漏单 */
const SYNC_BUFFER_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 默认项目源：研发项目管理多维表格（可用 FEISHU_PROJECT_SOURCE_URL 覆盖）。
 *  导出供 settings 模块展示解析后的源地址，避免默认值漂移。 */
export const DEFAULT_PROJECT_SOURCE_URL =
  'https://lita-group.feishu.cn/wiki/wikcn9hxHvxX55gXXH6g35AFknd?table=tblmfWA2DvqQ76Ri&view=vewrCaS2Ym';

export interface SyncProjectsResult {
  /** 窗口起点（ISO） */
  since: string;
  /** 是否首次同步 */
  firstSync: boolean;
  /** 视图内记录总数 */
  scanned: number;
  /** 窗口内命中并写入的记录数 */
  synced: number;
}

/** 源表"需求类型"特殊取值 → 平台项目类型的别名映射 */
const TYPE_ALIAS: Record<string, ProjectType> = {
  Admin: ProjectType.ADMIN,
};

/** 飞书单选"需求类型" → 平台项目类型（值即枚举原文，无法识别时归为"其它"） */
function toProjectType(value: unknown): ProjectType {
  if (typeof value !== 'string') return ProjectType.OTHER;
  if (TYPE_ALIAS[value]) return TYPE_ALIAS[value];
  const all = Object.values(ProjectType) as string[];
  return all.includes(value) ? (value as ProjectType) : ProjectType.OTHER;
}

/** 需求列无文档链接时，需求文本落的平台文档（fileName 作为 upsert 幂等判重） */
export const REQUIREMENT_DOC_TITLE = '需求文档';
export const REQUIREMENT_DOC_FILENAME = '需求文档.md';

/** 飞书文档链接（docx/docs/sheets/base/wiki），允许带 ?sheet= / ?table= 等 query 参数 */
const FEISHU_DOC_URL_RE =
  /https?:\/\/(?:[A-Za-z0-9-]+\.)*(?:feishu\.cn|larksuite\.com)\/(?:docx|docs|sheets|base|wiki)\/[A-Za-z0-9]+(?:\?[^\s"'<>（）()【】,，。;；！？!?]*)?/g;

/** "需求"字段 → 文档链接列表：url 段的 link + 各 segment 文本中的飞书文档链接，去重保序。
 *  逐 segment 匹配而非拼接全文——拼接会把相邻展示文字黏到 URL 尾部产生假 token。 */
export function extractDocLinks(value: unknown): string[] {
  const pool: string[] = [];
  if (typeof value === 'string') {
    pool.push(value);
  } else if (Array.isArray(value)) {
    for (const seg of value as { link?: unknown; text?: unknown }[]) {
      if (typeof seg?.link === 'string') pool.push(seg.link);
      if (typeof seg?.text === 'string') pool.push(seg.text);
    }
  }
  const links = new Set<string>();
  for (const s of pool) {
    for (const m of s.matchAll(FEISHU_DOC_URL_RE)) links.add(m[0]);
  }
  return [...links];
}

/** 需求池同步的开发人员角色（resources 列结构） */
export interface SyncResources {
  frontend?: string;
  backend?: string;
  qa?: string;
  client?: string;
}

/**
 * 需求池 → 平台项目状态（单向同步规则）：
 * - 源状态为 关闭 / 暂停 / ✅ 已上线 时直接同步（→ 已关闭 / 暂停中 / 已发布）；
 * - 其余状态（正常/有风险/Delay/空值/乱填等）按开发人员推导：
 *   前端 / 后端 / 客户端 任一已分配 → 开发中，全未分配 → 待分配。
 */
export function toProjectStatus(
  value: unknown,
  resources: SyncResources,
): ProjectStatus {
  if (typeof value === 'string') {
    if (value.includes('关闭')) return ProjectStatus.FINISHED;
    if (value.includes('暂停')) return ProjectStatus.PAUSED;
    if (value.includes('已上线')) return ProjectStatus.PUBLISHED;
  }
  return resources.frontend || resources.backend || resources.client
    ? ProjectStatus.IN_PROGRESS
    : ProjectStatus.PLANNED;
}

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

/** 人员字段：人员类型为 [{name}]，文本类型为 mention segment（text 带 @ 前缀） */
function extractPeople(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .map((seg: { name?: string; text?: string }) =>
      (seg.name ?? seg.text ?? '').replace(/^@/, '').trim(),
    )
    .filter(Boolean);
  return names.length ? names.join('、') : undefined;
}

/** 资源人员：飞书现用 SingleLink（关联「技术资源表」）字段，取关联记录的姓名 */
const ROLE_LINK_FIELDS = {
  frontend: '前端人员/新',
  backend: '后端资源/新',
  qa: '测试人员/新',
  client: '客户端人员/新',
} as const;

/** 资源人员兜底：旧字段（前端/后端/测试/客户端人员；后端为文本备注、可能夹 mention） */
const ROLE_LEGACY_FIELDS = {
  frontend: '前端人员',
  backend: '后端人员',
  qa: '测试人员',
  client: '客户端人员',
} as const;

/** SingleLink 字段值 → 关联记录姓名列表（经 nameById 解析，顿号连接） */
export function extractLinkedNames(
  value: unknown,
  nameById: Map<string, string>,
): string | undefined {
  const linkIds = (value as { link_record_ids?: string[] } | undefined)
    ?.link_record_ids;
  if (!Array.isArray(linkIds) || linkIds.length === 0) return undefined;
  const names = linkIds
    .map((id) => nameById.get(id))
    .filter((n): n is string => Boolean(n));
  return names.length ? names.join('、') : undefined;
}

/** 日期字段：飞书存 ms 时间戳（表时区通常为 +08:00），转为 YYYY-MM-DD */
function extractDate(value: unknown): string | null {
  if (typeof value !== 'number') return null;
  const d = new Date(value);
  // 按东八区取日期，避免 UTC 零点偏移导致差一天
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts;
}

/**
 * 飞书"迭代"（w 字段）→ 平台迭代周期，统一为 `w{n}: {MM/DD}-{MM/DD}`：
 * - 大小写 W、全角/半角冒号、冒号后缺空格、横杠两侧空格等变体都归一化（如 `W158:01/16-01/22`、`w186：08/20-08/26`、`w113: 02/28 - 03/06`）；
 * - 日期区间后的后缀直接过滤（如 `w142: 09/26-09/28 & 10/06-10/09`、`w155:01/03-01/08 (少一天)`）；
 * - 需求池/待排期/Archive/纯 w 编号等无法识别的一律归 '-'。
 */
export function toIterationCycle(value: unknown): string {
  if (typeof value !== 'string') return '-';
  const m = value.match(
    /[wW]\s*(\d+)\s*[:：]?\s*(\d{1,2})\/(\d{1,2})\s*[-–—~]\s*(\d{1,2})\/(\d{1,2})/,
  );
  if (!m) return '-';
  const pad = (s: string) => s.padStart(2, '0');
  return `w${m[1]}: ${pad(m[2])}/${pad(m[3])}-${pad(m[4])}/${pad(m[5])}`;
}

@Injectable()
export class ProjectSyncService {
  private readonly logger = new Logger(ProjectSyncService.name);

  /** 上一轮同步未结束时不重入（cron 触发与手动同步可能重叠） */
  private syncing = false;

  constructor(
    private readonly feishu: FeishuService,
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(SyncState)
    private readonly syncStates: Repository<SyncState>,
  ) {}

  /** 需求池 → 平台单向同步，每 1 小时自动增量一次；失败仅告警不中断 */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledSync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const result = await this.syncFromFeishu(false);
      this.logger.log(
        `定时同步完成：窗口 ${result.since} 起，同步 ${result.synced}/${result.scanned} 条`,
      );
    } catch (e) {
      this.logger.warn(`定时同步失败: ${(e as Error).message}`);
    } finally {
      this.syncing = false;
    }
  }

  /** 从需求池同步项目：定时为增量（上次同步时间 - 1h 缓冲，首次近 15 天）；手动固定取近 15 天；full=true 全量 */
  async syncFromFeishu(full = false, manual = false): Promise<SyncProjectsResult> {
    const sourceUrl =
      this.config.get<string>('FEISHU_PROJECT_SOURCE_URL') ??
      DEFAULT_PROJECT_SOURCE_URL;
    const { appToken, tableId, viewId } = await this.parseSource(sourceUrl);

    const state = await this.syncStates.findOne({ where: { key: SYNC_KEY } });
    // 增量窗口 = 上次同步时间 - 1h 缓冲（lastSyncAt 仅成功后写入，失败自动补窗口）；
    // 首次取近 15 天；手动同步固定取近 15 天；full 忽略窗口全量扫描
    const since = full
      ? 0
      : manual
        ? Date.now() - MANUAL_SYNC_WINDOW_DAYS * DAY_MS
        : state
          ? state.lastSyncAt.getTime() - SYNC_BUFFER_MS
          : Date.now() - FIRST_SYNC_WINDOW_DAYS * DAY_MS;

    const records = await this.feishu.searchBitableRecords(
      appToken,
      tableId,
      viewId,
    );
    // search 接口 automatic_fields 的 last_modified_time 为微秒，需 /1000 转毫秒
    const fresh = records.filter(
      (r) => (r.last_modified_time ?? 0) / 1000 >= since,
    );

    // 资源人员现用 SingleLink 字段（关联技术资源表），先批量解析关联记录姓名
    const linkedNames = await this.resolveLinkedPeople(
      appToken,
      tableId,
      fresh,
    );
    for (const record of fresh) {
      await this.upsert(record, linkedNames);
    }

    const now = new Date();
    await this.syncStates.save({ key: SYNC_KEY, lastSyncAt: now });

    return {
      since: new Date(since).toISOString(),
      firstSync: !state,
      scanned: records.length,
      synced: fresh.length,
    };
  }

  /**
   * 解析资源人员 SingleLink 字段（前端人员/新 等）关联记录的姓名：
   * 从字段元信息取关联表 id，批量取关联记录（姓名字段）建立 record_id → 姓名 映射。
   * 无关联数据 / 元信息获取失败时返回空映射（upsert 回退旧字段）。
   */
  private async resolveLinkedPeople(
    appToken: string,
    tableId: string,
    records: BitableRecord[],
  ): Promise<Map<string, string>> {
    const nameById = new Map<string, string>();
    const wanted = new Set<string>(Object.values(ROLE_LINK_FIELDS));
    const ids = new Set<string>();
    for (const r of records) {
      for (const field of wanted) {
        const linkIds = (
          r.fields[field] as { link_record_ids?: string[] } | undefined
        )?.link_record_ids;
        for (const id of linkIds ?? []) ids.add(id);
      }
    }
    if (ids.size === 0) return nameById;

    let targetTable: string | undefined;
    try {
      const fields = await this.feishu.listBitableFields(appToken, tableId);
      targetTable = fields.find(
        (f) => wanted.has(f.field_name) && f.property?.table_id,
      )?.property?.table_id;
    } catch (e) {
      this.logger.warn(`人员关联字段元信息获取失败: ${(e as Error).message}`);
    }
    if (!targetTable) return nameById;

    const linked = await this.feishu.batchGetBitableRecords(
      appToken,
      targetTable,
      [...ids],
    );
    for (const rec of linked) {
      const name = extractPeople(rec.fields['姓名']);
      if (name) nameById.set(rec.record_id, name);
    }
    return nameById;
  }

  // ---- 内部 ----
  private async upsert(
    record: BitableRecord,
    linkedNames: Map<string, string>,
  ): Promise<void> {
    const f = record.fields;
    const fullText = extractText(f['需求']);
    if (!fullText) return; // 无标题的记录跳过
    // "需求"主字段可能存整段文档文本，取首行作为项目标题（列宽 varchar(200)）
    const firstLine = fullText.split('\n')[0].trim();
    const name = firstLine.length > 200 ? firstLine.slice(0, 200) : firstLine;

    const project =
      (await this.projects.findOne({
        where: { feishuRecordId: record.record_id },
      })) ?? this.projects.create({ feishuRecordId: record.record_id });

    project.name = name;
    project.description = fullText !== name ? fullText : null;
    project.type = toProjectType(f['需求类型']);
    const resources: SyncResources = {
      frontend:
        extractLinkedNames(f[ROLE_LINK_FIELDS.frontend], linkedNames) ??
        extractPeople(f[ROLE_LEGACY_FIELDS.frontend]),
      backend:
        extractLinkedNames(f[ROLE_LINK_FIELDS.backend], linkedNames) ??
        extractPeople(f[ROLE_LEGACY_FIELDS.backend]),
      qa:
        extractLinkedNames(f[ROLE_LINK_FIELDS.qa], linkedNames) ??
        extractPeople(f[ROLE_LEGACY_FIELDS.qa]),
      client:
        extractLinkedNames(f[ROLE_LINK_FIELDS.client], linkedNames) ??
        extractPeople(f[ROLE_LEGACY_FIELDS.client]),
    };
    project.resources = Object.values(resources).some(Boolean)
      ? resources
      : null;
    // 「测试中」为平台本地流程态（飞书侧无对应值），同步时保留不覆盖；
    // 其余状态按规则映射（关闭/暂停/已上线直接同步，其余按开发人员推导）
    if (project.status !== ProjectStatus.IN_TEST) {
      project.status = toProjectStatus(f['需求状态'], resources);
    }
    project.priority = typeof f['优先级'] === 'string' ? f['优先级'] : null;
    project.expectedReleaseAt = extractDate(f['理想上线时间']);
    project.iterationCycle = toIterationCycle(f['w']);
    await this.projects.save(project);
    await this.syncRequirementDocuments(project.id, f['需求'], fullText);
  }

  /**
   * 需求列文档联动：
   * - 有文档链接 → 逐个按文档导入（type=需求，syncFromFeishu 按 feishuKey 幂等 upsert）；
   * - 无文档链接 → 需求全文以"需求文档"为题 upsert 到项目（source '-'，同步可覆盖更新）。
   * 单条失败仅告警不中断，避免个别文档问题阻断整个项目同步。
   */
  private async syncRequirementDocuments(
    projectId: number,
    fieldValue: unknown,
    fullText: string,
  ): Promise<void> {
    const links = extractDocLinks(fieldValue);
    if (links.length > 0) {
      for (const url of links) {
        try {
          await this.documents.syncFromFeishu({
            projectId,
            url,
            type: DocumentType.REQUIREMENT,
          });
        } catch (e) {
          this.logger.warn(
            `项目需求文档链接导入失败 ${url}: ${(e as Error).message}`,
          );
        }
      }
      return;
    }
    try {
      await this.documents.upsert({
        projectId,
        fileName: REQUIREMENT_DOC_FILENAME,
        title: REQUIREMENT_DOC_TITLE,
        type: DocumentType.REQUIREMENT,
        content: fullText,
      });
    } catch (e) {
      this.logger.warn(`项目需求文档写入失败: ${(e as Error).message}`);
    }
  }

  private async parseSource(url: string): Promise<{
    appToken: string;
    tableId: string;
    viewId?: string;
  }> {
    const parsed = new URL(url);
    const tableId = parsed.searchParams.get('table');
    if (!tableId) {
      throw new BadRequestException('源链接缺少 table 参数');
    }
    const viewId = parsed.searchParams.get('view') ?? undefined;

    const pathMatch = parsed.pathname.match(/\/(wiki|base)\/([A-Za-z0-9]+)/);
    if (!pathMatch) {
      throw new BadRequestException(`无法识别的飞书链接: ${url}`);
    }
    const [, kind, token] = pathMatch;
    if (kind === 'base') return { appToken: token, tableId, viewId };

    const ref = await this.feishu.resolveWiki(token);
    if (ref.type !== 'bitable') {
      throw new BadRequestException('项目源必须是多维表格');
    }
    return { appToken: ref.token, tableId, viewId };
  }
}
