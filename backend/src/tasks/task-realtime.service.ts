import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/** 任务看板变更事件：只传轻量变更，由 SSE 端按需补齐任务快照 */
export type TaskRealtimeEvent =
  | { type: 'upsert'; taskId: number }
  | { type: 'line'; taskId: number; line: string }
  | { type: 'deleted'; ids: number[] };

/**
 * 任务看板进程内事件总线。
 * 任务状态/字段变更与执行输出只在这里广播一次，由各 SSE 连接自行分发。
 */
@Injectable()
export class TaskRealtimeService {
  private readonly subject = new Subject<TaskRealtimeEvent>();

  readonly events$: Observable<TaskRealtimeEvent> = this.subject.asObservable();

  taskChanged(taskId: number): void {
    this.subject.next({ type: 'upsert', taskId });
  }

  lineAppended(taskId: number, line: string): void {
    this.subject.next({ type: 'line', taskId, line });
  }

  tasksDeleted(ids: number[]): void {
    if (ids.length === 0) return;
    this.subject.next({ type: 'deleted', ids });
  }
}
