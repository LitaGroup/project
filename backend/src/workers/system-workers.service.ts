import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { WorkerRole, WorkerRuntime } from '../common/enums';
import { Task } from '../tasks/task.entity';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Worker } from './worker.entity';
import {
  SYSTEM_WORKERS,
  SYSTEM_WORKER_ID_LIMIT,
  SystemWorkerDefinition,
  isSystemWorkerId,
} from './system-workers';

/**
 * 保证自定义机器人 ID 从 SYSTEM_WORKER_ID_LIMIT（1000）开始。
 * 仅在建表/种子后调用，幂等；失败时抛错由调用方决定是否阻断。
 */
export async function ensureWorkerSequenceFloor(
  workers: Repository<Worker>,
): Promise<void> {
  // PostgreSQL 序列独立于显式写入的 id；至少推到 999，使下一次 nextval 从 1000 开始。
  await workers.query(
    `SELECT setval(
       pg_get_serial_sequence('workers', 'id'),
       GREATEST((SELECT COALESCE(MAX(id), 0) FROM workers), $1)
     )`,
    [SYSTEM_WORKER_ID_LIMIT - 1],
  );
}

/**
 * 系统机器人启动初始化（代码内置，网页不可创建/删除）：
 * 1. 历史 runtime=pi 的机器人迁移为 opencode（原 PI 调度器已移除）；
 * 2. 历史自定义机器人（role=工作者）若落在系统 ID 段，迁到 id >= 1000，并同步任务/任务定义引用；
 * 3. 历史调度器并入系统 ID 段（id < 1000），并同步任务的 schedulerId；
 * 4. 缺失时内置系统调度机器人；
 * 5. 把 workers 表的序列起点抬到 1000，保证网页新建的机器人是自定义机器人。
 */
@Injectable()
export class SystemWorkersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemWorkersService.name);

  constructor(
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.migrateLegacyRuntime();
      await this.normalizeCustomWorkerIds();
      await this.normalizeSchedulerIds();
      await this.ensureSystemWorkers();
      await ensureWorkerSequenceFloor(this.workers);
    } catch (e) {
      this.logger.error(`系统机器人初始化失败: ${(e as Error).message}`);
    }
  }

  /** 平台进程内 PI Agent 已移除：历史 runtime=pi 统一迁移到 opencode */
  private async migrateLegacyRuntime(): Promise<void> {
    const result = await this.workers
      .createQueryBuilder()
      .update(Worker)
      .set({ runtime: WorkerRuntime.OPENCODE })
      .where('runtime = :pi', { pi: WorkerRuntime.PI })
      .execute();
    if (result.affected) {
      this.logger.log(
        `已把 ${result.affected} 个历史 PI 运行时机器人迁移为 opencode`,
      );
    }
  }

  /** 把历史自定义机器人（role=工作者 且 id<1000）迁到 1000+，并同步任务/任务定义引用 */
  private async normalizeCustomWorkerIds(): Promise<void> {
    const workers = await this.workers.find({
      where: { role: WorkerRole.WORKER },
      order: { id: 'ASC' },
    });
    // 已有稳定 systemKey 的系统工作者不参与自定义机器人迁移
    const reserved = new Set(
      workers
        .filter((worker) => Boolean(worker.systemKey))
        .map((worker) => worker.id),
    );
    const overflow = workers.filter(
      (w) => isSystemWorkerId(w.id) && !reserved.has(w.id),
    );
    if (overflow.length === 0) return;

    const all = await this.workers.find({ select: { id: true } });
    const used = new Set(all.map((w) => w.id));

    for (const worker of overflow) {
      const nextId = this.lowestFreeCustomId(used);
      if (!nextId) {
        this.logger.warn(`无法为自定义机器人 #${worker.id} 分配 ID`);
        break;
      }
      await this.workers.manager.transaction(async (manager) => {
        await manager.update(Task, { agentId: worker.id }, { agentId: nextId });
        const templates = await manager.find(TaskTemplate);
        for (const template of templates) {
          if (!(template.agentIds ?? []).includes(worker.id)) continue;
          template.agentIds = template.agentIds.map((agentId) =>
            agentId === worker.id ? nextId : agentId,
          );
          await manager.save(template);
        }
        await manager.query('UPDATE workers SET id = $1 WHERE id = $2', [
          nextId,
          worker.id,
        ]);
      });
      used.delete(worker.id);
      used.add(nextId);
      this.logger.log(
        `自定义机器人「${worker.name}」#${worker.id} → #${nextId}（系统 ID 段 <${SYSTEM_WORKER_ID_LIMIT} 保留）`,
      );
    }
  }

  /** 把历史调度器（role=调度器 且 id>=1000）迁入系统 ID 段，并同步任务引用 */
  private async normalizeSchedulerIds(): Promise<void> {
    const schedulers = await this.workers.find({
      where: { role: WorkerRole.SCHEDULER },
      order: { id: 'ASC' },
    });
    const overflow = schedulers.filter((w) => !isSystemWorkerId(w.id));
    if (overflow.length === 0) return;

    const all = await this.workers.find({ select: { id: true } });
    const used = new Set(all.map((w) => w.id));

    for (const scheduler of overflow) {
      const nextId = this.lowestFreeSystemId(used);
      if (!nextId) {
        this.logger.warn(
          `系统机器人 ID 段已满，调度器 #${scheduler.id}（${scheduler.name}）未能迁入`,
        );
        break;
      }
      await this.workers.manager.transaction(async (manager) => {
        await manager.update(
          Task,
          { schedulerId: scheduler.id },
          { schedulerId: nextId },
        );
        // 历史调度方案表保留，引用一并改写（表不存在时忽略）
        await manager
          .query(
            'UPDATE dispatch_plans SET "schedulerId" = $1 WHERE "schedulerId" = $2',
            [nextId, scheduler.id],
          )
          .catch(() => undefined);
        await manager.query('UPDATE workers SET id = $1 WHERE id = $2', [
          nextId,
          scheduler.id,
        ]);
      });
      used.delete(scheduler.id);
      used.add(nextId);
      this.logger.log(
        `调度器「${scheduler.name}」#${scheduler.id} → 系统机器人 #${nextId}`,
      );
    }
  }

  /** 代码内置系统机器人：按稳定 systemKey 识别，不覆盖用户配置 */
  private async ensureSystemWorkers(): Promise<void> {
    for (const def of SYSTEM_WORKERS) {
      const byKey = await this.workers.findOne({
        where: { systemKey: def.key },
      });
      if (byKey) {
        await this.correctSystemWorker(byKey, def);
        continue;
      }
      const byId = await this.workers.findOne({ where: { id: def.id } });
      if (byId && byId.role === def.role) {
        await this.correctSystemWorker(byId, def);
        continue;
      }
      // 同角色已有系统调度机器人（历史数据可能落在 ID 段其它位置）时不再重复创建
      const sameRole =
        def.role === WorkerRole.SCHEDULER
          ? await this.workers.findOne({
              where: {
                role: def.role,
                id: LessThan(SYSTEM_WORKER_ID_LIMIT),
              },
              order: { id: 'ASC' },
            })
          : null;
      if (sameRole) {
        await this.correctSystemWorker(sameRole, def);
        continue;
      }

      const all = await this.workers.find({ select: { id: true, name: true } });
      const usedIds = new Set(all.map((w) => w.id));
      const usedNames = new Set(all.map((w) => w.name));
      const id = usedIds.has(def.id)
        ? this.lowestFreeSystemId(usedIds)
        : def.id;
      if (!id) {
        this.logger.warn(`系统机器人 ID 段已满，无法创建「${def.name}」`);
        continue;
      }
      const name = this.uniqueName(def.name, usedNames);
      const insertedId = await this.workers.manager.transaction(
        async (manager) => {
          const result = await manager.insert(Worker, {
            systemKey: def.key,
            name,
            intro: def.intro,
            kind: def.kind,
            role: def.role,
            runtime: def.runtime,
            executorId: null,
            providerId: null,
            modelId: null,
            prompt: def.prompt,
            skills: null,
            taskDefs: null,
            ownerUserId: null,
            ownerName: null,
            materials: null,
            enabled: false,
          });
          const generatedId = result.identifiers[0]?.id as number | undefined;
          if (generatedId && generatedId !== id) {
            // 自增主键列会忽略显式 id：插入后立即迁入系统 ID 段，保持稳定寻址
            await manager.query('UPDATE workers SET id = $1 WHERE id = $2', [
              id,
              generatedId,
            ]);
          }
          return id;
        },
      );
      this.logger.log(
        `已内置系统机器人「${name}」#${insertedId}（默认停用，请在机器人页配置执行器/模型后启用）`,
      );
    }
  }

  private async correctSystemWorker(
    worker: Worker,
    def: SystemWorkerDefinition,
  ): Promise<void> {
    const patch: Partial<Worker> = {};
    if (worker.systemKey !== def.key) patch.systemKey = def.key;
    if (worker.role !== def.role) patch.role = def.role;
    if (worker.runtime !== def.runtime) patch.runtime = def.runtime;
    // 系统机器人未自定义 PROMPT 时，把内置默认值落库，便于在页面上查看/编辑
    if (!worker.prompt?.trim()) patch.prompt = def.prompt;
    if (Object.keys(patch).length === 0) return;
    await this.workers.update({ id: worker.id }, patch);
  }

  private lowestFreeSystemId(used: Set<number>): number | null {
    for (let id = 1; id < SYSTEM_WORKER_ID_LIMIT; id++) {
      if (!used.has(id)) return id;
    }
    return null;
  }

  private lowestFreeCustomId(used: Set<number>): number {
    let id = SYSTEM_WORKER_ID_LIMIT;
    while (used.has(id)) id++;
    return id;
  }

  private uniqueName(base: string, used: Set<string>): string {
    if (!used.has(base)) return base;
    let index = 2;
    while (used.has(`${base}-${index}`)) index++;
    return `${base}-${index}`;
  }
}
