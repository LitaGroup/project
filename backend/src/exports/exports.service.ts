import {
  BadRequestException,
  ConflictException,
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
import { exportWebroot } from '../common/paths';
import { Project } from '../projects/project.entity';
import { ExportRun, ExportRunFile, ExportRunItem } from './export-run.entity';
import { Export } from './export.entity';

/** 扫描结果上限，防止脚本目录过大时拖垮接口 */
const MAX_SCRIPTS = 500;
/** 导出脚本文件名匹配 */
const isExportScriptFile = (name: string) => name.endsWith('.export.ts');
/** 单次脚本执行的超时时间（毫秒） */
const RUN_TIMEOUT_MS = 120_000;
/** 运行历史返回条数上限 */
const MAX_RUNS = 50;

/** 项目 .md 视图中每条导出展示的最近运行条数 */
const DEFAULT_RECENT_RUNS = 3;
/** 终态实时快照的保留时长（供晚到的 SSE 订阅直接取到结果） */
const LIVE_SNAPSHOT_TTL_MS = 5 * 60_000;

/** 运行中的实时状态：快照 + 变更事件（SSE 订阅用） */
interface LiveRun {
  snapshot: ExportRun;
  emitter: EventEmitter;
}

export interface ExportInput {
  projectId: number;
  code: string;
  description?: string;
  scriptPath: string;
}

@Injectable()
export class ExportsService {
  /** 导出脚本根目录（CHECK_SCRIPTS_DIR），.export.ts 文件以此为基准存相对路径 */
  private readonly scriptsDir: string;

  /** 运行中的实时状态（runId → 快照+事件），终态后保留 TTL 供 SSE 晚订阅 */
  private readonly liveRuns = new Map<number, LiveRun>();

  constructor(
    @InjectRepository(Export)
    private readonly exports: Repository<Export>,
    @InjectRepository(ExportRun)
    private readonly runs: Repository<ExportRun>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    config: ConfigService,
  ) {
    this.scriptsDir = path.resolve(
      config.get<string>('CHECK_SCRIPTS_DIR') ??
        path.resolve(process.cwd(), '../scripts'),
    );
  }

  /** 按项目列出导出；不传 projectId 时返回全部（全局列表页用） */
  findByProject(projectId?: number): Promise<Export[]> {
    return this.exports.find({
      where: projectId === undefined ? {} : { projectId },
      order: { updatedAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<Export> {
    const exportItem = await this.exports.findOne({ where: { id } });
    if (!exportItem) throw new NotFoundException(`Export ${id} not found`);
    return exportItem;
  }

  async create(input: ExportInput): Promise<Export> {
    await this.assertCodeAvailable(input.projectId, input.code);
    return this.exports.save(
      this.exports.create({
        projectId: input.projectId,
        code: input.code,
        description: input.description || null,
        scriptPath: this.normalizeScriptPath(input.scriptPath),
      }),
    );
  }

  /**
   * 自动导入：扫描项目脚本目录（scriptsPath）下 exports 子目录的所有 .export.ts，
   * 跳过已登记的，其余按文件名生成编号全部导入（描述留空待补充）。
   */
  async importFromScripts(
    projectId: number,
  ): Promise<{ created: Export[]; skipped: number }> {
    const scripts = await this.listScripts(undefined, projectId);
    const existing = await this.exports.find({
      where: { projectId },
      select: { code: true, scriptPath: true },
    });
    const usedPaths = new Set(existing.map((e) => e.scriptPath));
    const usedCodes = new Set(existing.map((e) => e.code));
    const created: Export[] = [];
    for (const scriptPath of scripts) {
      if (usedPaths.has(scriptPath)) continue;
      created.push(
        await this.exports.save(
          this.exports.create({
            projectId,
            code: this.pickAvailableCode(scriptPath, usedCodes),
            description: null,
            scriptPath,
          }),
        ),
      );
    }
    return { created, skipped: scripts.length - created.length };
  }

  /** 由脚本文件名生成项目内唯一编号：daily.export.ts → daily，冲突时追加 -2、-3… */
  private pickAvailableCode(
    scriptPath: string,
    usedCodes: Set<string>,
  ): string {
    const base = (scriptPath.split('/').pop() ?? scriptPath).replace(
      /\.export\.ts$/,
      '',
    );
    let code = base;
    let n = 2;
    while (usedCodes.has(code)) {
      code = `${base}-${n++}`;
    }
    usedCodes.add(code);
    return code;
  }

  async update(
    id: number,
    input: Partial<Pick<Export, 'code' | 'description' | 'scriptPath'>>,
  ): Promise<Export> {
    const exportItem = await this.findOne(id);
    if (input.code !== undefined && input.code !== exportItem.code) {
      await this.assertCodeAvailable(exportItem.projectId, input.code);
      exportItem.code = input.code;
    }
    if (input.description !== undefined) {
      exportItem.description = input.description || null;
    }
    if (input.scriptPath !== undefined) {
      exportItem.scriptPath = this.normalizeScriptPath(input.scriptPath);
    }
    return this.exports.save(exportItem);
  }

  async remove(id: number): Promise<void> {
    const exportItem = await this.findOne(id);
    // 应用层级联：先清运行记录与产物目录，再删登记（无物理外键）
    await this.runs.delete({ exportId: exportItem.id });
    await this.removeOutputDir(exportItem.id);
    await this.exports.remove(exportItem);
  }

  /** 删除项目时的应用层级联清理（测试库无物理外键） */
  async removeByProject(projectId: number): Promise<void> {
    const exports = await this.exports.find({
      where: { projectId },
      select: { id: true },
    });
    if (exports.length > 0) {
      await this.runs.delete({ exportId: In(exports.map((e) => e.id)) });
      for (const e of exports) {
        await this.removeOutputDir(e.id);
      }
    }
    await this.exports.delete({ projectId });
  }

  /** 该导出的产物根目录：exportWebroot()/{exportId}（每次运行再按 runId 分目录） */
  private outputRoot(exportId: number): string {
    return path.join(exportWebroot(), String(exportId));
  }

  /** 清理导出的产物目录（删除登记/项目时调用，失败不影响删除流程） */
  private async removeOutputDir(exportId: number): Promise<void> {
    await fs.rm(this.outputRoot(exportId), { recursive: true, force: true });
  }

  /**
   * 启动一次脚本运行：先落 running 记录并立即返回，脚本在后台异步执行。
   * 脚本经 --output-dir 拿到本次运行的输出目录（exportWebroot()/{exportId}/{runId}），
   * 产出文件经 [files] 协议上报，运行中实时更新 total/current，结束后落完整结果。
   */
  async startRun(exportId: number): Promise<ExportRun> {
    const exportItem = await this.findOne(exportId);
    const absPath = await this.resolveScriptPath(exportItem.scriptPath);
    const run = await this.runs.save(
      this.runs.create({
        exportId,
        status: 'running',
        startedAt: new Date(),
      }),
    );
    const outputDir = path.join(this.outputRoot(exportId), String(run.id));
    await fs.mkdir(outputDir, { recursive: true });
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
      const push = (snapshot: ExportRun) => {
        if (done) return;
        subscriber.next({ data: snapshot });
        if (snapshot.status !== 'running') {
          done = true;
          subscriber.complete();
        }
      };

      const live = this.liveRuns.get(runId);
      if (live) {
        // 先挂监听再推快照，避免间隙漏事件；done 后的事件为 no-op
        const onUpdate = (s: ExportRun) => push(s);
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

  /** 运行历史（倒序，上限 50） */
  listRuns(exportId: number): Promise<ExportRun[]> {
    return this.runs.find({
      where: { exportId },
      order: { id: 'DESC' },
      take: MAX_RUNS,
    });
  }

  /**
   * 各导出最近几次运行（项目 .md 视图用）：Map<exportId, ExportRun[]>。
   * 项目内导出数量不大，按 id 并行小查询（避免巨型 JOIN/分组窗口查询）。
   */
  async recentRunsByExportIds(
    exportIds: number[],
    take = DEFAULT_RECENT_RUNS,
  ): Promise<Map<number, ExportRun[]>> {
    const map = new Map<number, ExportRun[]>();
    await Promise.all(
      exportIds.map(async (id) =>
        map.set(
          id,
          await this.runs.find({
            where: { exportId: id },
            order: { id: 'DESC' },
            take,
          }),
        ),
      ),
    );
    return map;
  }

  async findRun(runId: number): Promise<ExportRun> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    return run;
  }

  /** 解析脚本绝对路径并校验存在性（兜底防穿越，登记时已校验相对路径） */
  private async resolveScriptPath(scriptPath: string): Promise<string> {
    const absPath = path.resolve(this.scriptsDir, scriptPath);
    if (!absPath.startsWith(this.scriptsDir + path.sep)) {
      throw new BadRequestException('脚本位置不合法');
    }
    try {
      await fs.access(absPath);
    } catch {
      throw new NotFoundException(`脚本文件不存在: ${scriptPath}`);
    }
    return absPath;
  }

  /**
   * 后台执行脚本：node 直跑 .export.ts（Node 24+ 原生类型擦除），以脚本根目录为 cwd，
   * 传入 --output-dir={本次运行输出目录}，逐行解析 stdout 的行协议 `[{type}] {json}`
   * （start/act/check/done 与检查/测试一致，另有 files 上报产出文件清单），
   * 实时更新步数，进程结束后落最终结果。
   */
  private executeRun(runId: number, absPath: string, outputDir: string): void {
    const startedAt = Date.now();
    const items: ExportRunItem[] = [];
    const logs: string[] = [];
    /** 脚本原始输出行（终端展示用），实时挂到 live 快照上随 SSE 推送 */
    const output: string[] = [];
    /** 产出文件清单（[files] 协议上报，多次上报以最后一次为准） */
    let files: ExportRunFile[] = [];
    let total: number | null = null;
    let done: Record<string, unknown> | null = null;
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn('node', [absPath, `--output-dir=${outputDir}`], {
      cwd: this.scriptsDir,
    });
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
    const touch = (patch: Partial<ExportRun>) => {
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
          const item: ExportRunItem = {
            kind: type,
            ...(JSON.parse(data) as Omit<ExportRunItem, 'kind'>),
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
          const parsed = JSON.parse(data) as ExportRunFile[];
          if (Array.isArray(parsed)) {
            files = parsed.filter(
              (f): f is ExportRunFile =>
                !!f && typeof f.file === 'string' && f.file.length > 0,
            );
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
      const finalPatch: Partial<ExportRun> = {
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

  /**
   * 扫描 .export.ts 文件，返回相对脚本根目录的路径（POSIX 风格），
   * 供前端填写脚本位置时自动联想/搜索。
   * 传 projectId 时只扫描项目脚本目录（scriptsPath，未配置则为根目录）下的
   * exports 子目录（返回路径仍相对根目录）；不传时扫描整个根目录。
   */
  async listScripts(keyword?: string, projectId?: number): Promise<string[]> {
    let baseDir = this.scriptsDir;
    if (projectId !== undefined) {
      const project = await this.projects.findOne({ where: { id: projectId } });
      if (!project)
        throw new NotFoundException(`Project ${projectId} not found`);
      baseDir = path.join(
        this.scriptsDir,
        ...(project.scriptsPath ? [project.scriptsPath] : []),
        'exports',
      );
    }
    const all: string[] = [];
    await this.walk(baseDir, all);
    const kw = keyword?.trim().toLowerCase();
    return all
      .filter((p) => !kw || p.toLowerCase().includes(kw))
      .sort()
      .slice(0, MAX_SCRIPTS);
  }

  /** 递归收集匹配脚本文件的相对路径；目录不存在时返回空（未配置脚本目录不视为错误） */
  private async walk(dir: string, out: string[]): Promise<void> {
    if (out.length >= MAX_SCRIPTS) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_SCRIPTS) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // 跳过隐藏目录与依赖目录
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }
        await this.walk(full, out);
      } else if (entry.isFile() && isExportScriptFile(entry.name)) {
        out.push(
          path.relative(this.scriptsDir, full).split(path.sep).join('/'),
        );
      }
    }
  }

  /** 只允许相对路径，拒绝绝对路径与目录穿越 */
  private normalizeScriptPath(scriptPath: string): string {
    const normalized = scriptPath.trim().replace(/\\/g, '/');
    if (
      !normalized ||
      path.isAbsolute(normalized) ||
      normalized.split('/').includes('..')
    ) {
      throw new BadRequestException(
        '脚本位置必须是相对脚本根目录的路径，如 rank/exports/daily.export.ts',
      );
    }
    return normalized;
  }

  private async assertCodeAvailable(
    projectId: number,
    code: string,
  ): Promise<void> {
    const existing = await this.exports.findOne({ where: { projectId, code } });
    if (existing) {
      throw new ConflictException(`编号 ${code} 已存在`);
    }
  }
}
