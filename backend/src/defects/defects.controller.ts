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
import { DefectChangeRecord } from './defect-change-record.entity';
import { Defect } from './defect.entity';
import { DefectsService } from './defects.service';

class CreateDefectDto {
  /** 所属项目 */
  projectId: number;
  /** 预期功能描述（必填） */
  expected: string;
  /** 实际结果描述（必填） */
  actual: string;
  /** 端：前端/后端/APP端/未知（默认） */
  platform?: string;
  /** 优先级：高/中/低（默认中） */
  priority?: string;
  /** 图片：/images/... 路径数组（POST /api/images 上传后返回的 url），最多 9 张 */
  images?: string[];
  /** 用例脚本：相对脚本根目录的 .test.ts 路径 */
  testScript?: string;
}

class UpdateDefectDto {
  /** 端：前端/后端/APP端/未知（默认），空串或非规范值归为"未知" */
  platform?: string;
  /** 优先级：高/中/低，非规范值归为"中" */
  priority?: string;
  /** 状态：开放/修复/关闭；改"修复"的规则见 defects.service */
  status?: string;
  /** 预期功能描述 */
  expected?: string;
  /** 实际结果描述 */
  actual?: string;
  /** 图片：/images/... 路径数组，全量覆盖（空数组清除） */
  images?: string[];
  /** 用例脚本：相对脚本根目录的 .test.ts 路径，空串清除 */
  testScript?: string;
  /** 变更内容：状态变更时并入状态记录，否则单独记一条内容变更记录（可空） */
  changeContent?: string;
  /** 本次变更的备注信息（写入变更记录） */
  changeRemark?: string;
}

class ChangeStatusDto {
  /** 目标状态：开放/修复/关闭 */
  status: string;
  /** 备注信息（写入变更记录） */
  remark?: string;
  /** 变更内容（缺省生成"状态变更：X → Y"） */
  content?: string;
}

class CreateDefectRecordDto {
  /** 变更内容 */
  content: string;
  /** 备注信息 */
  remark?: string;
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

  /** 人工/AI 创建缺陷（预期与实际为必填） */
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

  /** 变更记录列表（倒序） */
  @Get(':id/records')
  listRecords(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DefectChangeRecord[]> {
    return this.defectsService.listRecords(id);
  }

  /** 追加一条变更记录（变更内容 + 备注，状态取缺陷当前状态） */
  @Post(':id/records')
  @HttpCode(201)
  addRecord(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateDefectRecordDto,
  ): Promise<DefectChangeRecord> {
    return this.defectsService.addRecord(id, dto);
  }

  /** 更新缺陷（端/状态/测试脚本/备注/正文与人员字段） */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDefectDto,
  ): Promise<Defect> {
    return this.defectsService.update(id, dto);
  }

  /**
   * AI 用：状态变更并返回 Markdown 结果（text/markdown）。
   * 一步完成状态流转 + 变更记录；改"修复"同样校验用例最近运行，状态未变化时幂等。
   */
  @Post(':id/status.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  changeStatusMarkdown(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeStatusDto,
  ): Promise<string> {
    return this.defectsService.changeStatusMarkdown(id, dto);
  }

  /**
   * AI 用：追加变更记录并返回 Markdown 结果（text/markdown）。
   * 只追加不改缺陷字段；状态取缺陷当前状态。
   */
  @Post(':id/records.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  addRecordMarkdown(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateDefectRecordDto,
  ): Promise<string> {
    return this.defectsService.addRecordMarkdown(id, dto);
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
   * 仅删本地记录及变更记录。
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

  /** 删除本地缺陷记录（含变更记录） */
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
    @Query('priority') priority?: string,
    @Query('q') q?: string,
  ): Promise<string> {
    return this.defectsService.listMarkdown({
      projectId: projectId === undefined ? undefined : Number(projectId),
      status,
      priority,
      q,
    });
  }
}
