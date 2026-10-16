import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChecksService } from '../checks/checks.service';
import { mdFrontmatter } from '../common/frontmatter';
import { ExportsService } from '../exports/exports.service';
import { Project } from '../projects/project.entity';
import { TestsService } from '../tests/tests.service';

/**
 * AI 用统一脚本导入（POST /api/scripts/import.md）：
 * 扫描项目脚本目录（scriptsPath），把未登记的 .check.ts / .test.ts / .export.ts
 * 一次导入为 检查 / 用例 / 导出。缺 projectId 或项目未配置脚本目录时不执行导入，
 * 返回带下一步指引的 Markdown（HTTP 200，便于 agent 按指引继续操作）。
 */
@Injectable()
export class ScriptsImportService {
  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly checksService: ChecksService,
    private readonly testsService: TestsService,
    private readonly exportsService: ExportsService,
  ) {}

  async importMarkdown(projectId?: number | string | null): Promise<string> {
    const id =
      projectId === undefined ||
      projectId === null ||
      `${projectId}`.trim() === ''
        ? undefined
        : Number(projectId);
    if (id === undefined || !Number.isInteger(id) || id <= 0) {
      return this.renderGuidance('未指定项目', [
        '导入脚本必须指定项目：先按名称搜索项目拿到 id，再携带 `{"projectId": <id>}` 重试。',
        '',
        '```bash',
        "curl '{BASE}/api/projects/search.md?q={项目名称关键词}'",
        "curl -X POST {BASE}/api/scripts/import.md -H 'Content-Type: application/json' -d '{\"projectId\": <id>}'",
        '```',
      ]);
    }
    const project = await this.projects.findOne({ where: { id } });
    if (!project) {
      return this.renderGuidance(`项目 #${id} 不存在`, [
        '先按名称搜索项目确认 id 后重试：',
        '',
        '```bash',
        "curl '{BASE}/api/projects/search.md?q={项目名称关键词}'",
        '```',
      ]);
    }
    if (!project.scriptsPath) {
      return this.renderGuidance(`项目「${project.name}」未配置脚本目录`, [
        '未配置 scriptsPath 时无法定位要导入的脚本（脚本目录是相对脚本根目录的子目录，即提交代码所在的目录；脚本根目录见 `GET /api/settings.md`）。请先配置后重试：',
        '',
        '```bash',
        `curl -X POST {BASE}/api/projects/${project.id}/update.md -H 'Content-Type: application/json' -d '{"scriptsPath": "projects/xxx"}'`,
        "curl -X POST {BASE}/api/scripts/import.md -H 'Content-Type: application/json' -d '{\"projectId\": " +
          project.id +
          "}'",
        '```',
      ]);
    }

    const [checks, tests, exports] = await Promise.all([
      this.checksService.importFromScripts(project.id),
      this.testsService.importFromScripts(project.id),
      this.exportsService.importFromScripts(project.id),
    ]);

    const createdCount =
      checks.created.length + tests.created.length + exports.created.length;
    const sections = [
      this.renderSection('检查', '/api/checks', checks),
      this.renderSection('用例', '/api/tests', tests),
      this.renderSection('导出', '/api/exports', exports),
    ];
    const hint =
      createdCount === 0
        ? [
            '',
            '> 未发现可导入的新脚本：请确认代码已提交，且平台侧脚本仓库已更新（`POST /api/settings/scripts/pull.md`）。',
            '',
          ]
        : [];
    return [
      mdFrontmatter({
        update: project.updatedAt,
        title: `脚本导入 - ${project.name}`,
      }),
      '# 脚本导入完成',
      '',
      `- 项目：${project.name}（#${project.id}）`,
      `- 脚本目录：\`${project.scriptsPath}\``,
      '',
      ...sections,
      ...hint,
    ].join('\n');
  }

  /** 导入结果小节：created 为新登记记录（含 id/code/scriptPath），skipped 为已登记跳过数 */
  private renderSection(
    label: string,
    base: string,
    result: {
      created: { id: number; code: string; scriptPath: string }[];
      skipped: number;
    },
  ): string {
    const rows = result.created.map(
      (item) =>
        `| ${item.code} | ${item.scriptPath} | POST ${base}/${item.id}/run.md |`,
    );
    return [
      `## ${label}（新增 ${result.created.length}，跳过 ${result.skipped}）`,
      '',
      ...(result.created.length > 0
        ? ['| 编号 | 脚本 | 运行命令 |', '| --- | --- | --- |', ...rows]
        : ['（无新增）']),
      '',
    ].join('\n');
  }

  /** 未执行导入时的引导响应（HTTP 200）：原因 + 下一步操作指引 */
  private renderGuidance(reason: string, steps: string[]): string {
    return [
      mdFrontmatter({ title: '脚本导入' }),
      '# 脚本未导入',
      '',
      `- 原因：${reason}`,
      '',
      ...steps,
      '',
    ].join('\n');
  }
}
