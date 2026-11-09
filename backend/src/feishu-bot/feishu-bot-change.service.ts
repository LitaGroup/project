import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

/**
 * 飞书配置变更总线：配置保存/删除后通知长连接服务重建对应的 WS 客户端。
 * 单独成服务，避免 ConfigService 与 LongConnectionService 互相依赖。
 */
@Injectable()
export class FeishuBotChangeBus {
  private readonly subject = new Subject<number | 'all'>();

  readonly changes$ = this.subject.asObservable();

  configChanged(configId: number): void {
    this.subject.next(configId);
  }

  allChanged(): void {
    this.subject.next('all');
  }
}
