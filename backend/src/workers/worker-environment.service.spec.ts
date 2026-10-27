import { BadRequestException } from '@nestjs/common';
import { WorkerEnvironmentService } from './worker-environment.service';

describe('WorkerEnvironmentService.assertDone', () => {
  const buildService = () =>
    new WorkerEnvironmentService({} as never, {} as never, {} as never);

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
