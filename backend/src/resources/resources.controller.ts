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
import { ResourceType } from '../common/enums';
import { Resource } from './resource.entity';
import {
  CreateResourceInput,
  ResourcesService,
  UpdateResourceInput,
} from './resources.service';

class CreateResourceDto implements CreateResourceInput {
  projectId: number;
  /** 资源类型：配置/多语言/文件资源/UI/其它 */
  type: ResourceType;
  /** 标题：仅文件资源/UI/多语言（有前缀时）可留空（URL/前缀推导），其余必填；不与绑定文档标题联动 */
  title?: string;
  /** 初始状态：缺失/草稿/确认/废弃，缺省为"缺失" */
  status?: string;
  /** 链接：配置=飞书文档 URL（可空，状态"缺失"时可暂不提供）；文件资源=文件 URL；UI=蓝湖地址（原样保存） */
  url?: string;
  description?: string;
  /** 多语言：命名空间前缀 {SHEET}$NAMESPACE（SHEET=Activity/Frontend/FE/Backend，省略默认 Activity；NAMESPACE 以 $ 开头可省略），空=缺失 */
  prefix?: string;
  remark?: string;
}

class UpdateResourceDto implements UpdateResourceInput {
  title?: string;
  /** 状态：缺失/草稿/确认/废弃（废弃为软删除，列表默认隐藏；无凭据[URL/多语言前缀]时只能为"缺失"或"废弃"） */
  status?: string;
  url?: string;
  description?: string;
  /** 多语言：命名空间前缀（规范化存储），空串清除 */
  prefix?: string;
  remark?: string;
}

@Controller('resources')
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  /**
   * 资源列表：传 projectId 按项目过滤，不传返回全部（全局列表页用）。
   * includeDeleted=true 时包含软删除（状态=废弃）记录。不含多语言缓存正文
   */
  @Get()
  findByProject(
    @Query('projectId') projectId?: string,
    @Query('includeDeleted') includeDeleted?: string,
  ): Promise<Resource[]> {
    return this.resourcesService.findByProject(
      projectId === undefined ? undefined : Number(projectId),
      includeDeleted === 'true',
    );
  }

  /** Markdown 视图（须声明在 :id 之前，避免 :id 匹配到带 .md 后缀的路径） */
  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  findOneMarkdown(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.resourcesService.findOneMarkdown(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Resource> {
    return this.resourcesService.findOne(id);
  }

  /** 创建资源；配置类型 URL 可空（"缺失"表示尚未拿到），有 URL 时按链接自动绑定/新建文档 */
  @Post()
  create(@Body() dto: CreateResourceDto): Promise<Resource> {
    return this.resourcesService.create(dto);
  }

  /** 更新资源（标题/状态/链接/描述/前缀/备注）；status=废弃 为软删除 */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateResourceDto,
  ): Promise<Resource> {
    return this.resourcesService.update(id, dto);
  }

  /** 同步：配置类型重新拉取绑定文档（仅飞书链接）；多语言类型按前缀拉取 Lita word/sheet 接口缓存文案 */
  @Post(':id/sync')
  sync(@Param('id', ParseIntPipe) id: number): Promise<Resource> {
    return this.resourcesService.sync(id);
  }

  /** 硬删除（永久移除；软删除走 PATCH status=废弃）。不级联删除绑定的文档 */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.resourcesService.remove(id);
  }
}
