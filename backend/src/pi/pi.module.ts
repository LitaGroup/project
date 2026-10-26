import { Module } from '@nestjs/common';
import { PiSchedulerService } from './pi-scheduler.service';

/** PI Agent 运行时（平台进程内）：调度器等内部 Agent 能力 */
@Module({
  providers: [PiSchedulerService],
  exports: [PiSchedulerService],
})
export class PiModule {}
