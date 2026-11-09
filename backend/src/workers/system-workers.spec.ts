import { WorkerRole, WorkerRuntime } from '../common/enums';
import {
  DEFAULT_PROJECT_MANAGER_PROMPT,
  prependSystemWorkerAgent,
  SYSTEM_PROJECT_MANAGER_WORKER_ID,
  SYSTEM_PROJECT_MANAGER_WORKER_KEY,
  SYSTEM_WORKERS,
} from './system-workers';
import { SystemWorkersService } from './system-workers.service';

describe('系统机器人定义', () => {
  it('内置技术-项目经理并声明任务拆分与验收职责', () => {
    const manager = SYSTEM_WORKERS.find(
      (worker) => worker.key === SYSTEM_PROJECT_MANAGER_WORKER_KEY,
    );

    expect(manager).toMatchObject({
      id: SYSTEM_PROJECT_MANAGER_WORKER_ID,
      name: '技术-项目经理',
      role: WorkerRole.WORKER,
      runtime: WorkerRuntime.OPENCODE,
      prompt: DEFAULT_PROJECT_MANAGER_PROMPT,
    });
    expect(manager?.prompt).toContain('项目ID：{projectId} 的实施交付');
    expect(manager?.prompt).toContain('tasks/defines.md');
    expect(manager?.prompt).toContain('subtasks/create.md');
    expect(manager?.prompt).toContain('task-handoff-apply');
    expect(manager?.prompt).toContain('子任务');
  });

  it('系统机器人固定 ID 唯一且位于系统 ID 段', () => {
    const ids = SYSTEM_WORKERS.map((worker) => worker.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SYSTEM_WORKERS.every((worker) => worker.id < 1000)).toBe(true);
  });

  it('绑定项目经理时置顶且保持其它处理机器人', () => {
    expect(prependSystemWorkerAgent([1001, 1002], 2)).toEqual([2, 1001, 1002]);
    expect(prependSystemWorkerAgent([1001, 2, 1002], 2)).toEqual([
      2, 1001, 1002,
    ]);
    expect(prependSystemWorkerAgent(null, 2)).toEqual([2]);
  });

  it('启动绑定时把项目经理置顶写入项目交付任务定义', async () => {
    const template = {
      id: 7,
      name: '技术-项目开发交付',
      agentIds: [1001],
    };
    const workers = {
      findOne: jest.fn().mockResolvedValue({
        id: SYSTEM_PROJECT_MANAGER_WORKER_ID,
        name: '技术-项目经理',
      }),
      manager: {
        findOne: jest.fn().mockResolvedValue(template),
        save: jest.fn().mockResolvedValue(template),
      },
    };
    const service = new SystemWorkersService(workers as never, {} as never);

    await (
      service as unknown as { bindProjectManager(): Promise<void> }
    ).bindProjectManager();

    expect(template.agentIds).toEqual([SYSTEM_PROJECT_MANAGER_WORKER_ID, 1001]);
    expect(workers.manager.save).toHaveBeenCalledWith(template);
  });

  it('项目经理使用备用 ID 时移除模板里失效的首选 ID', async () => {
    const template = {
      id: 7,
      name: '技术-项目开发交付',
      agentIds: [SYSTEM_PROJECT_MANAGER_WORKER_ID, 1001],
    };
    const workers = {
      findOne: jest.fn().mockResolvedValue({ id: 4, name: '技术-项目经理' }),
      manager: {
        findOne: jest.fn().mockResolvedValue(template),
        save: jest.fn().mockResolvedValue(template),
      },
    };
    const service = new SystemWorkersService(workers as never, {} as never);

    await (
      service as unknown as { bindProjectManager(): Promise<void> }
    ).bindProjectManager();

    expect(template.agentIds).toEqual([4, 1001]);
  });
});
