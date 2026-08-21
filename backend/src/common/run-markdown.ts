import { MessageEvent } from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';

/** 运行快照的最小公共结构（CheckRun / TestRun 字段一致） */
interface RunSnapshotLike {
  status: 'running' | 'success' | 'fail' | 'error';
  total: number | null;
  current: number;
  success: number | null;
  fail: number | null;
  skip: number | null;
  message: string | null;
  durationMs: number | null;
  output: string[] | null;
}

/**
 * AI 用：将一次脚本运行以 Markdown 流式写出（text/markdown）。
 * 先写头部信息与"输出"小节，运行中逐行追加脚本原始输出（快照为累积式，只写增量），
 * 终态后补"结果"小节并结束响应。客户端断开时退订，不再写入。
 */
export function streamRunMarkdown(
  res: Response,
  header: string[],
  stream: Observable<MessageEvent>,
): Promise<void> {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  // 关闭反向代理缓冲，保证逐行实时到达
  res.setHeader('X-Accel-Buffering', 'no');
  res.write(`${header.join('\n')}\n\n## 输出\n\n`);

  return new Promise((resolve) => {
    let sent = 0;
    let settled = false;
    const sub = stream.subscribe({
      next: (event) => {
        const snapshot = event.data as RunSnapshotLike;
        const output = snapshot.output ?? [];
        for (; sent < output.length; sent++) {
          res.write(`${output[sent]}\n`);
        }
        if (snapshot.status !== 'running') {
          res.write(`\n## 结果\n\n${resultLines(snapshot).join('\n')}\n`);
          finish();
        }
      },
      error: () => finish(),
      complete: () => finish(),
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      sub.unsubscribe();
      res.end();
      resolve();
    };
    res.on('close', finish);
  });
}

function resultLines(snapshot: RunSnapshotLike): string[] {
  const lines = [`- 状态：${snapshot.status}`];
  if (snapshot.total !== null) {
    lines.push(`- 进度：${snapshot.current}/${snapshot.total}`);
  }
  if (snapshot.success !== null || snapshot.fail !== null) {
    lines.push(
      `- 成功 ${snapshot.success ?? 0} / 失败 ${snapshot.fail ?? 0} / 跳过 ${snapshot.skip ?? 0}`,
    );
  }
  if (snapshot.durationMs !== null) {
    lines.push(`- 耗时：${snapshot.durationMs}ms`);
  }
  if (snapshot.message) {
    lines.push(`- 消息：${snapshot.message}`);
  }
  return lines;
}
