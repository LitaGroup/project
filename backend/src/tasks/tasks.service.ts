import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { CronJob } from 'cron';
import { Observable } from 'rxjs';
import { Repository } from 'typeorm';
import { CheckRun } from '../checks/check-run.entity';
import { ChecksService } from '../checks/checks.service';
import { Task } from './task.entity';

export interface CreateTaskInput {
  projectId: number;
  title: string;
  cron: string;
  checkId: number;
}

export interface UpdateTaskInput {
  title?: string;
  cron?: string;
  checkId?: number;
  enabled?: boolean;
}

/** 任务的运行统计：fail 含 error，total 为全部运行数 */
export interface TaskRunStats {
  success: number;
  fail: number;
  total: number;
}

/** 任务视图：实体字段 + 由 cron 表达式实时计算的下次执行时间（不落库）；
 * runStats 仅列表接口（findByProject）附带 */
export type TaskView = Task & {
  nextRunAt: string | null;
  runStats?: TaskRunStats;
};

/** 任务详情视图：额外带未来 5 次执行时间（任务详情页"计划"用；停用为 null） */
export type TaskDetailView = TaskView & { nextRuns: string[] | null };

@Injectable()
export class TasksService implements OnModuleInit {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @Inject(forwardRef(() => ChecksService))
    private readonly checksService: ChecksService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  /** 启动时将启用中的任务全部注册到调度器 */
  async onModuleInit(): Promise<void> {
    const tasks = await this.tasks.find({ where: { enabled: true } });
    for (const task of tasks) this.schedule(task);
    if (tasks.length > 0) {
      this.logger.log(`已注册 ${tasks.length} 个定时任务`);
    }
  }

  /** 按项目列出任务；不传 projectId 时返回全部（全局列表页用）。附带各任务的运行统计 */
  async findByProject(projectId?: number): Promise<TaskView[]> {
    const tasks = await this.tasks.find({
      where: projectId === undefined ? {} : { projectId },
      order: { updatedAt: 'DESC' },
    });
    const stats = await this.checksService.runStatsByTasks(
      tasks.map((t) => t.id),
    );
    const empty: TaskRunStats = { success: 0, fail: 0, total: 0 };
    return tasks.map((t) => ({
      ...this.withNextRun(t),
      runStats: stats.get(t.id) ?? empty,
    }));
  }

  async findOne(id: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    return task;
  }

  /** 单条任务视图（含实时计算的下次执行时间） */
  async findOneView(id: number): Promise<TaskDetailView> {
    const task = await this.findOne(id);
    const view = this.withNextRun(task);
    if (!task.enabled) return { ...view, nextRuns: null };
    try {
      const nextRuns = new CronJob(task.cron, () => undefined)
        .nextDates(5)
        .map((d) => d.toISO())
        .filter((s): s is string => s !== null);
      return { ...view, nextRuns };
    } catch {
      return { ...view, nextRuns: null };
    }
  }

  /** 任务触发的运行历史（倒序，上限 50；任务详情页用） */
  async listRuns(id: number): Promise<CheckRun[]> {
    await this.findOne(id);
    return this.checksService.listRunsByTask(id);
  }

  /** 某次运行的实时流透传（POST /api/tasks/:id/run.md 流式返回结果用） */
  streamRun(runId: number): Observable<MessageEvent> {
    return this.checksService.streamRun(runId);
  }

  /** 触发一次任务：运行绑定的检查脚本（结果落 check_runs 并标记 taskId），返回运行记录。
   * source 标记触发方式（schedule=到点调度 / manual=手动），用于飞书"开始执行"通知文案 */
  async runNow(
    id: number,
    source: 'schedule' | 'manual' = 'manual',
  ): Promise<CheckRun> {
    const task = await this.findOne(id);
    await this.tasks.update(id, { lastRunAt: new Date() });
    await this.tasks.increment({ id }, 'runCount', 1);
    try {
      return await this.checksService.startRun(task.checkId, task.id, source);
    } catch (e) {
      this.logger.error(`任务 ${id} 触发失败: ${(e as Error).message}`);
      throw e;
    }
  }

  async create(input: CreateTaskInput): Promise<TaskView> {
    const cron = this.normalizeCron(input.cron);
    await this.assertCheckInProject(input.projectId, input.checkId);
    const task = await this.tasks.save(
      this.tasks.create({
        projectId: input.projectId,
        title: input.title.trim(),
        cron,
        checkId: input.checkId,
      }),
    );
    this.schedule(task);
    return this.withNextRun(task);
  }

  async update(id: number, input: UpdateTaskInput): Promise<TaskView> {
    const task = await this.findOne(id);
    if (input.title !== undefined) task.title = input.title.trim();
    if (input.cron !== undefined) task.cron = this.normalizeCron(input.cron);
    if (input.checkId !== undefined) {
      await this.assertCheckInProject(task.projectId, input.checkId);
      task.checkId = input.checkId;
    }
    if (input.enabled !== undefined) task.enabled = input.enabled;
    const saved = await this.tasks.save(task);
    // 重排调度：停用/变更后旧任务不再触发
    this.unschedule(id);
    if (saved.enabled) this.schedule(saved);
    return this.withNextRun(saved);
  }

  async remove(id: number): Promise<void> {
    const task = await this.findOne(id);
    this.unschedule(id);
    await this.tasks.remove(task);
  }

  /** 删除项目时的应用层级联清理（无物理外键） */
  async removeByProject(projectId: number): Promise<void> {
    const tasks = await this.tasks.find({
      where: { projectId },
      select: { id: true },
    });
    for (const task of tasks) this.unschedule(task.id);
    await this.tasks.delete({ projectId });
  }

  /** 删除检查时的应用层级联清理（任务依赖检查脚本） */
  async removeByCheck(checkId: number): Promise<void> {
    const tasks = await this.tasks.find({
      where: { checkId },
      select: { id: true },
    });
    for (const task of tasks) this.unschedule(task.id);
    await this.tasks.delete({ checkId });
  }

  /** 调度入口：到点时任务仍存在且启用才触发（手动触发走 runNow，不受 enabled 限制） */
  private trigger(taskId: number): void {
    void this.tasks.findOne({ where: { id: taskId } }).then((task) => {
      if (!task?.enabled) return;
      this.runNow(taskId, 'schedule').catch(() => undefined);
    });
  }

  /** 附带下次执行时间：启用中的任务按 cron 表达式计算，停用为 null */
  private withNextRun(task: Task): TaskView {
    if (!task.enabled) return { ...task, nextRunAt: null };
    try {
      const next = new CronJob(task.cron, () => undefined).nextDate();
      return { ...task, nextRunAt: next.toISO() };
    } catch {
      return { ...task, nextRunAt: null };
    }
  }

  private schedule(task: Task): void {
    this.unschedule(task.id);
    const job = new CronJob(task.cron, () => {
      this.trigger(task.id);
    });
    this.schedulerRegistry.addCronJob(this.jobName(task.id), job);
    job.start();
  }

  private unschedule(id: number): void {
    const name = this.jobName(id);
    if (this.schedulerRegistry.doesExist('cron', name)) {
      this.schedulerRegistry.deleteCronJob(name);
    }
  }

  private jobName(id: number): string {
    return `task-${id}`;
  }

  /** 校验并规整 crontab 表达式（用 cron 包解析，非法抛 400） */
  private normalizeCron(cron: string): string {
    const normalized = cron.trim().replace(/\s+/g, ' ');
    try {
      new CronJob(normalized, () => undefined);
    } catch {
      throw new BadRequestException(`crontab 表达式不合法: ${cron}`);
    }
    return normalized;
  }

  /** 校验检查存在且属于该项目（任务只能绑定本项目的检查脚本） */
  private async assertCheckInProject(
    projectId: number,
    checkId: number,
  ): Promise<void> {
    const check = await this.checksService.findOne(checkId);
    if (check.projectId !== projectId) {
      throw new BadRequestException('检查脚本不属于该项目');
    }
  }
}
