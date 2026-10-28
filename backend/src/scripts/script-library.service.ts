import {
  BadRequestException,
  Injectable,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Observable } from 'rxjs';
import { In, Repository } from 'typeorm';
import { ChecksService } from '../checks/checks.service';
import { exportWebroot } from '../common/paths';
import { ExportsService } from '../exports/exports.service';
import { Project } from '../projects/project.entity';
import { TestsService } from '../tests/tests.service';
import {
  ScriptLibraryDescription,
  ScriptDescriptionStatus,
} from './script-library-description.entity';
import {
  ScriptLibraryKind,
  ScriptLibraryRun,
  ScriptLibraryRunFile,
  ScriptLibraryRunItem,
} from './script-library-run.entity';
import { ScriptLibrarySyncService } from './script-library-sync.service';

/** 单次脚本执行的超时时间（毫秒），与检查/测试/导出一致 */
const RUN_TIMEOUT_MS = 120_000;
/** 运行历史返回条数上限 */
const MAX_RUNS = 50;
/** 目录扫描条数上限（防止脚本目录异常过大拖垮接口） */
const MAX_SCAN = 2000;
/** 终态实时快照的保留时长（供晚到的 SSE 订阅直接取到结果） */
const LIVE_SNAPSHOT_TTL_MS = 5 * 60_000;
/** 脚本库固定子目录：只收录 projects/ 下的脚本 */
const LIBRARY_ROOT = 'projects';
/** 列表分页默认值与上限 */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
/** 后缀 → 类型（顺序即判定顺序，后缀互不重叠） */
const KIND_BY_SUFFIX: ReadonlyArray<readonly [string, ScriptLibraryKind]> = [
  ['.check.ts', 'check'],
  ['.test.ts', 'test'],
  ['.export.ts', 'export'],
];

/** 脚本库中的一个脚本（列表条目） */
export interface ScriptLibraryScript {
  /** 相对脚本根目录的路径（POSIX 风格，以 projects/ 开头） */
  path: string;
  kind: ScriptLibraryKind;
  /** 文件大小（字节） */
  size: number;
  /** 文件修改时间（本地工作区 mtime） */
  updatedAt: string;
  /** 登记了该脚本的检查/用例/导出所属项目 id 列表 */
  projectIds: number[];
  /** 最近一次脚本库运行（从未运行为 null） */
  latestRun: ScriptLibraryRun | null;
  /** 描述（脚本描述机器人生成；未生成为 null） */
  description: string | null;
  /** 描述生成状态（尚无描述记录为 null） */
  descriptionStatus: ScriptDescriptionStatus | null;
  /** 搜索相关度（0..1）；无关键词或详情接口为 null */
  relevance: number | null;
}

interface ScannedScript {
  path: string;
  kind: ScriptLibraryKind;
  size: number;
  updatedAt: string;
}

interface RankedScript {
  script: ScannedScript;
  relevance: number | null;
}

/** 脚本详情（含源码与元信息） */
export interface ScriptLibraryScriptDetail extends ScriptLibraryScript {
  content: string;
  /** 脚本仓库 main 当前 HEAD（读取失败为 null） */
  revision: string | null;
  /** GitHub 原文链接（main 分支） */
  githubUrl: string;
}

export interface ScriptLibraryListResponse {
  items: ScriptLibraryScript[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StartLibraryRunInput {
  path?: string;
}

/**
 * 脚本库：扫描 scripts 仓库 main 分支工作区 projects/ 目录下的
 * .check.ts / .test.ts / .export.ts，支持搜索与不依赖项目登记的直接运行。
 * 运行执行与输出协议与检查/测试/导出一致（node 直跑 + [start]/[act]/[check]/[done] 行协议）。
 */
@Injectable()
export class ScriptLibraryService {
  /** 脚本根目录（CHECK_SCRIPTS_DIR） */
  private readonly scriptsDir: string;

  /** 运行中的实时状态（runId → 快照+事件），终态后保留 TTL 供 SSE 晚订阅 */
  private readonly liveRuns = new Map<number, LiveRun>();

  constructor(
    @InjectRepository(ScriptLibraryRun)
    private readonly runs: Repository<ScriptLibraryRun>,
    @InjectRepository(ScriptLibraryDescription)
    private readonly descriptions: Repository<ScriptLibraryDescription>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly checksService: ChecksService,
    private readonly testsService: TestsService,
    private readonly exportsService: ExportsService,
    private readonly syncService: ScriptLibrarySyncService,
    config: ConfigService,
  ) {
    this.scriptsDir = path.resolve(
      config.get<string>('CHECK_SCRIPTS_DIR') ??
        path.resolve(process.cwd(), '../scripts'),
    );
  }

  /** 脚本根目录绝对路径（描述生成等服务复用） */
  getScriptsDir(): string {
    return this.scriptsDir;
  }

  /**
   * 脚本列表：扫描 projects/ 下全部三类脚本，q 匹配路径或描述（不区分大小写），
   * type 过滤类型；有关键词按相关度排序，无关键词按路径排序，再分页。
   * 附带登记项目与最近一次运行。
   */
  async listScripts(
    q?: string,
    type?: string,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<ScriptLibraryListResponse> {
    const kind = this.parseKindFilter(type);
    const all = await this.scanScripts();
    const keyword = q?.trim().toLowerCase();
    // 关键词可能命中描述：需要先取全量描述再过滤，不能只查分页后的脚本
    const searchedDescriptions = keyword
      ? await this.descriptionsByPaths(all.map((s) => s.path))
      : null;
    let filtered: RankedScript[] = all
      .filter((s) => !kind || s.kind === kind)
      .map((script) => ({ script, relevance: null }));

    if (keyword) {
      // 有关键词时先按命中位置计算相关度，再分页，确保返回的是全局最相关结果
      filtered = filtered
        .map(({ script }) => ({
          script,
          relevance: this.scriptRelevance(
            script.path,
            searchedDescriptions?.get(script.path)?.description ?? null,
            keyword,
          ),
        }))
        .filter((entry) => entry.relevance !== null)
        .sort(
          (a, b) =>
            (b.relevance ?? 0) - (a.relevance ?? 0) ||
            a.script.path.localeCompare(b.script.path),
        );
    } else {
      filtered.sort((a, b) => a.script.path.localeCompare(b.script.path));
    }

    const size = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
    const current = Math.max(page, 1);
    const slice = filtered.slice(
      (current - 1) * size,
      (current - 1) * size + size,
    );
    if (slice.length === 0) {
      return {
        items: [],
        total: filtered.length,
        page: current,
        pageSize: size,
      };
    }

    const [owners, latest, descriptions] = await Promise.all([
      this.ownershipMap(),
      this.latestRunsByPaths(slice.map(({ script }) => script.path)),
      searchedDescriptions
        ? Promise.resolve(searchedDescriptions)
        : this.descriptionsByPaths(slice.map(({ script }) => script.path)),
    ]);
    const items = slice.map(({ script: s, relevance }) => ({
      ...s,
      projectIds: [...(owners.get(s.path) ?? [])].sort((a, b) => a - b),
      latestRun: latest.get(s.path) ?? null,
      description: descriptions.get(s.path)?.description ?? null,
      descriptionStatus: descriptions.get(s.path)?.status ?? null,
      relevance,
    }));
    return { items, total: filtered.length, page: current, pageSize: size };
  }

  /** 脚本详情：源码 + 类型 + 登记项目 + 最近运行 + main HEAD + GitHub 原文链接 */
  async findScript(relPath: string): Promise<ScriptLibraryScriptDetail> {
    const normalized = this.normalizeScriptPath(relPath);
    const abs = this.resolveScriptPath(normalized);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(abs);
    } catch {
      throw new NotFoundException(`脚本文件不存在: ${normalized}`);
    }
    if (!stat.isFile()) {
      throw new BadRequestException(`路径不是脚本文件: ${normalized}`);
    }
    let content = '';
    try {
      content = await fs.readFile(abs, 'utf8');
    } catch {
      throw new NotFoundException(`脚本文件不可读: ${normalized}`);
    }
    const owners = await this.ownershipMap();
    const latest = await this.latestRunsByPaths([normalized]);
    const descriptions = await this.descriptionsByPaths([normalized]);
    return {
      path: normalized,
      kind: this.kindOf(normalized)!,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      projectIds: [...(owners.get(normalized) ?? [])].sort((a, b) => a - b),
      latestRun: latest.get(normalized) ?? null,
      description: descriptions.get(normalized)?.description ?? null,
      descriptionStatus: descriptions.get(normalized)?.status ?? null,
      relevance: null,
      content,
      revision: await this.syncService.currentHead(),
      githubUrl: this.githubUrl(normalized),
    };
  }

  /**
   * 启动一次脚本运行：先落 running 记录并立即返回，脚本在后台异步执行。
   * .export.ts 自动传入 --output-dir={exportWebroot()}/library/{runId}，
   * 其余类型与检查/测试运行一致（本地 node 直跑）。
   */
  async startRun(input: StartLibraryRunInput): Promise<ScriptLibraryRun> {
    const scriptPath = this.normalizeScriptPath(input.path);
    const absPath = this.resolveScriptPath(scriptPath);
    try {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      throw new NotFoundException(`脚本文件不存在: ${scriptPath}`);
    }
    const kind = this.kindOf(scriptPath)!;
    const run = await this.runs.save(
      this.runs.create({
        scriptPath,
        kind,
        revision: await this.syncService.currentHead(),
        status: 'running',
        startedAt: new Date(),
      }),
    );
    let outputDir: string | undefined;
    if (kind === 'export') {
      outputDir = path.join(exportWebroot(), 'library', String(run.id));
      await fs.mkdir(outputDir, { recursive: true });
    }
    this.liveRuns.set(run.id, { snapshot: run, emitter: new EventEmitter() });
    this.executeRun(run.id, absPath, outputDir);
    return run;
  }

  /**
   * 单次运行的 SSE 实时流：先推当前快照，运行中每次进度变化推送，终态推送后完成。
   * 无实时句柄时（已结束/服务重启）读库，running 则低频兜底轮询直至结束。
   */
  streamRun(runId: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let done = false;
      const push = (snapshot: ScriptLibraryRun) => {
        if (done) return;
        subscriber.next({ data: snapshot });
        if (snapshot.status !== 'running') {
          done = true;
          subscriber.complete();
        }
      };

      const live = this.liveRuns.get(runId);
      if (live) {
        const onUpdate = (s: ScriptLibraryRun) => push(s);
        live.emitter.on('update', onUpdate);
        push({ ...live.snapshot });
        return () => {
          live.emitter.off('update', onUpdate);
        };
      }

      let stopped = false;
      let timer: NodeJS.Timeout | undefined;
      const tick = () => {
        this.findRun(runId)
          .then((run) => {
            if (stopped) return;
            push(run);
            if (!done && run.status === 'running') {
              timer = setTimeout(tick, 2000);
            }
          })
          .catch((e: Error) => {
            if (!stopped) subscriber.error(e);
          });
      };
      tick();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    });
  }

  /** 某脚本的运行历史（倒序，上限 50） */
  listRuns(scriptPath: string): Promise<ScriptLibraryRun[]> {
    const normalized = this.normalizeScriptPath(scriptPath);
    return this.runs.find({
      where: { scriptPath: normalized },
      order: { id: 'DESC' },
      take: MAX_RUNS,
    });
  }

  async findRun(runId: number): Promise<ScriptLibraryRun> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    return run;
  }

  /** 脚本类型展示文案（列表徽标用） */
  kindLabel(kind: ScriptLibraryKind): string {
    if (kind === 'check') return '检查';
    if (kind === 'test') return '测试';
    return '导出';
  }

  /** GitHub main 分支原文链接 */
  private githubUrl(relPath: string): string {
    return `https://github.com/${this.syncService.getStatus().repo}/blob/main/${relPath}`;
  }

  /** 校验并归一化脚本路径：仅允许 projects/ 下三类后缀的相对路径（描述重新生成等外部调用共用） */
  normalizeScriptPath(input?: string): string {
    const normalized = (input ?? '').trim().replace(/\\/g, '/');
    if (
      !normalized ||
      path.isAbsolute(normalized) ||
      normalized.split('/').includes('..')
    ) {
      throw new BadRequestException(
        '脚本位置必须是相对脚本根目录的路径，如 projects/active/pk/tests/daily.test.ts',
      );
    }
    if (!normalized.startsWith(`${LIBRARY_ROOT}/`)) {
      throw new BadRequestException(
        `脚本库仅收录 ${LIBRARY_ROOT}/ 目录下的脚本`,
      );
    }
    if (!this.kindOf(normalized)) {
      throw new BadRequestException(
        '仅支持 .check.ts / .test.ts / .export.ts 脚本',
      );
    }
    return normalized;
  }

  /**
   * 脚本搜索相关度（0..1）：路径命中优先于描述命中，
   * 命中越精确分数越高；路径与描述同时命中时给少量加成。
   */
  private scriptRelevance(
    scriptPath: string,
    description: string | null,
    keyword: string,
  ): number | null {
    const pathText = scriptPath.toLowerCase();
    const name = path.basename(pathText);
    const descriptionText = (description ?? '').toLowerCase();

    const pathScore =
      pathText === keyword
        ? 1
        : name === keyword
          ? 0.96
          : pathText.startsWith(keyword)
            ? 0.9
            : name.startsWith(keyword)
              ? 0.84
              : pathText.includes(keyword)
                ? 0.76
                : null;
    const descriptionScore =
      descriptionText === keyword
        ? 0.62
        : descriptionText.includes(keyword)
          ? 0.55
          : null;

    if (pathScore === null && descriptionScore === null) return null;
    if (pathScore === null) return descriptionScore;
    if (descriptionScore === null) return pathScore;
    return Math.min(1, pathScore + 0.02);
  }

  /** 按后缀识别脚本类型；非脚本后缀返回 null */
  private kindOf(relPath: string): ScriptLibraryKind | null {
    for (const [suffix, kind] of KIND_BY_SUFFIX) {
      if (relPath.endsWith(suffix)) return kind;
    }
    return null;
  }

  /** 类型筛选参数解析：空/缺省为全部；非法值 400 */
  private parseKindFilter(type?: string): ScriptLibraryKind | null {
    if (!type) return null;
    if (type === 'check' || type === 'test' || type === 'export') return type;
    throw new BadRequestException('type 仅支持 check / test / export');
  }

  /** 解析脚本绝对路径并兜底防穿越（归一化时已校验 projects/ 前缀） */
  private resolveScriptPath(relPath: string): string {
    const abs = path.resolve(this.scriptsDir, relPath);
    if (!abs.startsWith(this.scriptsDir + path.sep)) {
      throw new BadRequestException('脚本位置不合法');
    }
    return abs;
  }

  /** 递归扫描 projects/ 下的三类脚本（上限 MAX_SCAN，含 mtime/size；描述生成队列复用） */
  async scanScripts(): Promise<ScannedScript[]> {
    const out: ScannedScript[] = [];
    const walk = async (relDir: string): Promise<void> => {
      if (out.length >= MAX_SCAN) return;
      let entries: import('fs').Dirent[];
      try {
        entries = await fs.readdir(path.join(this.scriptsDir, relDir), {
          withFileTypes: true,
        });
      } catch {
        return; // projects 目录不存在等场景返回空列表
      }
      for (const entry of entries) {
        if (out.length >= MAX_SCAN) return;
        const rel = `${relDir}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(rel);
        } else if (entry.isFile()) {
          const kind = this.kindOf(rel);
          if (!kind) continue;
          try {
            const stat = await fs.stat(path.join(this.scriptsDir, rel));
            if (!stat.isFile()) continue;
            out.push({
              path: rel,
              kind,
              size: stat.size,
              updatedAt: stat.mtime.toISOString(),
            });
          } catch {
            // 读取失败的文件跳过
          }
        }
      }
    };
    await walk(LIBRARY_ROOT);
    return out;
  }

  /** scriptPath → 登记该脚本的检查/用例/导出所属项目 id 集合 */
  private async ownershipMap(): Promise<Map<string, Set<number>>> {
    const [checks, tests, exports] = await Promise.all([
      this.checksService.findByProject(),
      this.testsService.findByProject(),
      this.exportsService.findByProject(),
    ]);
    const map = new Map<string, Set<number>>();
    const register = (scriptPath: string, projectId: number) => {
      const set = map.get(scriptPath) ?? new Set<number>();
      set.add(projectId);
      map.set(scriptPath, set);
    };
    for (const c of checks) register(c.scriptPath, c.projectId);
    for (const t of tests) register(t.scriptPath, t.projectId);
    for (const e of exports) register(e.scriptPath, e.projectId);
    return map;
  }

  /** 一批脚本的描述记录：path → row（无记录的脚本不在 Map 中） */
  private async descriptionsByPaths(
    paths: string[],
  ): Promise<Map<string, ScriptLibraryDescription>> {
    if (paths.length === 0) return new Map();
    const rows = await this.descriptions.find({
      where: { scriptPath: In(paths) },
    });
    return new Map(rows.map((r) => [r.scriptPath, r]));
  }

  /** 一批脚本的最近一次运行：path → run（DISTINCT ON 单查询） */
  private async latestRunsByPaths(
    paths: string[],
  ): Promise<Map<string, ScriptLibraryRun>> {
    const map = new Map<string, ScriptLibraryRun>();
    if (paths.length === 0) return map;
    const placeholders = paths.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await this.runs.query<Record<string, unknown>[]>(
      `SELECT DISTINCT ON ("scriptPath") * FROM "script_library_runs"
       WHERE "scriptPath" IN (${placeholders})
       ORDER BY "scriptPath", "id" DESC`,
      paths,
    );
    for (const row of rows) {
      const scriptPath = String(row['scriptPath']);
      // DISTINCT ON * 的列名与实体列一致，timestamptz 已由驱动转为 Date
      map.set(scriptPath, row as unknown as ScriptLibraryRun);
    }
    return map;
  }

  /**
   * 后台执行脚本：node 直跑 .ts（Node 24+ 原生类型擦除），以脚本根目录为 cwd，
   * 导出脚本追加 --output-dir 参数；逐行解析 stdout 行协议 `[{type}] {json}`
   * （start/act/check/done 与检查/测试一致，files 上报产物清单），
   * 实时更新步数，进程结束后落最终结果。
   */
  private executeRun(runId: number, absPath: string, outputDir?: string): void {
    const startedAt = Date.now();
    const items: ScriptLibraryRunItem[] = [];
    const logs: string[] = [];
    /** 脚本原始输出行（终端展示用），实时挂到 live 快照上随 SSE 推送 */
    const output: string[] = [];
    /** 产物文件清单（[files] 协议上报，多次上报以最后一次为准） */
    let files: ScriptLibraryRunFile[] = [];
    let total: number | null = null;
    let done: Record<string, unknown> | null = null;
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const args = outputDir ? [absPath, `--output-dir=${outputDir}`] : [absPath];
    const child = spawn('node', args, { cwd: this.scriptsDir });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, RUN_TIMEOUT_MS);

    const live = this.liveRuns.get(runId);
    if (live) live.snapshot.output = output;

    /** 实时推送当前快照（每行一次） */
    const emitLive = () => {
      if (live) live.emitter.emit('update', { ...live.snapshot });
    };

    /** 进度落库（fire-and-forget，失败不影响脚本消费） */
    const touch = (patch: Partial<ScriptLibraryRun>) => {
      if (live) Object.assign(live.snapshot, patch);
      void this.runs.update(runId, patch).catch(() => undefined);
    };

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      output.push(trimmed);
      const match = trimmed.match(/^\[(\w+)\]\s?(.*)$/s);
      const type = match?.[1] ?? 'log';
      const data = match?.[2] ?? trimmed;
      if (type === 'act' || type === 'check') {
        try {
          const item: ScriptLibraryRunItem = {
            kind: type,
            ...(JSON.parse(data) as Omit<ScriptLibraryRunItem, 'kind'>),
          };
          items.push(item);
          touch({ current: item.no ?? items.length });
        } catch {
          logs.push(trimmed);
        }
      } else if (type === 'start') {
        try {
          const start = JSON.parse(data) as { total?: number };
          if (typeof start.total === 'number') {
            total = start.total;
            touch({ total });
          }
        } catch {
          // 忽略无法解析的 start 行
        }
      } else if (type === 'files') {
        try {
          const parsed = JSON.parse(data) as ScriptLibraryRunFile[];
          if (Array.isArray(parsed)) {
            files = parsed.filter((f): f is ScriptLibraryRunFile => {
              if (!f || typeof f.file !== 'string' || f.file.length === 0) {
                return false;
              }
              // 产物仅允许相对本次输出目录的路径，拒绝绝对路径与目录穿越
              const normalized = f.file.replace(/\\/g, '/');
              return (
                !path.isAbsolute(normalized) &&
                !normalized.split('/').includes('..')
              );
            });
            touch({ files });
          }
        } catch {
          // 忽略无法解析的 files 行
        }
      } else if (type === 'done') {
        try {
          done = JSON.parse(data) as Record<string, unknown>;
        } catch {
          // 忽略无法解析的 done 行
        }
      } else {
        logs.push(trimmed);
      }
      emitLive();
    };

    const finalize = (errorMessage?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const status = done
        ? done.status === 'success'
          ? 'success'
          : 'fail'
        : 'error';
      let message = done
        ? (done.message as string) || null
        : stderr.trim().split('\n').slice(-5).join('\n') ||
          (errorMessage ?? '脚本异常退出，未输出 [done]');
      // 超时场景无论是否有 stderr 输出，都明确标注超时
      if (!done && timedOut) {
        message = `脚本执行超时（>${RUN_TIMEOUT_MS / 1000}s）${message ? `：${message}` : ''}`;
      }
      const finalPatch: Partial<ScriptLibraryRun> = {
        status,
        message,
        items,
        logs,
        output,
        files,
        total: (done?.total as number) ?? total,
        // 最终步数一并落定，避免与运行中的进度更新乱序
        current: (done?.total as number) ?? items.length,
        success: (done?.success as number) ?? null,
        fail: (done?.fail as number) ?? null,
        skip: (done?.skip as number) ?? null,
        durationMs: (done?.cost as number) ?? Date.now() - startedAt,
        finishedAt: new Date(),
      };
      // 先落库再推终态快照，保证 SSE 晚订阅读库也能拿到最终结果
      void this.runs
        .update(runId, finalPatch)
        .catch(() => undefined)
        .then(() => {
          const live = this.liveRuns.get(runId);
          if (live) {
            Object.assign(live.snapshot, finalPatch);
            live.emitter.emit('update', { ...live.snapshot });
            // 终态快照保留 TTL，供晚到的 SSE 订阅直接取结果
            setTimeout(() => this.liveRuns.delete(runId), LIVE_SNAPSHOT_TTL_MS);
          }
        });
    };

    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx = buffer.indexOf('\n');
      while (idx >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (e) => finalize(e.message));
    child.on('close', () => {
      if (buffer.trim()) handleLine(buffer);
      finalize();
    });
  }
}

/** 运行中的实时状态：快照 + 变更事件（SSE 订阅用） */
interface LiveRun {
  snapshot: ScriptLibraryRun;
  emitter: EventEmitter;
}
