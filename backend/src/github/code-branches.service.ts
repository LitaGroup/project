import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { CodeBranchCategory, RepoPlatform } from '../common/enums';
import { GithubService } from './github.service';
import { ProjectBranch } from './project-branch.entity';
import { ReposService } from './repos.service';

export interface CreateCodeBranchInput {
  projectId: number;
  /** 仓库：名 / owner/name / 完整 URL 均可，归一化存 owner/name */
  repo: string;
  /** 分支名（通常 test/main/stable） */
  branch: string;
  /** 归类：后端/H5/安卓/IOS/其它，默认其它 */
  category?: CodeBranchCategory;
  remark?: string;
}

export interface UpdateCodeBranchInput {
  repo?: string;
  branch?: string;
  category?: CodeBranchCategory;
  remark?: string;
}

/**
 * 项目代码分支：项目涉及修改的 GitHub 仓库与分支登记。
 * 监听范围 = 全平台登记的 (repo, branch) 去重集合（见 github-watch.service）。
 */
@Injectable()
export class CodeBranchesService {
  constructor(
    @InjectRepository(ProjectBranch)
    private readonly branches: Repository<ProjectBranch>,
    private readonly github: GithubService,
    private readonly repos: ReposService,
  ) {}

  /** 按项目列出；不传 projectId 返回全部（全局视角），按仓库/分支排序 */
  findByProject(projectId?: number): Promise<ProjectBranch[]> {
    const where: FindOptionsWhere<ProjectBranch> =
      projectId === undefined ? {} : { projectId };
    return this.branches.find({
      where,
      order: { repo: 'ASC', branch: 'ASC', id: 'ASC' },
    });
  }

  async create(input: CreateCodeBranchInput): Promise<ProjectBranch> {
    const repo = this.github.normalizeRepo(input.repo);
    // 状态「忽略」的仓库不再作为代码分支候选（存量登记不受影响）
    await this.github.assertRepoActive(repo);
    const branch = this.normalizeBranch(input.branch);
    const category = await this.resolveCategory(repo, input.category);
    const remark = this.normalizeRemark(input.remark);
    await this.assertUnique(input.projectId, repo, branch);
    return this.branches.save(
      this.branches.create({
        projectId: input.projectId,
        repo,
        branch,
        category,
        remark,
      }),
    );
  }

  async update(
    id: number,
    input: UpdateCodeBranchInput,
  ): Promise<ProjectBranch> {
    const record = await this.branches.findOne({ where: { id } });
    if (!record) throw new NotFoundException(`CodeBranch ${id} not found`);
    let repo = record.repo;
    let branch = record.branch;
    if (input.repo !== undefined) {
      repo = this.github.normalizeRepo(input.repo);
      if (repo !== record.repo) await this.github.assertRepoActive(repo);
    }
    if (input.branch !== undefined) branch = this.normalizeBranch(input.branch);
    if (repo !== record.repo || branch !== record.branch) {
      await this.assertUnique(record.projectId, repo, branch, id);
    }
    record.repo = repo;
    record.branch = branch;
    if (input.category !== undefined) {
      record.category = this.normalizeCategory(input.category);
    }
    if (input.remark !== undefined) {
      record.remark = this.normalizeRemark(input.remark);
    }
    return this.branches.save(record);
  }

  async remove(id: number): Promise<void> {
    const record = await this.branches.findOne({ where: { id } });
    if (!record) throw new NotFoundException(`CodeBranch ${id} not found`);
    await this.branches.remove(record);
  }

  /** 删除项目时的应用层级联清理（测试库无物理外键）；code_events 保留（按仓库/分支记录，与项目无关） */
  async removeByProject(projectId: number): Promise<void> {
    await this.branches.delete({ projectId });
  }

  /** 项目内 (repo, branch) 唯一 */
  private async assertUnique(
    projectId: number,
    repo: string,
    branch: string,
    excludeId?: number,
  ): Promise<void> {
    const where: FindOptionsWhere<ProjectBranch> = { projectId, repo, branch };
    const existed = await this.branches.findOne({ where });
    if (existed && existed.id !== excludeId) {
      throw new BadRequestException(
        `该项目已登记 ${repo}@${branch}，请直接编辑或删除原登记`,
      );
    }
  }

  /** 分支名：trim，禁止空白与穿越，长度 ≤ 200 */
  private normalizeBranch(branch: string): string {
    const v = (branch ?? '').trim();
    if (!v) throw new BadRequestException('分支不能为空');
    if (/\s/.test(v)) throw new BadRequestException('分支名不能包含空白字符');
    if (v.length > 200) throw new BadRequestException('分支名过长');
    return v;
  }

  private normalizeCategory(
    category: CodeBranchCategory | undefined,
  ): CodeBranchCategory {
    if (category === undefined || category === null) {
      return CodeBranchCategory.OTHER;
    }
    if (!Object.values(CodeBranchCategory).includes(category)) {
      throw new BadRequestException(
        `非法的归类：${category}（可选：${Object.values(CodeBranchCategory).join('/')}）`,
      );
    }
    return category;
  }

  /**
   * 未显式指定归类时沿用仓库登记的「端」（仓库列表里维护），避免一律落到「其它」：
   * 前端仓库 → H5、苹果 → IOS，其余同名映射。仓库未登记或端为「其它」时回退「其它」。
   */
  private async resolveCategory(
    repo: string,
    category: CodeBranchCategory | undefined,
  ): Promise<CodeBranchCategory> {
    if (category !== undefined && category !== null) {
      return this.normalizeCategory(category);
    }
    const record = await this.repos.findByFullName(repo);
    return record
      ? repoPlatformToCategory(record.platform)
      : CodeBranchCategory.OTHER;
  }

  /** 备注：trim，空串 → null */
  private normalizeRemark(remark: string | undefined): string | null {
    const v = remark?.trim() ?? '';
    return v || null;
  }
}

/** 仓库的「端」→ 代码分支归类（前端仓库归为 H5，苹果 → IOS，其它保持其它） */
export function repoPlatformToCategory(
  platform: RepoPlatform,
): CodeBranchCategory {
  switch (platform) {
    case RepoPlatform.BACKEND:
      return CodeBranchCategory.BACKEND;
    case RepoPlatform.FRONTEND:
      return CodeBranchCategory.H5;
    case RepoPlatform.ANDROID:
      return CodeBranchCategory.ANDROID;
    case RepoPlatform.IOS:
      return CodeBranchCategory.IOS;
    default:
      return CodeBranchCategory.OTHER;
  }
}
