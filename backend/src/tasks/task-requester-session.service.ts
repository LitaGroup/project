import { Injectable } from '@nestjs/common';

/**
 * 需求方机器人一次性会话互斥：
 * 消息回复、提问答复、自动验收都可能在同一个需求方机器人上触发，
 * 同一机器人同一时刻只允许一个一次性会话，避免并发抢占工位。
 */
@Injectable()
export class TaskRequesterSessionService {
  private readonly activeWorkers = new Set<number>();

  /** 占用需求方机器人；已被占用时返回 false。 */
  tryAcquire(workerId: number): boolean {
    if (this.activeWorkers.has(workerId)) return false;
    this.activeWorkers.add(workerId);
    return true;
  }

  release(workerId: number): void {
    this.activeWorkers.delete(workerId);
  }
}
