import { BadRequestException } from '@nestjs/common';
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
  } as Worker as never;

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
