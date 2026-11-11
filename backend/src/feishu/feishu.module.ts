import { forwardRef, Module } from '@nestjs/common';
import { FeishuBotModule } from '../feishu-bot/feishu-bot.module';
import { FeishuController } from './feishu.controller';
import { FeishuService } from './feishu.service';

@Module({
  imports: [forwardRef(() => FeishuBotModule)],
  controllers: [FeishuController],
  providers: [FeishuService],
  exports: [FeishuService],
})
export class FeishuModule {}
