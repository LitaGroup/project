import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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

class CreateDefectDto {
  /** 所属项目 */
  projectId: number;
  /** 简述（标题） */
  title: string;
  /** 来源：脚本/录入（飞书来源只能由同步产生），缺省录入 */
  source?: string;
  /** 端：前端/后端/APP端/未知（默认） */
  platform?: string;
  /** 操作步骤与关键信息（Markdown，截图以 /images/... 链接内嵌） */
  steps?: string;
  /** 预期结果 */
  expected?: string;
  /** 实际结果 */
  actual?: string;
  /** 测试脚本：相对脚本根目录的 .test.ts 路径 */
  testScript?: string;
  /** 开发 */
  developer?: string;
  /** 测试 */
  tester?: string;
  /** 备注 */
  remark?: string;
}

class UpdateDefectDto {
  /** 简述（标题） */
  title?: string;
  /** 端：前端/后端/APP端/未知（默认），空串或非规范值归为"未知" */
  platform?: string;
  /** 状态：开放/修复/关闭；改"修复"的规则见 defects.service */
  status?: string;
  /** 测试脚本：相对脚本根目录的 .test.ts 路径，空串清除 */
  testScript?: string;
  /** 备注 */
  remark?: string;
  /** 操作步骤与关键信息（Markdown） */
  steps?: string;
  /** 预期结果 */
  expected?: string;
  /** 实际结果 */
  actual?: string;
  /** 开发 */
  developer?: string;
  /** 测试 */
  tester?: string;
}

@Controller('defects')
export class DefectsController {
  constructor(private readonly defectsService: DefectsService) {}

  /** 缺陷列表：传 projectId 按项目过滤，不传返回全部（全局列表页用）。不含大字段 */
  @Get()
  findByProject(@Query('projectId') projectId?: string): Promise<Defect[]> {
    return this.defectsService.findByProject(
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  /** 人工/脚本一键生成缺陷（来源为录入或脚本） */
  @Post()
  create(@Body() dto: CreateDefectDto): Promise<Defect> {
    return this.defectsService.create(dto);
  }

  /**
   * AI 用：创建缺陷并返回 Markdown 结果（text/markdown）。
   * body 同 POST /api/defects，返回缺陷 ID 与阅读地址。
   */
  @Post('create.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  createMarkdown(@Body() dto: CreateDefectDto): Promise<string> {
    return this.defectsService.createMarkdown(dto);
  }

  /** 从项目绑定的飞书多维表格全量同步缺陷（直接覆盖本地飞书侧字段） */
  @Post('sync')
  syncFromFeishu(@Body() dto: SyncDefectsDto): Promise<SyncDefectsResult> {
    return this.defectsService.syncFromFeishu(dto.projectId);
  }

  /** Markdown 视图（须声明在 :id 之前，避免 :id 匹配到带 .md 后缀的路径） */
  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  findOneMarkdown(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.defectsService.findOneMarkdown(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Defect> {
    return this.defectsService.findOne(id);
  }

  /** 更新缺陷（端/状态/测试脚本/备注/正文与人员字段）；状态或端变更后异步回写飞书 */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDefectDto,
  ): Promise<Defect> {
    return this.defectsService.update(id, dto);
  }

  /**
   * AI 用：更新缺陷并返回 Markdown 结果（text/markdown）。
   * body 同 PATCH /api/defects/:id，改状态为"修复"时同样校验用例最近运行。
   */
  @Post(':id/update.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  updateMarkdown(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDefectDto,
  ): Promise<string> {
    return this.defectsService.updateMarkdown(id, dto);
  }

  /**
   * AI 用：删除缺陷并返回 Markdown 结果（text/markdown）。
   * 仅删本地记录，不影响飞书多维表格。
   */
  @Post(':id/delete.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  removeMarkdown(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.defectsService.removeMarkdown(id);
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

/** GET /api/defects.md：缺陷清单 Markdown 视图（单段路径经独立控制器挂载） */
@Controller('defects.md')
export class DefectsMarkdownController {
  constructor(private readonly defectsService: DefectsService) {}

  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  listMarkdown(
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('q') q?: string,
  ): Promise<string> {
    return this.defectsService.listMarkdown({
      projectId: projectId === undefined ? undefined : Number(projectId),
      status,
      source,
      q,
    });
  }
}
