import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectType } from '../common/enums';
import { BitableRecord, FeishuService } from '../feishu/feishu.service';
import { Project } from './project.entity';
import { SyncState } from './sync-state.entity';

const SYNC_KEY = 'projects:feishu';
/** 首次同步只取最近 15 天有更新的记录 */
const FIRST_SYNC_WINDOW_DAYS = 15;
/** 后续增量同步只取最近 7 天有更新的记录 */
const INCREMENTAL_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 默认项目源：研发项目管理多维表格（可用 FEISHU_PROJECT_SOURCE_URL 覆盖） */
const DEFAULT_SOURCE_URL =
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

@Injectable()
export class ProjectSyncService {
  constructor(
    private readonly feishu: FeishuService,
    private readonly config: ConfigService,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(SyncState)
    private readonly syncStates: Repository<SyncState>,
  ) {}

  /** 从飞书多维表格增量同步项目 */
  async syncFromFeishu(): Promise<SyncProjectsResult> {
    const sourceUrl =
      this.config.get<string>('FEISHU_PROJECT_SOURCE_URL') ??
      DEFAULT_SOURCE_URL;
    const { appToken, tableId, viewId } = await this.parseSource(sourceUrl);

    const state = await this.syncStates.findOne({ where: { key: SYNC_KEY } });
    const windowDays = state ? INCREMENTAL_WINDOW_DAYS : FIRST_SYNC_WINDOW_DAYS;
    const since = Date.now() - windowDays * DAY_MS;

    const records = await this.feishu.searchBitableRecords(
      appToken,
      tableId,
      viewId,
    );
    // search 接口 automatic_fields 的 last_modified_time 为微秒，需 /1000 转毫秒
    const fresh = records.filter((r) => (r.last_modified_time ?? 0) / 1000 >= since);

    for (const record of fresh) {
      await this.upsert(record);
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

  // ---- 内部 ----

  private async upsert(record: BitableRecord): Promise<void> {
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
    project.priority = typeof f['优先级'] === 'string' ? f['优先级'] : null;
    project.expectedReleaseAt = extractDate(f['理想上线时间']);
    project.iterationCycle = typeof f['w'] === 'string' ? f['w'] : null;
    const resources = {
      frontend: extractPeople(f['前端人员']),
      backend: extractPeople(f['后端人员']),
      qa: extractPeople(f['测试人员']),
    };
    project.resources = Object.values(resources).some(Boolean)
      ? resources
      : null;
    await this.projects.save(project);
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
