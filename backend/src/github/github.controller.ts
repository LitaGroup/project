import { Controller, Get, Query } from '@nestjs/common';
import { GithubRepo, GithubService } from './github.service';

@Controller('github')
export class GithubController {
  constructor(private readonly github: GithubService) {}

  /** 仓库搜索：组织下仓库列表（q 匹配 名称/描述，缓存 5 分钟，最多返回 50 条） */
  @Get('repos')
  searchRepos(@Query('q') q?: string): Promise<GithubRepo[]> {
    return this.github.searchRepos(q);
  }

  /** 分支联想：指定仓库的全部分支名（repo 支持 名/owner/name/完整 URL） */
  @Get('branches')
  listBranches(@Query('repo') repo?: string): Promise<string[]> {
    return this.github.listBranches(repo ?? '');
  }
}
