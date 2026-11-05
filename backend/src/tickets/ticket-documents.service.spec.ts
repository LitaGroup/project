import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TaskStatus, TaskSubStatus, WorkerRole } from '../common/enums';
import { Task } from '../tasks/task.entity';
import { TicketDocument } from './ticket-document.entity';
import { TicketDocumentsService } from './ticket-documents.service';
import { Ticket } from './ticket.entity';

describe('TicketDocumentsService 工单交付文档', () => {
  const task = (over: Partial<Task> = {}): Task =>
    ({
      id: 101,
      code: 'TK-0101',
      title: '处理工单',
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 1001,
      ...over,
    }) as Task;

  const ticket = (over: Partial<Ticket> = {}): Ticket =>
    ({
      id: 1,
      code: 'WO-0001',
      title: '测试工单',
      category: '技术工单',
      description: '测试工单描述',
      taskId: 101,
      workflowDefinitionId: null,
      workflowStatus: null,
      currentNodeKey: null,
      currentNodeName: null,
      assigneeId: 1001,
      assigneeName: '机器人1001',
      createdById: 7,
      createdByName: '张三',
      createdAt: new Date('2026-11-05T09:00:00+08:00'),
      updatedAt: new Date('2026-11-05T09:00:00+08:00'),
      ...over,
    }) as Ticket;

  const worker = (over: Partial<Record<string, unknown>> = {}) =>
    ({
      id: 1001,
      name: '机器人1001',
      role: WorkerRole.WORKER,
      enabled: true,
      ...over,
    }) as never;

  let currentTask: Task;
  let currentTicket: Ticket | null;
  let workflowTicket: Ticket | null;
  let rows: TicketDocument[];
  let documents: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  let tickets: { findOne: jest.Mock };
  let runs: { findOne: jest.Mock };
  let tasks: { findOne: jest.Mock };
  let workersService: { findByHumanUserId: jest.Mock };
  let service: TicketDocumentsService;

  const matches = (
    row: Record<string, unknown>,
    where: Record<string, unknown>,
  ): boolean =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  beforeEach(() => {
    currentTask = task();
    currentTicket = ticket();
    workflowTicket = null;
    rows = [];
    tasks = {
      findOne: jest.fn(() => Promise.resolve(currentTask)),
    };
    tickets = {
      findOne: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        if (
          currentTicket &&
          matches(currentTicket as unknown as Record<string, unknown>, where)
        ) {
          return Promise.resolve(currentTicket);
        }
        if (
          workflowTicket &&
          matches(workflowTicket as unknown as Record<string, unknown>, where)
        ) {
          return Promise.resolve(workflowTicket);
        }
        return Promise.resolve(null);
      }),
    };
    runs = { findOne: jest.fn().mockResolvedValue(null) };
    workersService = {
      findByHumanUserId: jest.fn().mockResolvedValue(worker()),
    };
    documents = {
      find: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          rows
            .filter((row) => matches(row as never, where))
            .sort((a, b) => a.id - b.id),
        ),
      ),
      findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          rows.find((row) => matches(row as never, where)) ?? null,
        ),
      ),
      save: jest.fn((row: TicketDocument) => {
        const saved = {
          ...row,
          id: row.id || rows.length + 1,
          createdAt: row.createdAt ?? new Date('2026-11-05T10:00:00+08:00'),
          updatedAt: new Date('2026-11-05T10:00:00+08:00'),
        };
        rows = [...rows.filter((item) => item.id !== saved.id), saved];
        return Promise.resolve(saved);
      }),
      create: jest.fn((row: Partial<TicketDocument>) => row),
      delete: jest.fn(({ id }: { id: number }) => {
        rows = rows.filter((row) => row.id !== id);
        return Promise.resolve({ affected: 1 });
      }),
    };
    service = new TicketDocumentsService(
      documents as never,
      tickets as never,
      runs as never,
      tasks as never,
      workersService as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
    );
  });

  it('历史工单任务可交付链接文档', async () => {
    const markdown = await service.createMarkdown(101, worker(), {
      title: '接口文档',
      url: '/api/docs/detail/task/20261105/TK-0101/API.md',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ticketId: 1,
      sourceTaskId: 101,
      sourceTaskCode: 'TK-0101',
      title: '接口文档',
      format: 'link',
      url: '/api/docs/detail/task/20261105/TK-0101/API.md',
      content: null,
    });
    expect(markdown).toContain('# 工单文档已交付');
    expect(markdown).toContain('形式：链接');
  });

  it('工作流节点任务通过运行记录关联工单并交付正文', async () => {
    currentTicket = ticket({
      id: 2,
      taskId: null,
      workflowDefinitionId: 3,
      workflowStatus: '处理中',
    });
    workflowTicket = currentTicket;
    runs.findOne.mockResolvedValue({ id: 9, ticketId: 2, taskId: 101 });

    await service.createMarkdown(101, worker(), {
      title: '节点说明',
      content: '# 节点说明\n\n已完成配置',
    });

    expect(runs.findOne).toHaveBeenCalledWith({
      where: { taskId: 101 },
      order: { id: 'DESC' },
    });
    expect(rows[0]).toMatchObject({
      ticketId: 2,
      format: 'content',
      content: '# 节点说明\n\n已完成配置',
      url: null,
    });
  });

  it('url 与 content 必须且只能提供一个', async () => {
    await expect(
      service.createMarkdown(101, worker(), {
        title: '错误文档',
        url: '/api/docs/detail/a.md',
        content: '# 正文',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.createMarkdown(101, worker(), { title: '空文档' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('拒绝非当前执行机器人交付', async () => {
    await expect(
      service.createMarkdown(101, worker({ id: 2001 }), {
        title: '正文',
        content: '# 正文',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('个人 AGENT 映射为主人的真人机器人后交付', async () => {
    const personalAgent = worker({ id: 2001, personalAgentUserId: 7 });
    workersService.findByHumanUserId.mockResolvedValue(worker());

    await service.createMarkdown(101, personalAgent, {
      title: '正文',
      content: '# 正文',
    });

    expect(workersService.findByHumanUserId).toHaveBeenCalledWith(7);
    expect(rows[0]).toMatchObject({
      createdByWorkerId: 1001,
      createdByName: '机器人1001',
    });
  });

  it('只允许 http(s) 链接或站内绝对路径', async () => {
    await expect(
      service.createMarkdown(101, worker(), {
        title: '危险链接',
        url: 'javascript:alert(1)',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createMarkdown(101, worker(), {
        title: '协议相对链接',
        url: '//evil.example.com/doc',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('更新支持切换链接与正文并清空另一种形态', async () => {
    await service.createMarkdown(101, worker(), {
      title: '交付说明',
      content: '# 旧正文',
    });

    const markdown = await service.updateMarkdown(101, 1, worker(), {
      title: '交付链接',
      url: 'https://example.com/doc',
    });

    expect(rows[0]).toMatchObject({
      title: '交付链接',
      format: 'link',
      url: 'https://example.com/doc',
      content: null,
      updatedByName: '机器人1001',
    });
    expect(markdown).toContain('# 工单文档已更新');
    expect(markdown).toContain('形式：链接');
  });

  it('只更新标题时保留原正文', async () => {
    await service.createMarkdown(101, worker(), {
      title: '旧标题',
      content: '# 正文',
    });

    await service.updateMarkdown(101, 1, worker(), { title: '新标题' });

    expect(rows[0]).toMatchObject({
      title: '新标题',
      format: 'content',
      content: '# 正文',
    });
  });

  it('禁止更新或删除其它来源任务的文档', async () => {
    rows.push({
      id: 1,
      ticketId: 1,
      sourceTaskId: 999,
      sourceTaskCode: 'TK-0999',
      title: '其它任务文档',
      format: 'content',
      url: null,
      content: '# 正文',
      createdByWorkerId: 1001,
      createdByName: '机器人1001',
      updatedByName: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.updateMarkdown(101, 1, worker(), { title: '改名' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.deleteMarkdown(101, 1, worker()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('删除后工单上下文不再出现该文档', async () => {
    await service.createMarkdown(101, worker(), {
      title: '待删除',
      content: '# 正文',
    });

    const markdown = await service.deleteMarkdown(101, 1, worker());
    const section = await service.renderTicketSection(currentTicket as Ticket);

    expect(markdown).toContain('# 工单文档已删除');
    expect(rows).toHaveLength(0);
    expect(section).toContain('（暂无交付文档）');
  });

  it('工单 Markdown 展示链接并内联正文文档', async () => {
    await service.createMarkdown(101, worker(), {
      title: '接口文档',
      url: '/api/docs/detail/task/20261105/TK-0101/API.md',
    });
    await service.createMarkdown(101, worker(), {
      title: '发布说明',
      content: '# 发布说明\n\n发布内容',
    });

    const section = await service.renderTicketSection(currentTicket as Ticket);

    expect(section).toContain(
      '[接口文档](</api/docs/detail/task/20261105/TK-0101/API.md>)',
    );
    expect(section).toContain('#### 2. 发布说明');
    expect(section).toContain('# 发布说明\n\n发布内容');
  });

  it('文档清单包含链接、阅读地址与操作示例', async () => {
    await service.createMarkdown(101, worker(), {
      title: '发布说明',
      content: '# 发布说明',
    });

    const markdown = await service.listMarkdown(101);

    expect(markdown).toContain('工单 WO-0001 交付文档');
    expect(markdown).toContain('/api/tasks/101/ticket-documents/1.md');
    expect(markdown).toContain('/ticket-documents.md');
    expect(markdown).toContain('/ticket-documents/{documentId}/update.md');
    expect(markdown).toContain('/ticket-documents/{documentId}/delete.md');
  });

  it('非工单任务不能读写工单文档', async () => {
    currentTicket = null;
    runs.findOne.mockResolvedValue(null);

    await expect(
      service.createMarkdown(101, worker(), {
        title: '正文',
        content: '# 正文',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
