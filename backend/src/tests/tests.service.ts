import {
  BadRequestException,
  ConflictException,
  Injectable,
  MessageEvent,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Observable } from 'rxjs';
import { In, Repository } from 'typeorm';
import { AppVersion } from '../app-versions/app-version.entity';
import {
  type RemoteRunContext,
  RemoteRunService,
  isRemoteDevice,
} from '../remote-run/remote-run.service';
import { Project } from '../projects/project.entity';
import { TestRun, TestRunItem } from './test-run.entity';
import { Test } from './test.entity';

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
  snapshot: TestRun;
  emitter: EventEmitter;
}

export interface TestInput {
  projectId: number;
  code: string;
  description?: string;
  scriptPath: string;
  /** 运行设备/目标：server/h5 本地直跑；android/ios 走 appium-agent 远程 */
  device?: string | null;
}

@Injectable()
export class TestsService implements OnModuleInit {
  private readonly scriptsDir: string;

  /** 运行中的实时状态（runId → 快照+事件），终态后保留 TTL 供 SSE 晚订阅 */
  private readonly liveRuns = new Map<number, LiveRun>();

  constructor(
    @InjectRepository(Test)
    private readonly tests: Repository<Test>,
    @InjectRepository(TestRun)
    private readonly runs: Repository<TestRun>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(AppVersion)
    private readonly appVersions: Repository<AppVersion>,
    private readonly remoteRun: RemoteRunService,
    config: ConfigService,
  ) {
    this.scriptsDir = path.resolve(
      config.get<string>('CHECK_SCRIPTS_DIR') ??
        path.resolve(process.cwd(), '../scripts'),
    );
  }

  onModuleInit(): void {
    // 注册 appium-agent 远程执行回调（操作 test_runs + live 快照）
    this.remoteRun.register('test', {
      onActivate: (ctx, agentName) => {
        const live = this.liveRuns.get(ctx.runId);
        if (live) {
          Object.assign(live.snapshot, { status: 'running', agentName });
          live.emitter.emit('update', { ...live.snapshot });
        }
      },
      onProgress: (ctx, patch) => {
        const live = this.liveRuns.get(ctx.runId);
        if (!live) return;
        live.snapshot.output = ctx.output;
        if (patch) {
          Object.assign(live.snapshot, patch);
          void this.runs.update(ctx.runId, patch).catch(() => undefined);
        }
        live.emitter.emit('update', { ...live.snapshot });
      },
      onFinalize: (ctx, patch) => this.applyRemoteFinal(ctx, patch),
      onAbort: (ctx, patch) => this.applyRemoteFinal(ctx, patch),
    });
  }

  /** 按项目列出测试；不传 projectId 时返回全部（全局列表页用） */
  findByProject(projectId?: number): Promise<Test[]> {
    return this.tests.find({
      where: projectId === undefined ? {} : { projectId },
      order: { updatedAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<Test> {
    const test = await this.tests.findOne({ where: { id } });
    if (!test) throw new NotFoundException(`Test ${id} not found`);
    return test;
  }

  /** 按脚本相对路径查找本项目已登记的测试（缺陷验证用），未登记返回 null */
  findByScriptPath(
    projectId: number,
    scriptPath: string,
  ): Promise<Test | null> {
    return this.tests.findOne({ where: { projectId, scriptPath } });
  }

  /** 某测试最近一次运行（缺陷标记 fixed 的前置校验用），无运行记录返回 null */
  findLatestRun(testId: number): Promise<TestRun | null> {
    return this.runs.findOne({ where: { testId }, order: { id: 'DESC' } });
  }

  async create(input: TestInput): Promise<Test> {
    await this.assertCodeAvailable(input.projectId, input.code);
    return this.tests.save(
      this.tests.create({
        projectId: input.projectId,
        code: input.code,
        description: input.description || null,
        scriptPath: this.normalizeScriptPath(input.scriptPath),
        device: this.normalizeDevice(input.device),
      }),
    );
  }

  /**
   * 自动导入：扫描项目脚本目录（scriptsPath，未配置则整个根目录）下所有 .test.ts，
   * 跳过已登记的，其余按文件名生成编号全部导入（描述留空待补充）。
   */
  async importFromScripts(
    projectId: number,
  ): Promise<{ created: Test[]; skipped: number }> {
    const scripts = await this.listScripts(undefined, projectId);
    const existing = await this.tests.find({
      where: { projectId },
      select: { code: true, scriptPath: true },
    });
    const usedPaths = new Set(existing.map((c) => c.scriptPath));
    const usedCodes = new Set(existing.map((c) => c.code));
    const created: Test[] = [];
    for (const scriptPath of scripts) {
      if (usedPaths.has(scriptPath)) continue;
      created.push(
        await this.tests.save(
          this.tests.create({
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

  /** 由脚本文件名生成项目内唯一编号：daily.test.ts → daily，冲突时追加 -2、-3… */
  private pickAvailableCode(
    scriptPath: string,
    usedCodes: Set<string>,
  ): string {
    const base = (scriptPath.split('/').pop() ?? scriptPath).replace(
      /\.test\.ts$/,
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
    input: Partial<
      Pick<Test, 'code' | 'description' | 'scriptPath' | 'device'>
    >,
  ): Promise<Test> {
    const test = await this.findOne(id);
    if (input.code !== undefined && input.code !== test.code) {
      await this.assertCodeAvailable(test.projectId, input.code);
      test.code = input.code;
    }
    if (input.description !== undefined) {
      test.description = input.description || null;
    }
    if (input.scriptPath !== undefined) {
      test.scriptPath = this.normalizeScriptPath(input.scriptPath);
    }
    if (input.device !== undefined) {
      test.device = this.normalizeDevice(input.device);
    }
    return this.tests.save(test);
  }

  async remove(id: number): Promise<void> {
    const test = await this.findOne(id);
    // 应用层级联：先清运行记录再删登记（无物理外键）
    await this.runs.delete({ testId: test.id });
    await this.tests.remove(test);
  }

  /** 删除项目时的应用层级联清理（测试库无物理外键） */
  async removeByProject(projectId: number): Promise<void> {
    const tests = await this.tests.find({
      where: { projectId },
      select: { id: true },
    });
    if (tests.length > 0) {
      await this.runs.delete({ testId: In(tests.map((t) => t.id)) });
    }
    await this.tests.delete({ projectId });
  }

  /**
   * 启动一次脚本运行：先落记录并立即返回。
   * - device 为 android/ios → 入队等待 appium-agent 远程执行
   * - 否则（server/h5/空）→ 落 running 记录，脚本在后台异步 spawn 执行
   */
  async startRun(testId: number, appVersionId?: number): Promise<TestRun> {
    const test = await this.findOne(testId);
    if (isRemoteDevice(test.device)) {
      return this.enqueueRemoteRun(test, appVersionId);
    }
    const absPath = await this.resolveScriptPath(test.scriptPath);
    const run = await this.runs.save(
      this.runs.create({ testId, status: 'running', startedAt: new Date() }),
    );
    this.liveRuns.set(run.id, { snapshot: run, emitter: new EventEmitter() });
    this.executeRun(run.id, absPath);
    return run;
  }

  /** APP 测试（device=android/ios）：创建 queued 记录入队，交给 RemoteRunService 派发 */
  private async enqueueRemoteRun(
    test: Test,
    appVersionId?: number,
  ): Promise<TestRun> {
    let appVersion: AppVersion | null = null;
    if (appVersionId) {
      appVersion = await this.appVersions.findOne({
        where: { id: appVersionId },
      });
      if (!appVersion) {
        throw new NotFoundException(`AppVersion ${appVersionId} not found`);
      }
    }
    const now = new Date();
    const run = await this.runs.save(
      this.runs.create({
        testId: test.id,
        status: 'queued',
        startedAt: now,
        queuedAt: now,
        appVersionId: appVersionId ?? null,
      }),
    );
    this.liveRuns.set(run.id, { snapshot: run, emitter: new EventEmitter() });
    const runTitle = this.runTitle(test, appVersion);
    this.remoteRun.enqueue('test', run.id, {
      projectId: test.projectId,
      runTitle,
      checkCode: test.code,
      scriptPath: test.scriptPath,
      device: test.device!,
      appVersion,
      source: 'manual',
    });
    return run;
  }

  /** 运行卡片标题：测试编号 - 应用 版本 */
  private runTitle(test: Test, appVersion: AppVersion | null): string {
    const parts = [`测试：${test.code}`];
    if (appVersion) parts.push(`${appVersion.appTarget} ${appVersion.version}`);
    return parts.join(' - ');
  }

  /** 远程终态/中断：落 patch + 推 SSE 终态（测试运行不发飞书通知，仅任务触发的检查运行发） */
  private applyRemoteFinal(
    ctx: RemoteRunContext,
    patch: Record<string, unknown>,
  ): void {
    void this.runs
      .update(ctx.runId, patch)
      .catch(() => undefined)
      .then(() => {
        const live = this.liveRuns.get(ctx.runId);
        if (live) {
          Object.assign(live.snapshot, patch);
          live.emitter.emit('update', { ...live.snapshot });
          setTimeout(
            () => this.liveRuns.delete(ctx.runId),
            LIVE_SNAPSHOT_TTL_MS,
          );
        }
      });
  }

  /**
   * 单次运行的 SSE 实时流：先推当前快照，运行中每次进度变化推送，终态推送后完成。
   * 无实时句柄时（已结束/服务重启）读库，running/queued 则低频兜底轮询直至结束。
   */
  streamRun(runId: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let done = false;
      const push = (snapshot: TestRun) => {
        if (done) return;
        subscriber.next({ data: snapshot });
        if (snapshot.status !== 'running' && snapshot.status !== 'queued') {
          done = true;
          subscriber.complete();
        }
      };

      const live = this.liveRuns.get(runId);
      if (live) {
        const onUpdate = (s: TestRun) => push(s);
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
            if (
              !done &&
              (run.status === 'running' || run.status === 'queued')
            ) {
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
  listRuns(testId: number): Promise<TestRun[]> {
    return this.runs.find({
      where: { testId },
      order: { id: 'DESC' },
      take: MAX_RUNS,
    });
  }

  async findRun(runId: number): Promise<TestRun> {
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
   * 后台执行脚本（本地，device=server/h5）：node 直跑 .test.ts（Node 24+ 原生类型擦除），
   * 以脚本根目录为 cwd，逐行解析 stdout 的行协议 `[{type}] {json}`，
   * 实时更新步数，进程结束后落最终结果（前端通过 SSE 实时获取进度）。
   * device=android/ios 的远程执行由 enqueueRemoteRun + RemoteRunService 处理。
   */
  private executeRun(runId: number, absPath: string): void {
    const startedAt = Date.now();
    const items: TestRunItem[] = [];
    const logs: string[] = [];
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

    const emitLive = () => {
      if (live) live.emitter.emit('update', { ...live.snapshot });
    };

    const touch = (patch: Partial<TestRun>) => {
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
          const item: TestRunItem = {
            kind: type,
            ...(JSON.parse(data) as Omit<TestRunItem, 'kind'>),
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
      const finalPatch: Partial<TestRun> = {
        status,
        message,
        items,
        logs,
        output,
        total: (done?.total as number) ?? total,
        current: (done?.total as number) ?? items.length,
        success: (done?.success as number) ?? null,
        fail: (done?.fail as number) ?? null,
        skip: (done?.skip as number) ?? null,
        durationMs: (done?.cost as number) ?? Date.now() - startedAt,
        finishedAt: new Date(),
      };
      void this.runs
        .update(runId, finalPatch)
        .catch(() => undefined)
        .then(() => {
          const live = this.liveRuns.get(runId);
          if (!live) return;
          Object.assign(live.snapshot, finalPatch);
          live.emitter.emit('update', { ...live.snapshot });
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
   * 扫描 .test.ts 文件，返回相对脚本根目录的路径（POSIX 风格），
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

  /** 递归收集 .test.ts 相对路径；目录不存在时返回空（未配置脚本目录不视为错误） */
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
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }
        await this.walk(full, out);
      } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
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
        '脚本位置必须是相对脚本根目录的路径，如 rank/daily.test.ts',
      );
    }
    return normalized;
  }

  /** device 归一：空串/null → null，否则 trim */
  private normalizeDevice(v: string | null | undefined): string | null {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return t || null;
  }

  private async assertCodeAvailable(
    projectId: number,
    code: string,
  ): Promise<void> {
    const existing = await this.tests.findOne({ where: { projectId, code } });
    if (existing) {
      throw new ConflictException(`编号 ${code} 已存在`);
    }
  }
}
