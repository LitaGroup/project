import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AppVersion } from './app-version.entity';
import { AppVersionInput, AppVersionsService } from './app-versions.service';

class CreateAppVersionDto implements AppVersionInput {
  projectId: number;
  platform: string;
  appTarget: string;
  version: string;
  remark?: string;
}

@Controller('app-versions')
export class AppVersionsController {
  constructor(private readonly appVersionsService: AppVersionsService) {}

  /** APP 版本列表：传 projectId 按项目过滤，不传返回全部 */
  @Get()
  list(@Query('projectId') projectId?: string): Promise<AppVersion[]> {
    return this.appVersionsService.findByProject(
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  @Post()
  create(@Body() dto: CreateAppVersionDto): Promise<AppVersion> {
    return this.appVersionsService.create(dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.appVersionsService.remove(id);
  }
}
