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
import { CodeBranchCategory } from '../common/enums';
import { ProjectBranch } from './project-branch.entity';
import {
  CodeBranchesService,
  CreateCodeBranchInput,
  UpdateCodeBranchInput,
} from './code-branches.service';

class CreateCodeBranchDto implements CreateCodeBranchInput {
  projectId: number;
  /** 仓库：名 / owner/name / 完整 URL 均可，归一化存 owner/name */
  repo: string;
  /** 分支名（通常 test/main/stable） */
  branch: string;
  /** 归类：后端/H5/安卓/IOS/其它，默认其它 */
  category?: CodeBranchCategory;
  remark?: string;
}

class UpdateCodeBranchDto implements UpdateCodeBranchInput {
  repo?: string;
  branch?: string;
  category?: CodeBranchCategory;
  remark?: string;
}

@Controller('code-branches')
export class CodeBranchesController {
  constructor(private readonly codeBranchesService: CodeBranchesService) {}

  /** 代码分支登记：传 projectId 按项目过滤，不传返回全部 */
  @Get()
  findByProject(
    @Query('projectId') projectId?: string,
  ): Promise<ProjectBranch[]> {
    return this.codeBranchesService.findByProject(
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  @Post()
  create(@Body() dto: CreateCodeBranchDto): Promise<ProjectBranch> {
    return this.codeBranchesService.create(dto);
  }

  /** 更新登记（仓库/分支/归类/备注） */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCodeBranchDto,
  ): Promise<ProjectBranch> {
    return this.codeBranchesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.codeBranchesService.remove(id);
  }
}
