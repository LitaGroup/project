import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Worker } from '../workers/worker.entity';
import { WorkersService } from '../workers/workers.service';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { Task } from '../tasks/task.entity';
import { TicketDocument, TicketDocumentFormat } from './ticket-document.entity';
import { TicketWorkflowRun } from './ticket-workflow-run.entity';
import { Ticket } from './ticket.entity';

/** 交付文档入参：url 与 content 最多提供一个；更新时都不提供表示只改标题 */
export interface TicketDocumentInput {
  title?: string | null;
  url?: string | null;
  content?: string | null;
}

interface TicketDocumentPayload {
  url: string | null;
  content: string | null;
}

export interface TicketDocumentContext {
  task: Task;
  ticket: Ticket;
  document: TicketDocument;
}

export interface TaskTicketDocuments {
  task: Task;
  ticket: Ticket;
  documents: TicketDocument[];
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

function escapeLinkText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[[\]]/g, '\\$&');
}

function formatLabel(format: TicketDocumentFormat): string {
  return format === 'link' ? '链接' : '正文';
}

/**
 * 工单交付文档：
 * - 任务机器人显式交付，不随任务验收自动发生；
 * - 链接形态保存引用，正文形态保存独立 Markdown 副本；
 * - 仅来源任务的当前执行机器人可以更新、删除自己交付的文档；
 * - 同时兼容历史工单（tickets.taskId）与工作流节点任务（ticket_workflow_runs.taskId）。
 */
@Injectable()
export class TicketDocumentsService {
  private readonly apiUrl: string;

  constructor(
    @InjectRepository(TicketDocument)
    private readonly documents: Repository<TicketDocument>,
    @InjectRepository(Ticket)
    private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketWorkflowRun)
    private readonly runs: Repository<TicketWorkflowRun>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    private readonly workers: WorkersService,
    config: ConfigService,
  ) {
    this.apiUrl = (
      config.get<string>('API_URL') ?? 'http://localhost:3100/api'
    ).replace(/\/+$/, '');
  }

  /** 查找任务所属工单：优先历史工单直连，其次工作流节点运行记录 */
  async findTicketForTask(task: Task): Promise<Ticket | null> {
    const direct = await this.tickets.findOne({ where: { taskId: task.id } });
    if (direct) return direct;
    const run = await this.runs.findOne({
      where: { taskId: task.id },
      order: { id: 'DESC' },
    });
    if (!run) return null;
    return this.tickets.findOne({ where: { id: run.ticketId } });
  }

  async resolveTicketForTask(task: Task): Promise<Ticket> {
    const ticket = await this.findTicketForTask(task);
    if (!ticket) {
      throw new NotFoundException(`任务 ${task.code} 未关联工单`);
    }
    return ticket;
  }

  async listMarkdown(taskId: number): Promise<string> {
    const { task, ticket, documents } = await this.listForTask(taskId);
    return this.renderTaskDocumentsMarkdown(task, ticket, documents);
  }

  async readMarkdown(taskId: number, documentId: number): Promise<string> {
    const { task, ticket, document } = await this.mustFindDocument(
      taskId,
      documentId,
    );
    return this.renderDocumentMarkdown(task, ticket, document);
  }

  async createMarkdown(
    taskId: number,
    worker: Worker,
    input: TicketDocumentInput,
  ): Promise<string> {
    const task = await this.mustFindTask(taskId);
    const actor = await this.resolveActor(worker);
    this.assertTaskExecutor(task, actor);
    const ticket = await this.resolveTicketForTask(task);
    const title = this.normalizeTitle(input.title, true);
    const payload = this.resolvePayload(input, true);
    const document = await this.documents.save(
      this.documents.create({
        ticketId: ticket.id,
        sourceTaskId: task.id,
        sourceTaskCode: task.code,
        title,
        format: payload.url ? 'link' : 'content',
        url: payload.url,
        content: payload.content,
        createdByWorkerId: actor.id,
        createdByName: actor.name,
        updatedByName: actor.name,
      }),
    );
    return this.renderCreatedMarkdown(task, ticket, document);
  }

  async updateMarkdown(
    taskId: number,
    documentId: number,
    worker: Worker,
    input: TicketDocumentInput,
  ): Promise<string> {
    const task = await this.mustFindTask(taskId);
    const actor = await this.resolveActor(worker);
    this.assertTaskExecutor(task, actor);
    const ticket = await this.resolveTicketForTask(task);
    const document = await this.findOwnedDocument(
      ticket.id,
      task.id,
      documentId,
    );
    const title = this.normalizeTitle(input.title, false);
    const payload = this.resolvePayload(input, false);
    if (title === null && payload === null) {
      throw new BadRequestException('请至少提供 title、url 或 content 之一');
    }
    if (title !== null) document.title = title;
    if (payload !== null) {
      document.format = payload.url ? 'link' : 'content';
      document.url = payload.url;
      document.content = payload.content;
    }
    document.updatedByName = actor.name;
    const saved = await this.documents.save(document);
    return this.renderUpdatedMarkdown(task, ticket, saved);
  }

  async deleteMarkdown(
    taskId: number,
    documentId: number,
    worker: Worker,
  ): Promise<string> {
    const task = await this.mustFindTask(taskId);
    const actor = await this.resolveActor(worker);
    this.assertTaskExecutor(task, actor);
    const ticket = await this.resolveTicketForTask(task);
    const document = await this.findOwnedDocument(
      ticket.id,
      task.id,
      documentId,
    );
    await this.documents.delete({ id: document.id, ticketId: ticket.id });
    return this.renderDeletedMarkdown(task, ticket, document);
  }

  /** 嵌入工单 Markdown：列出工单全部交付文档，正文形态内联全文 */
  async renderTicketSection(ticket: Ticket): Promise<string> {
    const documents = await this.documents.find({
      where: { ticketId: ticket.id },
      order: { id: 'ASC' },
    });
    const lines = ['## 交付文档', ''];
    if (documents.length === 0) {
      lines.push('（暂无交付文档）', '');
      return lines.join('\n');
    }
    lines.push(
      '| ID | 标题 | 形式 | 来源任务 | 更新时间 |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const document of documents) {
      lines.push(
        `| ${document.id} | ${escapeCell(document.title)} | ${formatLabel(
          document.format,
        )} | ${document.sourceTaskCode} | ${beijingTime(document.updatedAt)} |`,
      );
    }
    lines.push('');

    const links = documents.filter((document) => document.format === 'link');
    if (links.length) {
      lines.push('### 交付文档链接', '');
      for (const document of links) {
        lines.push(
          `- [${escapeLinkText(document.title)}](<${document.url ?? ''}>)` +
            `（来源任务 ${document.sourceTaskCode}，更新于 ${beijingTime(document.updatedAt)}）`,
        );
      }
      lines.push('');
    }

    const contents = documents.filter(
      (document) => document.format === 'content',
    );
    if (contents.length) {
      lines.push('### 交付文档正文', '');
      for (const document of contents) {
        lines.push(
          `#### ${document.id}. ${document.title}`,
          '',
          `- 来源任务：${document.sourceTaskCode}`,
          `- 交付机器人：${document.createdByName}`,
          `- 更新时间：${beijingTime(document.updatedAt)}`,
          '',
          document.content ?? '',
          '',
        );
      }
    }
    return lines.join('\n');
  }

  /** 读取工单文档清单（JSON 后续接网页时可复用） */
  async listForTask(taskId: number): Promise<TaskTicketDocuments> {
    const task = await this.mustFindTask(taskId);
    const ticket = await this.resolveTicketForTask(task);
    const documents = await this.documents.find({
      where: { ticketId: ticket.id },
      order: { id: 'ASC' },
    });
    return { task, ticket, documents };
  }

  private async mustFindTask(taskId: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('任务不存在');
    return task;
  }

  private async mustFindDocument(
    taskId: number,
    documentId: number,
  ): Promise<TicketDocumentContext> {
    const task = await this.mustFindTask(taskId);
    const ticket = await this.resolveTicketForTask(task);
    const document = await this.documents.findOne({
      where: { id: documentId, ticketId: ticket.id },
    });
    if (!document) throw new NotFoundException('工单文档不存在');
    return { task, ticket, document };
  }

  private async findOwnedDocument(
    ticketId: number,
    taskId: number,
    documentId: number,
  ): Promise<TicketDocument> {
    const document = await this.documents.findOne({
      where: { id: documentId, ticketId },
    });
    if (!document) throw new NotFoundException('工单文档不存在');
    if (document.sourceTaskId !== taskId) {
      throw new ForbiddenException('只能维护本任务交付的工单文档');
    }
    return document;
  }

  /** 个人 AGENT 按主人的真人机器人身份执行，与任务文档接口保持一致 */
  private async resolveActor(worker: Worker): Promise<Worker> {
    if (!worker.personalAgentUserId) return worker;
    const human = await this.workers.findByHumanUserId(
      worker.personalAgentUserId,
    );
    if (!human) {
      throw new ForbiddenException('个人 AGENT 未绑定真人机器人');
    }
    return human;
  }

  private assertTaskExecutor(task: Task, worker: Worker): void {
    if (!worker?.id || task.agentId !== worker.id) {
      throw new ForbiddenException(
        '仅任务当前执行机器人可以交付或维护工单文档',
      );
    }
  }

  private normalizeTitle(
    raw: string | null | undefined,
    required: true,
  ): string;
  private normalizeTitle(
    raw: string | null | undefined,
    required: false,
  ): string | null;
  private normalizeTitle(
    raw: string | null | undefined,
    required: boolean,
  ): string | null {
    if (raw === undefined) {
      if (required) throw new BadRequestException('文档标题不能为空');
      return null;
    }
    if (raw !== null && typeof raw !== 'string') {
      throw new BadRequestException('文档标题必须是字符串');
    }
    const title = raw?.trim() ?? '';
    if (!title) {
      if (required) throw new BadRequestException('文档标题不能为空');
      throw new BadRequestException('文档标题不能为空字符串');
    }
    if (title.length > 200) {
      throw new BadRequestException('文档标题不能超过 200 字');
    }
    return title;
  }

  private resolvePayload(
    input: TicketDocumentInput,
    required: true,
  ): TicketDocumentPayload;
  private resolvePayload(
    input: TicketDocumentInput,
    required: false,
  ): TicketDocumentPayload | null;
  private resolvePayload(
    input: TicketDocumentInput,
    required: boolean,
  ): TicketDocumentPayload | null {
    const hasUrlField = Object.prototype.hasOwnProperty.call(input, 'url');
    const hasContentField = Object.prototype.hasOwnProperty.call(
      input,
      'content',
    );
    if (hasUrlField && input.url != null && typeof input.url !== 'string') {
      throw new BadRequestException('url 必须是字符串');
    }
    if (
      hasContentField &&
      input.content != null &&
      typeof input.content !== 'string'
    ) {
      throw new BadRequestException('content 必须是字符串');
    }
    const url = typeof input.url === 'string' ? input.url.trim() : '';
    const content =
      typeof input.content === 'string' ? input.content.trim() : '';
    const hasUrl = Boolean(url);
    const hasContent = Boolean(content);
    if (hasUrl && hasContent) {
      throw new BadRequestException('url 与 content 只能提供一个');
    }
    if (!hasUrl && !hasContent) {
      if (required || hasUrlField || hasContentField) {
        throw new BadRequestException('url 与 content 必须提供一个');
      }
      return null;
    }
    if (hasUrl) {
      return { url: this.normalizeUrl(url), content: null };
    }
    return { url: null, content };
  }

  private normalizeUrl(raw: string): string {
    const url = raw.trim();
    if (!url || /[\s<>"]/.test(url)) {
      throw new BadRequestException('文档链接格式不正确');
    }
    if (url.startsWith('/')) {
      if (url.startsWith('//')) {
        throw new BadRequestException(
          '文档链接必须是 http(s) 地址或站内绝对路径',
        );
      }
      return url;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('unsupported protocol');
      }
      return url;
    } catch {
      throw new BadRequestException(
        '文档链接必须是 http(s) 地址或站内绝对路径',
      );
    }
  }

  private renderTaskDocumentsMarkdown(
    task: Task,
    ticket: Ticket,
    documents: TicketDocument[],
  ): string {
    const lines = [
      mdFrontmatter({
        title: `工单 ${ticket.code} 交付文档`,
        description: ticket.title,
        update: new Date(),
      }),
      `# ${ticket.code} ${ticket.title} · 工单交付文档`,
      '',
      `- 当前任务：${task.code}（${task.title}）`,
      `- 所属工单：${ticket.code}（${ticket.category}）`,
      `- 任务自身文档清单：\`GET /api/tasks/${task.id}/documents.md\``,
      '',
      '## 已有交付文档',
      '',
    ];
    if (documents.length === 0) {
      lines.push('（暂无交付文档）', '');
    } else {
      lines.push(
        '| ID | 标题 | 形式 | 来源任务 | 更新时间 |',
        '| --- | --- | --- | --- | --- |',
      );
      for (const document of documents) {
        lines.push(
          `| ${document.id} | ${escapeCell(document.title)} | ${formatLabel(
            document.format,
          )} | ${document.sourceTaskCode} | ${beijingTime(document.updatedAt)} |`,
        );
      }
      lines.push('', '### 文档地址', '');
      for (const document of documents) {
        if (document.format === 'link') {
          lines.push(
            `- ${document.id}. [${escapeLinkText(document.title)}](<${document.url ?? ''}>)`,
          );
        } else {
          lines.push(
            `- ${document.id}. ${document.title}：\`/api/tasks/${task.id}/ticket-documents/${document.id}.md\``,
          );
        }
      }
      lines.push('');
    }
    lines.push(
      '## 交付文档',
      '',
      '文档由任务当前执行机器人显式交付；link 保存引用，content 保存独立正文副本，两者只能提供一个。',
      '更新或删除仅允许该文档的来源任务当前执行机器人操作。',
      '',
      '```bash',
      'TOKEN=$(cat .opencode/agent-token)',
      '',
      '# 交付链接（链接来自任务文档清单或其它可访问地址）',
      `curl -sS -X POST '${this.apiUrl}/tasks/${task.id}/ticket-documents.md' \\`,
      '  -H "X-Worker-Token: $TOKEN" \\',
      '  -H "Content-Type: application/json" \\',
      `  -d '{"title":"接口文档","url":"/api/docs/detail/task/{yyyyMMdd}/${task.code}/API.md"}'`,
      '',
      '# 交付正文（独立副本，不随源任务文档变化）',
      `curl -sS -X POST '${this.apiUrl}/tasks/${task.id}/ticket-documents.md' \\`,
      '  -H "X-Worker-Token: $TOKEN" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d \'{"title":"交付说明","content":"# 交付说明\\n\\n..."}\'',
      '',
      '# 更新标题、链接或正文（url/content 只传要切换或修改的一项）',
      `curl -sS -X POST '${this.apiUrl}/tasks/${task.id}/ticket-documents/{documentId}/update.md' \\`,
      '  -H "X-Worker-Token: $TOKEN" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d \'{"title":"更新后的标题","content":"# 新正文"}\'',
      '',
      '# 删除',
      `curl -sS -X POST '${this.apiUrl}/tasks/${task.id}/ticket-documents/{documentId}/delete.md' \\`,
      '  -H "X-Worker-Token: $TOKEN" \\',
      '  -H "Content-Type: application/json" \\',
      "  -d '{}'",
      '```',
      '',
      '> 链接形态不会复制源文档内容，源文档后续变化会通过链接体现；正文形态保存交付时的独立副本。',
      '',
    );
    return lines.join('\n');
  }

  private renderDocumentMarkdown(
    task: Task,
    ticket: Ticket,
    document: TicketDocument,
  ): string {
    const lines = [
      mdFrontmatter({
        title: document.title,
        update: document.updatedAt,
        ticket: ticket.code,
        task: document.sourceTaskCode,
      }),
      `# ${document.title}`,
      '',
      `- 工单：${ticket.code} ${ticket.title}`,
      `- 形式：${formatLabel(document.format)}`,
      `- 来源任务：${document.sourceTaskCode}`,
      `- 交付机器人：${document.createdByName}`,
      `- 更新时间：${beijingTime(document.updatedAt)}`,
      `- 更新人：${document.updatedByName ?? document.createdByName}`,
      '',
    ];
    if (document.format === 'link') {
      lines.push(
        '## 文档链接',
        '',
        `[${escapeLinkText(document.title)}](<${document.url ?? ''}>)`,
        '',
        `> 链接为引用，不会复制源文档正文。当前任务读取地址：\`GET /api/tasks/${task.id}/ticket-documents.md\``,
        '',
      );
    } else {
      lines.push(
        '## 文档正文',
        '',
        document.content ?? '',
        '',
        `> 正文为交付时的独立副本，不随任务文档自动更新。当前任务读取地址：\`GET /api/tasks/${task.id}/ticket-documents.md\``,
        '',
      );
    }
    return lines.join('\n');
  }

  private renderCreatedMarkdown(
    task: Task,
    ticket: Ticket,
    document: TicketDocument,
  ): string {
    return [
      mdFrontmatter({
        title: '工单文档已交付',
        update: new Date(),
      }),
      '# 工单文档已交付',
      '',
      `- 文档 ID：${document.id}`,
      `- 工单：${ticket.code} ${ticket.title}`,
      `- 标题：${document.title}`,
      `- 形式：${formatLabel(document.format)}`,
      document.format === 'link'
        ? `- 链接：<${document.url ?? ''}>`
        : `- 阅读地址：\`/api/tasks/${task.id}/ticket-documents/${document.id}.md\``,
      `- 来源任务：${document.sourceTaskCode}`,
      `- 更新时间：${beijingTime(document.updatedAt)}`,
      '',
      '> 后续可使用 update.md 修改，或使用 delete.md 删除。',
      '',
    ].join('\n');
  }

  private renderUpdatedMarkdown(
    task: Task,
    ticket: Ticket,
    document: TicketDocument,
  ): string {
    return [
      mdFrontmatter({
        title: '工单文档已更新',
        update: new Date(),
      }),
      '# 工单文档已更新',
      '',
      `- 文档 ID：${document.id}`,
      `- 工单：${ticket.code} ${ticket.title}`,
      `- 标题：${document.title}`,
      `- 形式：${formatLabel(document.format)}`,
      document.format === 'link'
        ? `- 链接：<${document.url ?? ''}>`
        : `- 阅读地址：\`/api/tasks/${task.id}/ticket-documents/${document.id}.md\``,
      `- 更新时间：${beijingTime(document.updatedAt)}`,
      '',
    ].join('\n');
  }

  private renderDeletedMarkdown(
    task: Task,
    ticket: Ticket,
    document: TicketDocument,
  ): string {
    return [
      mdFrontmatter({
        title: '工单文档已删除',
        update: new Date(),
      }),
      '# 工单文档已删除',
      '',
      `- 文档 ID：${document.id}`,
      `- 工单：${ticket.code} ${ticket.title}`,
      `- 标题：${document.title}`,
      `- 来源任务：${document.sourceTaskCode}`,
      `- 操作任务：${task.code}`,
      '',
    ].join('\n');
  }
}
