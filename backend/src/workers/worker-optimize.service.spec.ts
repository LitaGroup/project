import { NotFoundException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { WorkerOptimizeService } from './worker-optimize.service';
import type { WorkerOptimizeSnapshot } from './worker-optimize.service';
import type { WorkerAiService } from './worker-ai.service';
import type { OpencodeEventHub } from '../executors/opencode-event-hub.service';

function buildService(runOptimize: jest.Mock) {
  const workerAi = {
    resolveEndpoint: jest.fn().mockResolvedValue({
      executor: { id: 1, name: '执行器' },
      providerId: 'provider',
      modelId: 'model',
    }),
    runOptimize,
  };
  const eventHub = {
    retain: jest.fn(),
    release: jest.fn(),
    onEvent: jest.fn().mockReturnValue(() => undefined),
  };
  const service = new WorkerOptimizeService(
    workerAi as unknown as WorkerAiService,
    eventHub as unknown as OpencodeEventHub,
  );
  return { service, workerAi, eventHub };
}

async function waitTerminal(
  service: WorkerOptimizeService,
  runId: string,
): Promise<WorkerOptimizeSnapshot> {
  for (let i = 0; i < 20; i++) {
    const snapshot = service.snapshotOf(runId);
    if (snapshot.status !== 'running') return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('优化任务未在预期时间内结束');
}

describe('WorkerOptimizeService', () => {
  it('启动后立即返回运行快照，并在后台完成后可从快照读取结果', async () => {
    const runOptimize = jest.fn().mockResolvedValue('## 角色定义\n优化结果');
    const { service, workerAi, eventHub } = buildService(runOptimize);

    const started = await service.start({
      prompt: '## 角色定义\n原始内容',
      executorId: 1,
      providerId: 'provider',
      modelId: 'model',
    });
    expect(started.status).toBe('running');
    expect(started.runId).toBeTruthy();
    expect(started.prompt).toBeNull();
    // POST 不等待模型执行完毕
    expect(runOptimize).toHaveBeenCalled();

    const done = await waitTerminal(service, started.runId);
    expect(done.status).toBe('success');
    expect(done.prompt).toBe('## 角色定义\n优化结果');
    expect(done.lines.some((line) => line.includes('优化完成'))).toBe(true);
    expect(eventHub.retain).toHaveBeenCalled();
    expect(eventHub.release).toHaveBeenCalledWith(1);
    expect(workerAi.resolveEndpoint).toHaveBeenCalled();
  });

  it('执行失败时返回 failed 快照与错误信息', async () => {
    const { service } = buildService(
      jest.fn().mockRejectedValue(new Error('执行器会话超时')),
    );
    const started = await service.start({ prompt: '内容' });
    const done = await waitTerminal(service, started.runId);
    expect(done.status).toBe('failed');
    expect(done.error).toBe('执行器会话超时');
    expect(done.prompt).toBeNull();
  });

  it('SSE 订阅先收快照，终态后自动完成流', async () => {
    const { service } = buildService(jest.fn().mockResolvedValue('优化结果'));
    const started = await service.start({ prompt: '内容' });
    const done = await waitTerminal(service, started.runId);
    expect(done.status).toBe('success');

    const events = await firstValueFrom(
      service.stream(started.runId).pipe(toArray()),
    );
    const data = events[0].data as {
      type?: string;
      snapshot?: WorkerOptimizeSnapshot;
    };
    expect(data.type).toBe('snapshot');
    expect(data.snapshot).toMatchObject({
      runId: started.runId,
      status: 'success',
      prompt: '优化结果',
    });
  });

  it('runId 不存在时快照 404，SSE 返回失败快照后结束', async () => {
    const { service } = buildService(jest.fn());
    expect(() => service.snapshotOf('missing')).toThrow(NotFoundException);

    const events = await firstValueFrom(
      service.stream('missing').pipe(toArray()),
    );
    expect(events).toHaveLength(1);
    const data = events[0].data as {
      type?: string;
      snapshot?: WorkerOptimizeSnapshot;
    };
    expect(data.type).toBe('snapshot');
    expect(data.snapshot).toMatchObject({
      runId: 'missing',
      status: 'failed',
    });
  });

  it('PROMPT 为空时启动即 400', async () => {
    const { service, workerAi } = buildService(jest.fn());
    await expect(service.start({ prompt: '   ' })).rejects.toThrow(
      'PROMPT 内容不能为空',
    );
    expect(workerAi.resolveEndpoint).not.toHaveBeenCalled();
  });
});
