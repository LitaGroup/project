import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  CodeEventsService,
  CodeEventView,
  ListCodeEventsQuery,
} from './code-events.service';

function parseQuery(
  projectId?: string,
  repo?: string,
  branch?: string,
  q?: string,
  limit?: string,
): ListCodeEventsQuery {
  return {
    projectId:
      projectId === undefined || projectId === ''
        ? undefined
        : Number(projectId),
    repo,
    branch,
    q,
    limit: limit === undefined || limit === '' ? undefined : Number(limit),
  };
}

@Controller('code-events')
export class CodeEventsController {
  constructor(private readonly codeEventsService: CodeEventsService) {}

  /** 提交记录：projectId（匹配该项目登记的 仓库+分支）/repo/branch 过滤 + q 模糊（信息/作者），按提交时间倒序 */
  @Get()
  list(
    @Query('projectId') projectId?: string,
    @Query('repo') repo?: string,
    @Query('branch') branch?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<CodeEventView[]> {
    return this.codeEventsService.listEvents(
      parseQuery(projectId, repo, branch, q, limit),
    );
  }
}

/** GET /api/code-events.md：提交记录清单的 Markdown 视图（单段路径经独立控制器挂载） */
@Controller('code-events.md')
export class CodeEventsMarkdownController {
  constructor(private readonly codeEventsService: CodeEventsService) {}

  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  listMarkdown(
    @Query('projectId') projectId?: string,
    @Query('repo') repo?: string,
    @Query('branch') branch?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<string> {
    return this.codeEventsService.listMarkdown(
      parseQuery(projectId, repo, branch, q, limit),
    );
  }
}
