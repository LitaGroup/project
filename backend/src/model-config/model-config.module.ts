import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmService } from './llm.service';
import { ModelConfigController } from './model-config.controller';
import { ModelConfigService } from './model-config.service';
import { ModelScenario } from './model-scenario.entity';

/**
 * 管理区「模型配置」：固定场景的 OpenAI 兼容模型连接（baseUrl/apiKey/model/思考等级），
 * 以及供后台任务复用的单次大模型调用（LlmService）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([ModelScenario])],
  controllers: [ModelConfigController],
  providers: [ModelConfigService, LlmService],
  exports: [ModelConfigService, LlmService],
})
export class ModelConfigModule {}
