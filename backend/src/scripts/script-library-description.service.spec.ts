import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { Repository } from 'typeorm';
import { Executor } from '../executors/executor.entity';
import { runOpencodePrompt } from '../executors/opencode-run';
import { ScriptLibraryDescription } from './script-library-description.entity';
import { ScriptLibraryDescriptionService } from './script-library-description.service';
import { Worker } from '../workers/worker.entity';
import { WorkersService } from '../workers/workers.service';

jest.mock('../executors/opencode-run', () => ({
  runOpencodePrompt: jest.fn(),
}));
const runPromptMock = runOpencodePrompt as jest.MockedFunction<
  typeof runOpencodePrompt
>;

describe('ScriptLibraryDescriptionService', () => {
  let root: string;
  let rows: ScriptLibraryDescription[];
  let nextId: number;
  let service: ScriptLibraryDescriptionService;

  /** 描述表内存桩 */
  const makeDocsStub = () => {
    rows = [];
    nextId = 1;
    return {
      find: () => Promise.resolve(rows.map((r) => ({ ...r }))),
      findOne: ({ where }: { where: { id?: number; status?: string } }) =>
        Promise.resolve(
          rows.find(
            (r) =>
              (where.id === undefined || r.id === where.id) &&
              (where.status === undefined || r.status === where.status),
          ) ?? null,
        ),
      insert: (entity: Partial<ScriptLibraryDescription>) => {
        rows.push({
          id: nextId++,
          scriptPath: entity.scriptPath!,
          description: entity.description ?? null,
          contentHash: entity.contentHash ?? null,
          status: entity.status ?? 'pending',
          error: null,
          attempts: 0,
          generatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return Promise.resolve(undefined);
      },
      update: (id: number, patch: Partial<ScriptLibraryDescription>) => {
        const row = rows.find((r) => r.id === id);
        if (row) Object.assign(row, patch, { updatedAt: new Date() });
        return Promise.resolve(undefined);
      },
      delete: (id: number) => {
        rows = rows.filter((r) => r.id !== id);
        return Promise.resolve(undefined);
      },
    } as unknown as Repository<ScriptLibraryDescription>;
  };

  const makeService = (options?: {
    /** 默认机器人未就绪（enabled=false），就绪场景显式传 true */
    ready?: boolean;
    executor?: Partial<Executor> | null;
  }) => {
    const ready = options?.ready ?? false;
    return new ScriptLibraryDescriptionService(
      makeDocsStub(),
      {
        scanScripts: () =>
          Promise.resolve([
            {
              path: 'projects/a/tests/x.test.ts',
              kind: 'test',
              size: 1,
              updatedAt: '',
            },
          ]),
        normalizeScriptPath: (p?: string) => p ?? '',
        getScriptsDir: () => root,
      } as never,
      {
        findOne: () =>
          Promise.resolve({
            id: 3,
            name: '脚本描述机器人',
            enabled: ready,
            executorId: 1,
            providerId: 'custom',
            modelId: 'gpt-x',
          } as Worker),
      } as never,
      {
        findOne: () =>
          Promise.resolve(
            options?.executor === null
              ? null
              : ({
                  id: 1,
                  name: '本机执行器',
                  online: true,
                  providersCache: [{ id: 'custom', models: [{ id: 'gpt-x' }] }],
                  ...(options?.executor ?? {}),
                } as Executor),
          ),
      } as never,
      { workdirOf: () => '/tmp/worker-3' } as unknown as WorkersService,
    );
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    root = await fs.mkdtemp(path.join(tmpdir(), 'project-script-desc-'));
    await fs.mkdir(path.join(root, 'projects/a/tests'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'projects/a/tests/x.test.ts'),
      'export const a = 1',
    );
    service = makeService();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('首轮把全部脚本加入待生成队列；机器人未就绪时保持待生成', async () => {
    await service.refreshAndProcess('测试');
    expect(rows).toHaveLength(1);
    expect(rows[0].scriptPath).toBe('projects/a/tests/x.test.ts');
    expect(rows[0].status).toBe('pending');
    expect(runPromptMock).not.toHaveBeenCalled();
  });

  it('清理已删除脚本的描述、恢复卡死的 running、文件变更重新排队', async () => {
    rows = [
      {
        id: 1,
        scriptPath: 'projects/gone/x.check.ts',
        description: '旧描述',
        contentHash: 'h',
        status: 'done',
        error: null,
        attempts: 0,
        generatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        scriptPath: 'projects/a/tests/x.test.ts',
        description: null,
        contentHash: null,
        status: 'running',
        error: null,
        attempts: 0,
        generatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as ScriptLibraryDescription[];
    await service.refreshAndProcess('测试');
    // 已删除脚本清理，running 恢复 pending
    expect(rows.map((r) => [r.scriptPath, r.status])).toEqual([
      ['projects/a/tests/x.test.ts', 'pending'],
    ]);

    // 文件变更：done → pending，失败计数清零，旧描述保留
    rows = [
      {
        id: 1,
        scriptPath: 'projects/a/tests/x.test.ts',
        description: '旧描述',
        contentHash: 'stale-hash',
        status: 'done',
        error: '旧错误',
        attempts: 3,
        generatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as ScriptLibraryDescription[];
    await service.refreshAndProcess('测试');
    expect(rows[0].status).toBe('pending');
    expect(rows[0].attempts).toBe(0);
    expect(rows[0].error).toBeNull();
    expect(rows[0].description).toBe('旧描述');
  });

  it('生成成功：写入清洗后的描述与内容哈希', async () => {
    service = makeService({ ready: true });
    runPromptMock.mockResolvedValueOnce(
      '```\n"分析每日排名数据与奖励发放"\n```',
    );
    await service.refreshAndProcess('测试');
    expect(runPromptMock).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe('done');
    expect(rows[0].description).toBe('分析每日排名数据与奖励发放');
    expect(rows[0].contentHash).toBe(
      execSync(
        `shasum -a 1 '${path.join(root, 'projects/a/tests/x.test.ts')}' | cut -d' ' -f1`,
      )
        .toString()
        .trim(),
    );
    expect(rows[0].generatedAt).not.toBeNull();
  });

  it('生成失败：转 error 并在下一轮重试，超限后不再重试', async () => {
    service = makeService({ ready: true });
    runPromptMock.mockRejectedValue(new Error('执行器会话执行失败'));
    await service.refreshAndProcess('测试');
    expect(rows[0].status).toBe('error');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].error).toContain('执行器会话执行失败');

    await service.refreshAndProcess('测试');
    expect(rows[0].attempts).toBe(2);
    await service.refreshAndProcess('测试');
    expect(rows[0].attempts).toBe(3);
    // 已达上限：不再重试
    await service.refreshAndProcess('测试');
    expect(rows[0].attempts).toBe(3);
    expect(runPromptMock).toHaveBeenCalledTimes(3);
  });

  it('机器人未启用时不调用执行器', async () => {
    await service.refreshAndProcess('测试');
    expect(rows[0].status).toBe('pending');
    expect(runPromptMock).not.toHaveBeenCalled();
  });
});
