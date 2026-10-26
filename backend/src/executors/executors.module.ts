import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Executor } from './executor.entity';
import { ExecutorsController } from './executors.controller';
import { ExecutorsService } from './executors.service';
import { OpencodeEventHub } from './opencode-event-hub.service';

@Module({
  imports: [TypeOrmModule.forFeature([Executor])],
  controllers: [ExecutorsController],
  providers: [ExecutorsService, OpencodeEventHub],
  exports: [ExecutorsService, OpencodeEventHub],
})
export class ExecutorsModule {}
