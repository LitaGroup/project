import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { renderRunMarkdown } from '../../common/run-markdown';
import { ChecksService } from '../../checks/checks.service';
import { ExportsService } from '../../exports/exports.service';
import { SchedulesService } from '../../schedules/schedules.service';
import { ScriptsImportService } from '../../scripts/scripts-import.service';
import { SettingsService } from '../../settings/settings.service';
import { TestsService } from '../../tests/tests.service';
import { createProgressEmitter } from '../mcp-progress';
import {
  collectRunMarkdown,
  executeTool,
  jsonResult,
  markdownResult,
} from './work-tools.util';
import type { McpWorkPrincipal, WorkToolRegistrar } from './work-tools.types';

/** 运行类工具默认等待上限：30 分钟（平台侧运行不受影响，可 get_run 找回） */
const RUN_WAIT_DEFAULT_SECONDS = 1800;

const RunKindArg = z.enum(['check', 'test', 'export', 'schedule']);
const RunDetailKindArg = z.enum(['check', 'test', 'export']);

/** 运行脚本、查询运行、导入脚本与平台设置 */
@Injectable()
export class WorkRunTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkRunTools.name);

  constructor(
    private readonly checks: ChecksService,
    private readonly tests: TestsService,
    private readonly exports: ExportsService,
    private readonly schedules: SchedulesService,
    private readonly scriptsImport: ScriptsImportService,
    private readonly settings: SettingsService,
  ) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    const timeoutArg = z
      .number()
      .int()
      .min(10)
      .max(1800)
      .optional()
      .describe(
        `等待终态的秒数（10-1800，默认 ${RUN_WAIT_DEFAULT_SECONDS}）；超时只结束等待，运行在平台继续`,
      );

    server.registerTool(
      'run_check',
      {
        title: '运行检查',
        description:
          '启动一次检查脚本运行，执行输出经 progress 实时推送，终态返回完整运行 Markdown。长期运行不受等待超时影响，可稍后用 get_run 查询。',
        inputSchema: {
          checkId: z.number().int().positive().describe('检查 ID'),
          timeout_seconds: timeoutArg,
        },
      },
      async (args, extra) =>
        executeTool(this.logger, 'run_check', principal, async () => {
          const check = await this.checks.findOne(args.checkId);
          const run = await this.checks.startRun(args.checkId);
          const text = await collectRunMarkdown({
            title: `运行检查 \`${check.code}\``,
            metaLines: [
              `- 运行 ID：${run.id}`,
              `- 脚本：${check.scriptPath}`,
              `- 详情：/api/checks/runs/${run.id}`,
            ],
            stream: this.checks.streamRun(run.id),
            initial: run,
            notify: createProgressEmitter(extra),
            signal: extra.signal,
            timeoutMs: this.timeoutMsOf(args.timeout_seconds),
          });
          return markdownResult(text);
        }),
    );

    server.registerTool(
      'run_test',
      {
        title: '运行用例',
        description:
          '启动一次用例（测试）脚本运行，执行输出经 progress 实时推送，终态返回完整运行 Markdown。',
        inputSchema: {
          testId: z.number().int().positive().describe('用例 ID'),
          appVersionId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('指定 APP 版本（仅 APP 端用例需要）'),
          timeout_seconds: timeoutArg,
        },
      },
      async (args, extra) =>
        executeTool(this.logger, 'run_test', principal, async () => {
          const test = await this.tests.findOne(args.testId);
          const run = await this.tests.startRun(args.testId, args.appVersionId);
          const text = await collectRunMarkdown({
            title: `运行测试 \`${test.code}\``,
            metaLines: [
              `- 运行 ID：${run.id}`,
              `- 脚本：${test.scriptPath}`,
              `- 状态：${run.status}`,
              `- 详情：/api/tests/runs/${run.id}`,
            ],
            stream: this.tests.streamRun(run.id),
            initial: run,
            notify: createProgressEmitter(extra),
            signal: extra.signal,
            timeoutMs: this.timeoutMsOf(args.timeout_seconds),
          });
          return markdownResult(text);
        }),
    );

    server.registerTool(
      'run_export',
      {
        title: '运行导出',
        description:
          '启动一次导出脚本运行，终态返回运行 Markdown（含产物文件下载链接）。',
        inputSchema: {
          exportId: z.number().int().positive().describe('导出 ID'),
          timeout_seconds: timeoutArg,
        },
      },
      async (args, extra) =>
        executeTool(this.logger, 'run_export', principal, async () => {
          const exportItem = await this.exports.findOne(args.exportId);
          const run = await this.exports.startRun(args.exportId);
          const text = await collectRunMarkdown({
            title: `运行导出 \`${exportItem.code}\``,
            metaLines: [
              `- 运行 ID：${run.id}`,
              `- 脚本：${exportItem.scriptPath}`,
              `- 详情：/api/exports/runs/${run.id}`,
            ],
            stream: this.exports.streamRun(run.id),
            initial: run,
            notify: createProgressEmitter(extra),
            signal: extra.signal,
            timeoutMs: this.timeoutMsOf(args.timeout_seconds),
            extraLinesOf: (latest) =>
              this.exportFileLines(
                latest as unknown as {
                  exportId: number;
                  id: number;
                  files: { title?: string | null; file: string }[] | null;
                },
              ),
          });
          return markdownResult(text);
        }),
    );

    server.registerTool(
      'run_schedule',
      {
        title: '触发定时任务',
        description:
          '手动触发一次定时任务（不受启用状态限制），执行输出经 progress 实时推送，终态返回运行 Markdown。',
        inputSchema: {
          scheduleId: z.number().int().positive().describe('定时任务 ID'),
          timeout_seconds: timeoutArg,
        },
      },
      async (args, extra) =>
        executeTool(this.logger, 'run_schedule', principal, async () => {
          const schedule = await this.schedules.findOne(args.scheduleId);
          const run = await this.schedules.runNow(args.scheduleId);
          const text = await collectRunMarkdown({
            title: `运行定时任务 \`${schedule.title}\``,
            metaLines: [
              `- 运行 ID：${run.id}`,
              `- 触发方式：手动`,
              `- 详情：/api/checks/runs/${run.id}.md`,
            ],
            stream: this.schedules.streamRun(run.id),
            initial: run,
            notify: createProgressEmitter(extra),
            signal: extra.signal,
            timeoutMs: this.timeoutMsOf(args.timeout_seconds),
          });
          return markdownResult(text);
        }),
    );

    server.registerTool(
      'get_run',
      {
        title: '查询运行详情',
        description:
          '读取一次运行的状态、进度、结果与输出（导出运行含产物下载链接）。kind 与 runId 取自项目详情或运行列表。',
        inputSchema: {
          kind: RunDetailKindArg.describe('运行类型：check/test/export'),
          runId: z.number().int().positive().describe('运行 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'get_run', principal, async () => {
          if (args.kind === 'check') {
            const run = await this.checks.findRun(args.runId);
            const check = await this.checks
              .findOne(run.checkId)
              .catch(() => null);
            return markdownResult(
              renderRunMarkdown(
                `检查运行 #${run.id}`,
                [
                  ...(check
                    ? [`- 检查：\`${check.code}\`（脚本：${check.scriptPath}）`]
                    : [`- 检查：#${run.checkId}（已删除）`]),
                  `- 详情（JSON）：/api/checks/runs/${run.id}`,
                ],
                run,
              ),
            );
          }
          if (args.kind === 'test') {
            const run = await this.tests.findRun(args.runId);
            const test = await this.tests.findOne(run.testId).catch(() => null);
            return markdownResult(
              renderRunMarkdown(
                `测试运行 #${run.id}`,
                [
                  ...(test
                    ? [`- 测试：\`${test.code}\`（脚本：${test.scriptPath}）`]
                    : [`- 测试：#${run.testId}（已删除）`]),
                  `- 详情（JSON）：/api/tests/runs/${run.id}`,
                ],
                run,
              ),
            );
          }
          const run = await this.exports.findRun(args.runId);
          const exportItem = await this.exports
            .findOne(run.exportId)
            .catch(() => null);
          return markdownResult(
            renderRunMarkdown(
              `导出运行 #${run.id}`,
              [
                ...(exportItem
                  ? [
                      `- 导出：\`${exportItem.code}\`（脚本：${exportItem.scriptPath}）`,
                    ]
                  : [`- 导出：#${run.exportId}（已删除）`]),
                `- 详情（JSON）：/api/exports/runs/${run.id}`,
                ...this.exportFileLines(run),
              ],
              run,
            ),
          );
        }),
    );

    server.registerTool(
      'list_runs',
      {
        title: '运行历史',
        description:
          '列出某个检查/用例/导出/定时任务的运行历史（倒序，上限 50）。',
        inputSchema: {
          kind: RunKindArg.describe('任务类型：check/test/export/schedule'),
          targetId: z
            .number()
            .int()
            .positive()
            .describe('检查/用例/导出/定时任务的 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_runs', principal, async () => {
          const runs =
            args.kind === 'check'
              ? await this.checks.listRuns(args.targetId)
              : args.kind === 'test'
                ? await this.tests.listRuns(args.targetId)
                : args.kind === 'export'
                  ? await this.exports.listRuns(args.targetId)
                  : await this.schedules.listRuns(args.targetId);
          return jsonResult(runs);
        }),
    );

    server.registerTool(
      'import_scripts',
      {
        title: '同步脚本到项目',
        description:
          '扫描项目脚本目录下未登记的 .check.ts / .test.ts / .export.ts，一次导入为检查/用例/导出。项目须已配置脚本目录。',
        inputSchema: {
          projectId: z.number().int().positive().describe('项目 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'import_scripts', principal, async () =>
          markdownResult(
            await this.scriptsImport.importMarkdown(args.projectId),
          ),
        ),
    );

    server.registerTool(
      'get_settings',
      {
        title: '平台设置',
        description:
          '读取平台设置：运行环境、脚本/图片目录、访问域名、飞书 token 来源、GitHub 与 appium-agent 状态。',
        inputSchema: {},
      },
      () =>
        executeTool(this.logger, 'get_settings', principal, () =>
          markdownResult(this.settings.renderMarkdown()),
        ),
    );

    server.registerTool(
      'pull_scripts',
      {
        title: '更新脚本仓库',
        description:
          '在脚本根目录更新脚本仓库（git 拉取），git 输出经 progress 实时推送，终态返回结果 Markdown。',
        inputSchema: {},
      },
      async (_args, extra) =>
        executeTool(this.logger, 'pull_scripts', principal, async () => {
          const notify = createProgressEmitter(extra);
          const output: string[] = [];
          let status: 'success' | 'error' = 'success';
          let message = '脚本仓库已更新';
          try {
            await this.settings.spawnPull((line) => {
              output.push(line);
              if (notify) void notify(output.length, line).catch(() => {});
            });
          } catch (error) {
            status = 'error';
            message = error instanceof Error ? error.message : String(error);
          }
          return markdownResult(
            [
              '# 更新脚本仓库',
              '',
              `- 脚本根目录：\`${this.settings.getSettings().scriptsDir}\``,
              '',
              '## 输出',
              '',
              ...(output.length > 0 ? output : ['（无输出）']),
              '',
              '## 结果',
              '',
              `- 状态：${status}`,
              `- 消息：${message}`,
              '',
            ].join('\n'),
          );
        }),
    );
  }

  private timeoutMsOf(seconds: number | undefined): number {
    const value = seconds && seconds > 0 ? seconds : RUN_WAIT_DEFAULT_SECONDS;
    return Math.min(Math.max(value, 10), 1800) * 1000;
  }

  private exportFileLines(run: {
    exportId: number;
    id: number;
    files: { title?: string | null; file: string }[] | null;
  }): string[] {
    const files = run.files ?? [];
    if (files.length === 0) return [];
    return [
      '- 产物文件（点击下载）：',
      ...files.map(
        (f) =>
          `  - [${f.title || f.file}](/export-files/${run.exportId}/${run.id}/${f.file})`,
      ),
    ];
  }
}
