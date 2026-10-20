import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ReposService } from './repos.service';
import type {
  ListReposQuery,
  RepoSyncResult,
  UpdateRepoInput,
} from './repos.service';
import { Repo } from './repo.entity';

function parseQuery(
  platform?: string,
  status?: string,
  q?: string,
): ListReposQuery {
  return { platform, status, q };
}

/**
 * 代码仓库登记：组织仓库清单（每小时同步）+ 平台侧维护的端/状态。
 * 状态「忽略」的仓库不再出现在仓库联想（/github/repos）与代码分支候选。
 */
@Controller('repos')
export class ReposController {
  constructor(private readonly reposService: ReposService) {}

  /** 仓库列表：platform=前端/后端/安卓/苹果/其它，status=有效/忽略，q 模糊匹配 仓库名/描述 */
  @Get()
  list(
    @Query('platform') platform?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ): Promise<Repo[]> {
    return this.reposService.list(parseQuery(platform, status, q));
  }

  /** 立即同步组织仓库清单（刷新最后更新时间 / 补充新仓库） */
  @Post('sync')
  sync(): Promise<RepoSyncResult> {
    return this.reposService.sync();
  }

  /** 更新端/状态/备注（状态=忽略即从联想等候选移除） */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateRepoInput,
  ): Promise<Repo> {
    return this.reposService.update(id, body);
  }
}

/** GET /api/repos.md：仓库清单的 Markdown 视图（单段路径经独立控制器挂载） */
@Controller('repos.md')
export class ReposMarkdownController {
  constructor(private readonly reposService: ReposService) {}

  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  listMarkdown(
    @Query('platform') platform?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ): Promise<string> {
    return this.reposService.listMarkdown(parseQuery(platform, status, q));
  }
}
