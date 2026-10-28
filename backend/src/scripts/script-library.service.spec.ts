import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { Repository } from 'typeorm';
import { ChecksService } from '../checks/checks.service';
import { ExportsService } from '../exports/exports.service';
import { TestsService } from '../tests/tests.service';
import { ScriptLibraryRun } from './script-library-run.entity';
import { ScriptLibraryService } from './script-library.service';
import { ScriptLibrarySyncService } from './script-library-sync.service';

describe('ScriptLibraryService', () => {
  let root: string;
  let service: ScriptLibraryService;

  /** 描述表内存桩（列表/详情只读） */
  const makeDescriptionsStub = (
    rows: Array<{ scriptPath: string; description: string | null }> = [],
  ) => ({
    find: () => Promise.resolve(rows),
  });

  const makeService = (
    scriptsRoot: string,
    descriptions: Array<{
      scriptPath: string;
      description: string | null;
    }> = [],
  ) =>
    new ScriptLibraryService(
      {
        query: () => Promise.resolve([]),
        find: () => Promise.resolve([]),
      } as unknown as Repository<ScriptLibraryRun>,
      makeDescriptionsStub(descriptions) as unknown as never,
      {} as unknown as never,
      { findByProject: () => Promise.resolve([]) } as unknown as ChecksService,
      { findByProject: () => Promise.resolve([]) } as unknown as TestsService,
      { findByProject: () => Promise.resolve([]) } as unknown as ExportsService,
      {
        currentHead: () => Promise.resolve('abc123'),
        getStatus: () => ({ repo: 'LitaGroup/scripts' }),
      } as unknown as ScriptLibrarySyncService,
      new ConfigService({ CHECK_SCRIPTS_DIR: scriptsRoot }),
    );

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'project-scripts-'));
    // projects/ 下三类脚本 + projects 外的干扰文件 + 非脚本文件
    await fs.mkdir(path.join(root, 'projects/active/pk/checks'), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, 'projects/active/pk/tests'), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, 'projects/basic/exports'), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, 'others'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'projects/active/pk/checks/final.check.ts'),
      'export const a = 1',
    );
    await fs.writeFile(
      path.join(root, 'projects/active/pk/tests/rank.test.ts'),
      'export const b = 2',
    );
    await fs.writeFile(
      path.join(root, 'projects/basic/exports/all.export.ts'),
      'export const c = 3',
    );
    await fs.writeFile(
      path.join(root, 'projects/active/pk/README.md'),
      'readme',
    );
    await fs.writeFile(
      path.join(root, 'others/ignored.check.ts'),
      'export const d = 4',
    );
    service = makeService(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('扫描 projects/ 下三类脚本并按路径排序', async () => {
    const res = await service.listScripts();
    expect(res.total).toBe(3);
    expect(res.items.map((s) => s.path)).toEqual([
      'projects/active/pk/checks/final.check.ts',
      'projects/active/pk/tests/rank.test.ts',
      'projects/basic/exports/all.export.ts',
    ]);
    expect(res.items.map((s) => s.kind)).toEqual(['check', 'test', 'export']);
  });

  it('类型筛选与路径模糊搜索', async () => {
    const byKind = await service.listScripts(undefined, 'test');
    expect(byKind.items.map((s) => s.path)).toEqual([
      'projects/active/pk/tests/rank.test.ts',
    ]);

    const byKeyword = await service.listScripts('basic/exports');
    expect(byKeyword.items.map((s) => s.path)).toEqual([
      'projects/basic/exports/all.export.ts',
    ]);
  });

  it('搜索按相关度排序：路径精确 > 文件名 > 路径包含 > 描述', async () => {
    const ranked = makeService(root, [
      {
        scriptPath: 'projects/basic/exports/all.export.ts',
        description: '排行榜导出脚本',
      },
    ]);

    const exactPath = await ranked.listScripts(
      'projects/active/pk/tests/rank.test.ts',
    );
    expect(exactPath.items[0].relevance).toBe(1);

    const exactName = await ranked.listScripts('rank.test.ts');
    expect(exactName.items[0].relevance).toBe(0.96);

    const directory = await ranked.listScripts('basic/exports');
    expect(directory.items[0].relevance).toBe(0.76);

    const byDescription = await ranked.listScripts('排行榜');
    expect(byDescription.items.map((s) => s.path)).toEqual([
      'projects/basic/exports/all.export.ts',
    ]);
    expect(byDescription.items[0].relevance).toBe(0.55);

    const noKeyword = await ranked.listScripts();
    expect(noKeyword.items.every((s) => s.relevance === null)).toBe(true);
  });

  it('路径命中优先于仅描述命中，同分按路径稳定排序', async () => {
    const ranked = makeService(root, [
      {
        scriptPath: 'projects/basic/exports/all.export.ts',
        description: 'rank 排行榜',
      },
      {
        scriptPath: 'projects/active/pk/tests/rank.test.ts',
        description: '每日结算',
      },
    ]);

    const result = await ranked.listScripts('rank');
    expect(result.items.map((s) => s.path)).toEqual([
      'projects/active/pk/tests/rank.test.ts',
      'projects/basic/exports/all.export.ts',
    ]);
    expect(result.items[0].relevance).toBeGreaterThan(
      result.items[1].relevance ?? 0,
    );
  });

  it('按脚本描述模糊搜索（不区分大小写）', async () => {
    const described = makeService(root, [
      {
        scriptPath: 'projects/active/pk/tests/rank.test.ts',
        description: 'DailyRank 排行榜每日结算检查',
      },
    ]);

    const byDescription = await described.listScripts('dailyrank');
    expect(byDescription.total).toBe(1);
    expect(byDescription.items.map((s) => s.path)).toEqual([
      'projects/active/pk/tests/rank.test.ts',
    ]);
    expect(byDescription.items[0].description).toBe(
      'DailyRank 排行榜每日结算检查',
    );

    const byChineseDescription = await described.listScripts('每日结算');
    expect(byChineseDescription.items.map((s) => s.path)).toEqual([
      'projects/active/pk/tests/rank.test.ts',
    ]);

    const noMatch = await described.listScripts('不存在的描述');
    expect(noMatch.total).toBe(0);
  });

  it('非法 type 返回 400', async () => {
    await expect(service.listScripts(undefined, 'nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('脚本详情返回源码与 GitHub 链接', async () => {
    const detail = await service.findScript(
      'projects/active/pk/tests/rank.test.ts',
    );
    expect(detail.content).toBe('export const b = 2');
    expect(detail.revision).toBe('abc123');
    expect(detail.githubUrl).toBe(
      'https://github.com/LitaGroup/scripts/blob/main/projects/active/pk/tests/rank.test.ts',
    );
  });

  it('详情：路径不存在返回 404', async () => {
    await expect(
      service.findScript('projects/active/pk/tests/none.test.ts'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('运行：仅允许 projects/ 下三类脚本', async () => {
    await expect(
      service.startRun({ path: 'others/ignored.check.ts' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.startRun({ path: '../package.json' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.startRun({ path: '/etc/passwd' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.startRun({ path: 'projects/active/pk/README.md' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.startRun({ path: 'projects/active/pk/tests/none.test.ts' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
