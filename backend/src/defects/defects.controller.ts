import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TestRun } from '../tests/test-run.entity';
import { Defect } from './defect.entity';
import { DefectsService, SyncDefectsResult } from './defects.service';

class SyncDefectsDto {
  projectId: number;
}

class UpdateDefectDto {
  /** 端：前端/后端/APP端/未知（默认），空串或非规范值归为"未知" */
  platform?: string;
  /** 状态：open/reopen/fixed/closed/invalid；改 fixed 的规则见 defects.service */
  status?: string;
  /** 测试脚本：相对脚本根目录的 .test.ts 路径，空串清除 */
  testScript?: string;
  /** 备注 */
  remark?: string;
}

@Controller('defects')
export class DefectsController {
  constructor(private readonly defectsService: DefectsService) {}

  /** 缺陷列表：传 projectId 按项目过滤，不传返回全部（全局列表页用）。不含 description/images */
  @Get()
  findByProject(@Query('projectId') projectId?: string): Promise<Defect[]> {
    return this.defectsService.findByProject(
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  /** 从项目绑定的飞书多维表格全量同步缺陷（直接覆盖本地飞书侧字段） */
  @Post('sync')
  syncFromFeishu(@Body() dto: SyncDefectsDto): Promise<SyncDefectsResult> {
    return this.defectsService.syncFromFeishu(dto.projectId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Defect> {
    return this.defectsService.findOne(id);
  }

  /** 更新缺陷（端/状态/测试脚本/备注）；状态或端变更后异步回写飞书 */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDefectDto,
  ): Promise<Defect> {
    return this.defectsService.update(id, dto);
  }

  /** 运行验证：启动缺陷测试脚本的一次运行，通过后才允许标记 fixed */
  @Post(':id/verify')
  verify(@Param('id', ParseIntPipe) id: number): Promise<TestRun> {
    return this.defectsService.verify(id);
  }

  /** 删除本地缺陷记录（不影响飞书多维表格） */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.defectsService.remove(id);
  }
}
