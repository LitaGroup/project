import { Subject } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import type { RunDetailLike } from '../../common/run-markdown';
import { collectRunMarkdown } from './work-tools.util';

function runOf(partial: Partial<RunDetailLike>): RunDetailLike {
  return {
    status: 'running',
    total: null,
    current: 0,
    success: null,
    fail: null,
    skip: null,
    message: null,
    durationMs: null,
    output: [],
    startedAt: new Date('2026-11-09T00:00:00Z'),
    finishedAt: null,
    ...partial,
  };
}

describe('collectRunMarkdown', () => {
  it('终态快照在订阅时同步推送也能正常结束', async () => {
    const stream = new Subject<MessageEvent>();
    const terminal = runOf({
      status: 'success',
      success: 2,
      fail: 0,
      skip: 0,
      output: ['line 1', 'line 2'],
    });
    const originalSubscribe = stream.subscribe.bind(stream);
    jest.spyOn(stream, 'subscribe').mockImplementation((observer) => {
      const subscription = originalSubscribe(observer);
      (observer as { next: (value: MessageEvent) => void }).next({
        data: terminal,
      });
      return subscription;
    });
    const notify =
      jest.fn<(progress: number, message: string) => Promise<void>>();
    notify.mockResolvedValue(undefined);
    const markdown = await collectRunMarkdown({
      title: '运行检查 `demo`',
      metaLines: ['- 运行 ID：1'],
      stream,
      initial: runOf({}),
      notify,
      timeoutMs: 1000,
      extraLinesOf: () => ['- 产物：a.csv'],
    });
    expect(markdown).toContain('## 结果');
    expect(markdown).toContain('- 产物：a.csv');
    expect(markdown).toContain('状态：success');
    expect(markdown).toContain('line 2');
    expect(notify).toHaveBeenCalledWith(1, 'line 1');
    expect(notify).toHaveBeenCalledWith(2, 'line 2');
  });

  it('运行中逐行推送增量输出，终态后返回完整 Markdown', async () => {
    const stream = new Subject<MessageEvent>();
    const pushed: string[] = [];
    const notify = jest.fn(
      (_progress: number, message: string): Promise<void> => {
        pushed.push(message);
        return Promise.resolve();
      },
    );
    const promise = collectRunMarkdown({
      title: '运行检查 `demo`',
      metaLines: [],
      stream,
      initial: runOf({}),
      notify,
      timeoutMs: 1000,
    });
    stream.next({ data: runOf({ output: ['a', 'b'] }) });
    stream.next({
      data: runOf({
        status: 'fail',
        fail: 1,
        success: 0,
        skip: 0,
        output: ['a', 'b', 'c'],
      }),
    });
    const markdown = await promise;
    expect(pushed).toEqual(['a', 'b', 'c']);
    expect(markdown).toContain('状态：fail');
  });

  it('等待超时返回当前快照并提示用 get_run 找回', async () => {
    jest.useFakeTimers();
    try {
      const stream = new Subject<MessageEvent>();
      const promise = collectRunMarkdown({
        title: '运行检查 `demo`',
        metaLines: [],
        stream,
        initial: runOf({ output: ['running line'] }),
        notify: null,
        timeoutMs: 1000,
      });
      jest.advanceTimersByTime(1000);
      const markdown = await promise;
      expect(markdown).toContain('等待超时');
      expect(markdown).toContain('get_run');
      expect(markdown).toContain('running line');
    } finally {
      jest.useRealTimers();
    }
  });
});
