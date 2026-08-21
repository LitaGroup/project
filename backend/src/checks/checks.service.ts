import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
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
import { Project } from '../projects/project.entity';
import { TasksService } from '../tasks/tasks.service';
import { CheckRun, CheckRunItem } from './check-run.entity';
import { Check } from './check.entity';

/** 扫描结果上限，防止脚本目录过大时拖垮接口 */
const MAX_SCRIPTS = 500;
/** 单次脚本执行的超时时间（毫秒） */
const RUN_TIMEOUT_MS = 120_000;
/** 运行历史返回条数上限 */
const MAX_RUNS = 50;
/** 终态实时快照的保留时长（供晚到的 SSE 订阅直接取到结果） */
const LIVE_SNAPSHOT_TTL_MS = 5 * 60_000;

/** 运行中的实时状态：快照 + 变更事件（SSE 订阅用） */
interface LiveRun {
  snapshot: CheckRun;
  emitter: EventEmitter;
}

export interface CheckInput {
  projectId: number;
  code: string;
  description?: string;
  scriptPath: string;
}

@Injectable()
export class ChecksService {
  /** 检查脚本根目录（CHECK_SCRIPTS_DIR），.check.ts 文件以此为基准存相对路径 */
  private readonly scriptsDir: string;

  /** 运行中的实时状态（runId → 快照+事件），终态后保留 TTL 供 SSE 晚订阅 */
  private readonly liveRuns = new Map<number, LiveRun>();

  constructor(
    @InjectRepository(Check)
    private readonly checks: Repository<Check>,
    @InjectRepository(CheckRun)
    private readonly runs: Repository<CheckRun>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
    config: ConfigService,
  ) {
    this.scriptsDir = path.resolve(
      config.get<string>('CHECK_SCRIPTS_DIR') ??
        path.resolve(process.cwd(), '../scripts'),
    );
  }

  findByProject(projectId: number): Promise<Check[]> {
    return this.checks.find({
      where: { projectId },
      order: { updatedAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<Check> {
    const check = await this.checks.findOne({ where: { id } });
    if (!check) throw new NotFoundException(`Check ${id} not found`);
    return check;
  }

  async create(input: CheckInput): Promise<Check> {
    await this.assertCodeAvailable(input.projectId, input.code);
    return this.checks.save(
      this.checks.create({
        projectId: input.projectId,
        code: input.code,
        description: input.description || null,
        scriptPath: this.normalizeScriptPath(input.scriptPath),
      }),
    );
  }

  /**
   * 自动导入：扫描项目脚本目录（scriptsPath，未配置则整个根目录）下所有 .check.ts，
   * 跳过已登记的，其余按文件名生成编号全部导入（描述留空待补充）。
   */
  async importFromScripts(
    projectId: number,
  ): Promise<{ created: Check[]; skipped: number }> {
    const scripts = await this.listScripts(undefined, projectId);
    const existing = await this.checks.find({
      where: { projectId },
      select: { code: true, scriptPath: true },
    });
    const usedPaths = new Set(existing.map((c) => c.scriptPath));
    const usedCodes = new Set(existing.map((c) => c.code));
    const created: Check[] = [];
    for (const scriptPath of scripts) {
      if (usedPaths.has(scriptPath)) continue;
      created.push(
        await this.checks.save(
          this.checks.create({
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

  /** 由脚本文件名生成项目内唯一编号：daily.check.ts → daily，冲突时追加 -2、-3… */
  private pickAvailableCode(
    scriptPath: string,
    usedCodes: Set<string>,
  ): string {
    const base = (scriptPath.split('/').pop() ?? scriptPath).replace(
      /\.check\.ts$/,
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
    input: Partial<Pick<Check, 'code' | 'description' | 'scriptPath'>>,
  ): Promise<Check> {
    const check = await this.findOne(id);
    if (input.code !== undefined && input.code !== check.code) {
      await this.assertCodeAvailable(check.projectId, input.code);
      check.code = input.code;
    }
    if (input.description !== undefined) {
      check.description = input.description || null;
    }
    if (input.scriptPath !== undefined) {
      check.scriptPath = this.normalizeScriptPath(input.scriptPath);
    }
    return this.checks.save(check);
  }

  async remove(id: number): Promise<void> {
    const check = await this.findOne(id);
    // 应用层级联：先清运行记录与依赖该检查的任务，再删登记（无物理外键）
    await this.runs.delete({ checkId: check.id });
    await this.tasksService.removeByCheck(check.id);
    await this.checks.remove(check);
  }

  /** 删除项目时的应用层级联清理（测试库无物理外键） */
  async removeByProject(projectId: number): Promise<void> {
    const checks = await this.checks.find({
      where: { projectId },
      select: { id: true },
    });
    if (checks.length > 0) {
      await this.runs.delete({ checkId: In(checks.map((c) => c.id)) });
      for (const check of checks) {
        await this.tasksService.removeByCheck(check.id);
      }
    }
    await this.checks.delete({ projectId });
  }

  /**
   * 启动一次脚本运行：先落 running 记录并立即返回，脚本在后台异步执行，
   * 运行中实时更新 total/current，结束后落完整结果（前端通过 SSE 实时获取进度）。
   * taskId 标记触发来源（定时任务），手动运行为空。
   */
  async startRun(checkId: number, taskId?: number): Promise<CheckRun> {
    const check = await this.findOne(checkId);
    const absPath = await this.resolveScriptPath(check.scriptPath);
    const run = await this.runs.save(
      this.runs.create({
        checkId,
        taskId: taskId ?? null,
        status: 'running',
        startedAt: new Date(),
      }),
    );
    this.liveRuns.set(run.id, { snapshot: run, emitter: new EventEmitter() });
    this.executeRun(run.id, absPath);
    return run;
  }

  /**
   * 单次运行的 SSE 实时流：先推当前快照，运行中每次进度变化推送，终态推送后完成。
   * 无实时句柄时（已结束/服务重启）读库，running 则低频兜底轮询直至结束。
   */
  streamRun(runId: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let done = false;
      const push = (snapshot: CheckRun) => {
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
        const onUpdate = (s: CheckRun) => push(s);
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
  listRuns(checkId: number): Promise<CheckRun[]> {
    return this.runs.find({
      where: { checkId },
      order: { id: 'DESC' },
      take: MAX_RUNS,
    });
  }

  /** 某次任务触发的运行历史（倒序，上限 50；任务详情页用） */
  listRunsByTask(taskId: number): Promise<CheckRun[]> {
    return this.runs.find({
      where: { taskId },
      order: { id: 'DESC' },
      take: MAX_RUNS,
    });
  }

  async findRun(runId: number): Promise<CheckRun> {
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
   * 后台执行脚本：node 直跑 .check.ts（Node 24+ 原生类型擦除），以脚本根目录为 cwd，
   * 逐行解析 stdout 的行协议 `[{type}] {json}`，实时更新步数，进程结束后落最终结果。
   */
  private executeRun(runId: number, absPath: string): void {
    const startedAt = Date.now();
    const items: CheckRunItem[] = [];
    const logs: string[] = [];
    /** 脚本原始输出行（终端展示用），实时挂到 live 快照上随 SSE 推送 */
    const output: string[] = [];
    let total: number | null = null;
    let done: Record<string, unknown> | null = null;
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn('node', [absPath], { cwd: this.scriptsDir });
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
    const touch = (patch: Partial<CheckRun>) => {
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
          const item: CheckRunItem = {
            kind: type,
            ...(JSON.parse(data) as Omit<CheckRunItem, 'kind'>),
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
      const message = done
        ? (done.message as string) || null
        : stderr.trim().split('\n').slice(-5).join('\n') ||
          (timedOut
            ? `脚本执行超时（>${RUN_TIMEOUT_MS / 1000}s）`
            : (errorMessage ?? '脚本异常退出，未输出 [done]'));
      const finalPatch: Partial<CheckRun> = {
        status,
        message,
        items,
        logs,
        output,
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
          if (!live) return;
          Object.assign(live.snapshot, finalPatch);
          live.emitter.emit('update', { ...live.snapshot });
          // 终态快照保留 TTL，供晚到的 SSE 订阅直接取结果
          setTimeout(() => this.liveRuns.delete(runId), LIVE_SNAPSHOT_TTL_MS);
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
   * 扫描 .check.ts 文件，返回相对脚本根目录的路径（POSIX 风格），
   * 供前端填写脚本位置时自动联想/搜索。
   * 传 projectId 且项目配置了 scriptsPath 时，只扫描该子目录（返回路径仍相对根目录）。
   */
  async listScripts(keyword?: string, projectId?: number): Promise<string[]> {
    let baseDir = this.scriptsDir;
    if (projectId !== undefined) {
      const project = await this.projects.findOne({ where: { id: projectId } });
      if (!project)
        throw new NotFoundException(`Project ${projectId} not found`);
      if (project.scriptsPath) {
        baseDir = path.join(this.scriptsDir, project.scriptsPath);
      }
    }
    const all: string[] = [];
    await this.walk(baseDir, all);
    const kw = keyword?.trim().toLowerCase();
    return all
      .filter((p) => !kw || p.toLowerCase().includes(kw))
      .sort()
      .slice(0, MAX_SCRIPTS);
  }

  /** 递归收集 .check.ts 相对路径；目录不存在时返回空（未配置脚本目录不视为错误） */
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
      } else if (entry.isFile() && entry.name.endsWith('.check.ts')) {
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
        '脚本位置必须是相对脚本根目录的路径，如 rank/daily.check.ts',
      );
    }
    return normalized;
  }

  private async assertCodeAvailable(
    projectId: number,
    code: string,
  ): Promise<void> {
    const existing = await this.checks.findOne({ where: { projectId, code } });
    if (existing) {
      throw new ConflictException(`编号 ${code} 已存在`);
    }
  }
}
