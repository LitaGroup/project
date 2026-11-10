import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import type { User } from '../auth/user.entity';
import { UserRole } from '../common/enums';
import { ModelConfigService } from './model-config.service';
import type {
  FetchModelsInput,
  ModelScenarioView,
  SaveModelScenarioInput,
} from './model-scenario.entity';

/** 管理端点统一要求管理员 */
function assertAdmin(user: User | undefined): void {
  if (user?.role !== UserRole.ADMIN) {
    throw new ForbiddenException('仅管理员可管理模型配置');
  }
}

/**
 * 管理区「模型配置」：
 * - GET /api/admin/model-config 固定场景列表（apiKey 只返回是否已配置）；
 * - PUT /api/admin/model-config/:scenario 保存场景配置（apiKey 留空保持原值）；
 * - POST /api/admin/model-config/:scenario/fetch-models 后端代理拉取模型列表
 *   （可传未保存的 baseUrl/apiKey 供保存前测试）。
 */
@Controller('admin/model-config')
export class ModelConfigController {
  constructor(private readonly config: ModelConfigService) {}

  @Get()
  list(@Req() req: AuthedRequest): Promise<ModelScenarioView[]> {
    assertAdmin(req.user);
    return this.config.list();
  }

  @Put(':scenario')
  save(
    @Req() req: AuthedRequest,
    @Param('scenario') scenario: string,
    @Body() body: SaveModelScenarioInput,
  ): Promise<ModelScenarioView> {
    assertAdmin(req.user);
    return this.config.save(scenario, body);
  }

  @Post(':scenario/fetch-models')
  fetchModels(
    @Req() req: AuthedRequest,
    @Param('scenario') scenario: string,
    @Body() body?: FetchModelsInput,
  ): Promise<string[]> {
    assertAdmin(req.user);
    return this.config.fetchModels(scenario, body ?? {});
  }
}
