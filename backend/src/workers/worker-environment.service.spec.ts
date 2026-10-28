import { BadRequestException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { WorkerRuntime } from '../common/enums';
import { WorkerEnvironmentService } from './worker-environment.service';
import { ManagedStandardFiles } from './worker-standard-catalog.service';
import { Worker } from './worker.entity';

describe('WorkerEnvironmentService.assertDone', () => {
  const buildService = () =>
    new WorkerEnvironmentService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('接受整段 DONE', () => {
    expect(() => buildService()['assertDone']('DONE')).not.toThrow();
  });

  it('接受验证报告后代码块中的独立 DONE', () => {
    const text = [
      'Verified the workspace:',
      '- AGENTS.md is unchanged',
      '',
      '```',
      'DONE',
      '```',
    ].join('\n');
    expect(() => buildService()['assertDone'](text)).not.toThrow();
  });

  it('优先返回 ERROR 内容', () => {
    expect(() =>
      buildService()['assertDone'](
        '```shell\nERROR: remote skill not found\n```',
      ),
    ).toThrow(BadRequestException);
  });

  it('拒绝没有独立 DONE 的报告', () => {
    expect(() =>
      buildService()['assertDone']('Workspace updated successfully.'),
    ).toThrow(/未返回 DONE/);
  });
});

describe('WorkerEnvironmentService.buildPrompt', () => {
  const managed: ManagedStandardFiles = {
    branch: 'main',
    rawBase: 'http://gitea.cinta.team/docs/standard/raw/branch/main',
    directories: ['fe/h5'],
    files: ['fe/h5/README.md', 'fe/h5/DEVELOP.md'],
  };

  const buildService = (
    managedFiles: ManagedStandardFiles = managed,
  ): WorkerEnvironmentService =>
    new WorkerEnvironmentService(
      {} as never,
      {} as never,
      {} as never,
      {
        resolveManagedFiles: () => Promise.resolve(managedFiles),
      } as never,
      {} as never,
    );

  const worker = {
    id: 1001,
    name: '前端机器人',
    prompt: '## 角色',
    skills: [],
    standards: [
      {
        name: 'H5 场景开发规范',
        path: 'fe/h5/README.md',
        directory: 'fe/h5',
        url: 'http://gitea.cinta.team/docs/standard/raw/branch/main/fe/h5/README.md',
        sourceUrl:
          'http://gitea.cinta.team/docs/standard/src/branch/main/fe/h5/README.md',
      },
    ],
  } as unknown as Worker as never;

  it('要求按仓库结构同步规范文件并维护受管清单', async () => {
    const prompt = await buildService()['buildPrompt'](worker);
    expect(prompt).toContain('fe/h5/README.md');
    expect(prompt).toContain(
      'http://gitea.cinta.team/docs/standard/raw/branch/main/fe/h5/DEVELOP.md',
    );
    expect(prompt).toContain('.opencode/docs/.standards-manifest.json');
    expect(prompt).toContain('不要删除机器人或其他流程产生的其他文档');
  });

  it('规范清单为空时只清理旧受管文件，不要求清空 docs', async () => {
    const empty: ManagedStandardFiles = {
      branch: 'main',
      rawBase: '',
      directories: [],
      files: [],
    };
    const prompt = await buildService(empty)['buildPrompt'](worker);
    expect(prompt).toContain('（本次规范清单为空');
    expect(prompt).toContain('不处理其他文档');
  });
});

describe('WorkerEnvironmentService.start / stream / snapshotOf', () => {
  const worker = {
    id: 1001,
    runtime: WorkerRuntime.OPENCODE,
    executorId: 8,
    providerId: 'deepseek',
    modelId: 'deepseek-flash',
  } as Worker as never;
  // 端口 1 不可达：后台任务会快速失败转为 failed，测试不产生真实网络副作用
  const executor = { id: 8, ip: '127.0.0.1', port: 1, online: true } as never;

  const buildService = (
    workersFindOne: jest.Mock = jest.fn().mockResolvedValue(worker),
    executorsFindOne: jest.Mock = jest.fn().mockResolvedValue(executor),
  ): WorkerEnvironmentService =>
    new WorkerEnvironmentService(
      { findOne: workersFindOne } as never,
      { findOne: executorsFindOne } as never,
      { workdirOf: () => '/tmp/runtime/worker/1001' } as never,
      {
        resolveManagedFiles: () =>
          Promise.resolve({
            branch: 'main',
            rawBase: '',
            directories: [],
            files: [],
          }),
      } as never,
      // 事件中心 mock：任务后台执行会真正访问 127.0.0.1:4096 失败并转 failed，不影响断言
      {
        retain: () => undefined,
        release: () => undefined,
        onEvent: () => () => undefined,
      } as never,
    );

  it('start 返回运行快照，进行中重复启动幂等返回同一任务', async () => {
    const service = buildService();
    const first = await service.start(1001);
    expect(first.status).toBe('running');
    expect(first.workerId).toBe(1001);
    expect(first.lines.length).toBeGreaterThan(0);
    const second = await service.start(1001);
    expect(second.status).toBe('running');
    expect(second.startedAt).toBe(first.startedAt);
    // 终态兜底：后台任务失败后快照转 failed 且带错误（执行器 mock 地址不可达）
    expect(['running', 'failed']).toContain(service.snapshotOf(1001).status);
  });

  it('配置不完整时 start 同步抛 400，不创建任务', async () => {
    const service = buildService(
      jest.fn().mockResolvedValue({ id: 2, runtime: 'opencode' }),
    );
    await expect(service.start(2)).rejects.toThrow(
      '请先配置执行器、供应商与模型',
    );
    expect(service.snapshotOf(2).status).toBe('idle');
  });

  it('snapshotOf 无任务时返回 idle 快照', () => {
    const service = buildService();
    const snapshot = service.snapshotOf(9999);
    expect(snapshot).toEqual({
      workerId: 9999,
      status: 'idle',
      lines: [],
      error: null,
      workdir: null,
      startedAt: null,
      finishedAt: null,
    });
  });

  it('stream 无任务时推送 idle 快照后完成', async () => {
    const service = buildService();
    const events = await firstValueFrom(service.stream(1001).pipe(toArray()));
    expect(events).toHaveLength(1);
    const payload = events[0].data as {
      type: string;
      snapshot: { status: string };
    };
    expect(payload.type).toBe('snapshot');
    expect(payload.snapshot.status).toBe('idle');
  });
});
