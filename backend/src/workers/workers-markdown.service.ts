import { Injectable, Logger } from '@nestjs/common';
import {
  WorkerGithubPermission,
  WorkerResourcePermission,
  WorkerRole,
  WorkerRuntime,
} from '../common/enums';
import { mdFrontmatter } from '../common/frontmatter';
import { markdownCell, markdownLabel } from '../common/markdown-table';
import { WorkerEnvironmentService } from './worker-environment.service';
import { McpServersService } from '../mcp-servers/mcp-servers.service';
import {
  CreateWorkerInput,
  UpdateWorkerInput,
  WorkerView,
  WorkersService,
} from './workers.service';

interface InitializationOutcome {
  status: string;
  workdir: string | null;
  error?: string;
}

/**
 * 机器人 Agent 接口的 Markdown 适配层。
 * 复用 WorkersService 的全部业务校验，并在保存成功后按网页相同流程自动启动工位初始化。
 * 单独成服务以避免 WorkersService 与 WorkerEnvironmentService 的循环依赖。
 */
@Injectable()
export class WorkersMarkdownService {
  private readonly logger = new Logger(WorkersMarkdownService.name);

  constructor(
    private readonly workers: WorkersService,
    private readonly environment: WorkerEnvironmentService,
    private readonly mcpServers: McpServersService,
  ) {}

  /** GET /api/workers.md */
  async listMarkdown(filter?: { role?: WorkerRole }): Promise<string> {
    const workers = await this.workers.findAll(filter);
    const lines = [
      mdFrontmatter({ title: '机器人清单' }),
      '# 机器人清单',
      '',
      `共 ${workers.length} 个机器人${filter?.role ? `（角色：${filter.role}）` : ''}。`,
      '',
      '| ID | 名称 | 归属 | 角色 | 运行时 | GitHub 权限 | 资源权限 | 并行上限 | 实时状态 | 启用 | 执行器 | 模型 | 负责人 | 当前任务 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ];
    for (const worker of workers) {
      lines.push(
        `| [${worker.id}](/api/workers/${worker.id}.md) | ${markdownCell(worker.name)} | ${this.workerKind(worker)} | ${worker.role} | ${worker.runtime} | ${this.githubPermissionLabel(worker.githubPermission)} | ${this.resourcePermissionLabel(worker.resourcePermission)} | ${worker.humanUserId ? '不限' : worker.maxParallelTasks} | ${worker.liveStatus} | ${worker.enabled ? '是' : '否'} | ${worker.executorId ?? '-'} | ${markdownCell(worker.modelId)} | ${markdownCell(worker.ownerName)} | ${markdownCell(this.activeTaskLabel(worker))} |`,
      );
    }
    if (workers.length === 0) {
      lines.push(
        '| - | （暂无机器人） | - | - | - | - | - | - | - | - | - | - | - | - |',
      );
    }
    lines.push(
      '',
      '## AI 操作',
      '',
      '```bash',
      'curl -X POST /api/workers/create.md -H \'Content-Type: application/json\' -d \'{"name":"活动开发机器人","intro":"负责活动前端开发","executorId":1,"providerId":"openai","modelId":"gpt-5","prompt":"# 角色定义\\n...","skills":[],"standards":[],"mcps":[1],"enabled":true}\'  # 创建并自动初始化',
      'curl -X POST /api/workers/{id}/update.md -H \'Content-Type: application/json\' -d \'{"intro":"新的简介","prompt":"# 新的角色定义"}\'  # 编辑并自动重新初始化',
      'curl -X POST /api/workers/{id}/delete.md  # 删除（系统/真人/个人 AGENT 或存在未完结任务时拒绝）',
      '```',
      '',
      '系统机器人只能编辑、不能删除；真人机器人与个人 AGENT 不能通过本接口创建，也不能删除。',
      '',
    );
    return lines.join('\n');
  }

  /** GET /api/workers/:id.md */
  async findOneMarkdown(id: number): Promise<string> {
    const worker = await this.workers.findOneView(id);
    const lines = [
      mdFrontmatter({ update: worker.updatedAt, title: worker.name }),
      `# ${worker.name}`,
      '',
      `- ID：${worker.id}`,
      `- 归属：${this.workerKind(worker)}`,
      `- 角色：${worker.role}`,
      `- 运行时：${worker.runtime}`,
      `- GitHub 权限：${this.githubPermissionLabel(worker.githubPermission)}`,
      `- 资源权限：${this.resourcePermissionLabel(worker.resourcePermission)}`,
      `- 并行上限：${worker.humanUserId ? '不限（真人可并行）' : worker.maxParallelTasks}`,
      `- 启用：${worker.enabled ? '是' : '否'}`,
      `- 实时状态：${worker.liveStatus}`,
      `- 当前任务：${this.activeTaskLabel(worker)}`,
      `- 执行器：${worker.executorId ?? '—'}`,
      `- 供应商：${worker.providerId ?? '—'}`,
      `- 模型：${worker.modelId ?? '—'}`,
      `- 思考等级：${worker.variant ?? '—'}`,
      `- 负责人：${worker.ownerName ?? '—'}`,
      `- 绑定用户：${worker.humanUserName ?? '—'}`,
      `- 工位：${worker.workdir ?? '—'}`,
      `- 创建时间：${worker.createdAt.toISOString()}`,
      `- 更新时间：${worker.updatedAt.toISOString()}`,
      '',
      '## 简介',
      '',
      worker.intro?.trim() || '（暂无简介）',
      '',
      '## 机器人定义 AGENTS.md',
      '',
      worker.prompt?.trim() || '（暂无机器人定义）',
    ];
    if (worker.skills && worker.skills.length > 0) {
      lines.push(
        '',
        '## 技能',
        '',
        '| 名称 | 路径 | 版本 |',
        '| --- | --- | --- |',
      );
      for (const skill of worker.skills) {
        lines.push(
          `| ${markdownCell(skill.name)} | ${markdownCell(skill.path)} | ${markdownCell(skill.version)} |`,
        );
      }
    }
    if (worker.standards && worker.standards.length > 0) {
      lines.push(
        '',
        '## 规范',
        '',
        '| 名称 | 目录 | 版本 |',
        '| --- | --- | --- |',
      );
      for (const standard of worker.standards) {
        lines.push(
          `| ${markdownCell(standard.name)} | ${markdownCell(standard.directory)} | ${markdownCell(standard.version)} |`,
        );
      }
    }
    const mcpNames = await this.mcpServers.namesOf(worker.mcps);
    if (mcpNames.length > 0) {
      lines.push(
        '',
        '## MCP 服务',
        '',
        '初始化时与平台 lita-work 一起写入工位 `.opencode/opencode.json`：',
        '',
        ...mcpNames.map((name) => `- ${name}`),
      );
    }
    if (worker.taskDefs && worker.taskDefs.length > 0) {
      lines.push(
        '',
        '## 机器人任务定义',
        '',
        '```json',
        JSON.stringify(worker.taskDefs, null, 2),
        '```',
      );
    }
    lines.push(
      '',
      '## AI 操作',
      '',
      '```bash',
      `curl -X POST /api/workers/${worker.id}/update.md -H 'Content-Type: application/json' -d '{"intro":"新的简介","prompt":"# 新的角色定义"}'  # 编辑并自动重新初始化`,
      `curl -X POST /api/workers/${worker.id}/delete.md  # 删除（系统/真人/个人 AGENT 或存在未完结任务时拒绝）`,
      '```',
      '',
      '编辑时未提交的字段保持不变；`null` 清除可空字段。启用中的 AI 机器人必须配置执行器、供应商与模型。',
      '',
    );
    return lines.join('\n');
  }

  /** POST /api/workers/create.md：落库成功后自动启动异步初始化 */
  async createMarkdown(input: CreateWorkerInput): Promise<string> {
    const worker = await this.workers.create(input);
    const initialization = await this.initialize(worker);
    return this.renderMutationMarkdown('创建', worker, initialization);
  }

  /** POST /api/workers/:id/update.md：落库成功后自动启动异步初始化 */
  async updateMarkdown(id: number, input: UpdateWorkerInput): Promise<string> {
    const worker = await this.workers.update(id, input);
    const initialization = await this.initialize(worker);
    return this.renderMutationMarkdown('更新', worker, initialization);
  }
  /** POST /api/workers/:id/delete.md */
  async removeMarkdown(id: number): Promise<string> {
    const worker = await this.workers.findOneView(id);
    await this.workers.remove(id);
    return [
      mdFrontmatter({ title: worker.name }),
      '# 机器人已删除',
      '',
      `- ID：${worker.id}`,
      `- 名称：${worker.name}`,
      `- 归属：${this.workerKind(worker)}`,
      '',
    ].join('\n');
  }

  /**
   * 与网页保存流程一致：配置先落库，再启动异步初始化。
   * 初始化前置条件不满足时保留配置并在 Markdown 中明确说明，避免 Agent 误以为保存失败后重复创建。
   */
  private async initialize(worker: WorkerView): Promise<InitializationOutcome> {
    if (worker.runtime === WorkerRuntime.HUMAN) {
      return {
        status: '跳过',
        workdir: worker.workdir,
      };
    }
    try {
      const snapshot = await this.environment.start(worker.id);
      return {
        status: snapshot.status,
        workdir: snapshot.workdir ?? worker.workdir,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`机器人 #${worker.id} 保存后初始化未启动: ${message}`);
      return {
        status: '未启动',
        workdir: worker.workdir,
        error: message,
      };
    }
  }

  private async renderMutationMarkdown(
    action: string,
    worker: WorkerView,
    initialization: InitializationOutcome,
  ): Promise<string> {
    const mcpNames = await this.mcpServers.namesOf(worker.mcps);
    const lines = [
      mdFrontmatter({ update: worker.updatedAt, title: worker.name }),
      `# 机器人已${action}`,
      '',
      `- ID：${worker.id}`,
      `- 名称：${worker.name}`,
      `- 归属：${this.workerKind(worker)}`,
      `- 角色：${worker.role}`,
      `- 运行时：${worker.runtime}`,
      `- GitHub 权限：${this.githubPermissionLabel(worker.githubPermission)}`,
      `- 资源权限：${this.resourcePermissionLabel(worker.resourcePermission)}`,
      `- MCP 服务：${mcpNames.length ? mcpNames.join('、') : '仅 lita-work'}`,
      `- 并行上限：${worker.humanUserId ? '不限（真人可并行）' : worker.maxParallelTasks}`,
      `- 启用：${worker.enabled ? '是' : '否'}`,
      `- 执行器：${worker.executorId ?? '—'}`,
      `- 供应商：${worker.providerId ?? '—'}`,
      `- 模型：${worker.modelId ?? '—'}`,
      `- 阅读地址：GET /api/workers/${worker.id}.md`,
      `- 工位初始化：${initialization.status}`,
      `- 工位：${initialization.workdir ?? '—'}`,
    ];
    if (worker.runtime === WorkerRuntime.HUMAN) {
      lines.push('- 说明：真人机器人由绑定用户执行，无需初始化工作环境');
    } else if (initialization.error) {
      lines.push(
        `- 初始化未启动原因：${markdownCell(initialization.error)}`,
        '- 配置已保存成功。修正配置后重新调用 `update.md` 即可重试初始化。',
      );
    } else {
      lines.push(
        '- 初始化在后台异步执行；失败不会回滚已保存配置，重新调用 `update.md` 可重试。',
      );
    }
    lines.push('');
    return lines.join('\n');
  }

  private workerKind(worker: WorkerView): string {
    if (worker.system) return '系统';
    if (worker.humanUserId) return '真人';
    if (worker.personalAgentUserId) return '个人 AGENT';
    return '自定义';
  }

  private githubPermissionLabel(
    permission: WorkerView['githubPermission'],
  ): string {
    if (permission === WorkerGithubPermission.RELEASE) return '发布权限';
    if (permission === WorkerGithubPermission.NONE) return '无权限';
    return '开发权限';
  }

  private resourcePermissionLabel(
    permission: WorkerView['resourcePermission'],
  ): string {
    if (permission === WorkerResourcePermission.WRITE) return '全部资源';
    if (permission === WorkerResourcePermission.READ) return '只读资源';
    return '无权限';
  }

  private activeTaskLabel(worker: WorkerView): string {
    if (!worker.activeTask) return '-';
    const title = markdownLabel(worker.activeTask.title, 40);
    return `[${worker.activeTask.code}](/api/tasks/${worker.activeTask.id}.md) ${title}（${worker.activeTask.status}）`;
  }
}
