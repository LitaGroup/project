import { BadRequestException, ConflictException } from '@nestjs/common';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import type { KnowledgeNode } from '../knowledge/knowledge.types';
import type { KnowledgeService } from '../knowledge/knowledge.service';
import { Task } from './task.entity';
import { TaskDocumentService } from './task-document.service';

describe('TaskDocumentService 任务文档', () => {
  const task = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '活动页开发',
      type: '前端开发',
      templateId: 11,
      templateName: '前端任务定义',
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      acceptRejectCount: 0,
      description: '开发活动页',
      input: '开发一个活动页',
      content: '支持移动端',
      outputSpec: '可验收的活动页',
      workPlan: '1. 开发\n2. 自测',
      result: '活动页已上线',
      agentId: 1001,
      handoffPath: null,
      handoffVersion: 0,
      handoffSubmittedVersion: null,
      handoffUpdatedAt: null,
      handoffUpdatedBy: null,
      acceptedAt: new Date('2026-10-28T12:00:00+08:00'),
      deliveredAt: new Date('2026-10-28T12:00:00+08:00'),
      createdAt: new Date('2026-10-28T09:00:00+08:00'),
      ...over,
    }) as Task;

  const node = (
    path: string,
    content = '',
    updatedAt = new Date('2026-10-28T10:00:00+08:00'),
  ): KnowledgeNode => ({
    id: `node:${path}`,
    kind: 'article',
    path,
    parentPath: path.slice(0, path.lastIndexOf('/')),
    name: path.slice(path.lastIndexOf('/') + 1),
    title: '任务交付文档',
    content,
    source: 'native',
    sourceDocumentId: null,
    contentHash: '',
    indexStatus: 'ready',
    indexError: null,
    indexAttempts: 0,
    createdAt: updatedAt,
    updatedAt,
  });

  let currentTask: Task;
  let tasksRepo: {
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let templatesRepo: { findOne: jest.Mock };
  let knowledge: {
    isEnabled: boolean;
    disabledMessage: string;
    findNodeByPath: jest.Mock;
    createArticleAtPath: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    listArticlesByPrefix: jest.Mock;
    pruneEmptyDirectories: jest.Mock;
  };
  let service: TaskDocumentService;

  beforeEach(() => {
    currentTask = task();
    tasksRepo = {
      findOne: jest.fn(() => Promise.resolve(currentTask)),
      update: jest.fn((_criteria: unknown, patch: Partial<Task>) => {
        Object.assign(currentTask, patch);
        return Promise.resolve({ affected: 1 });
      }),
    };
    templatesRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 11,
        name: '前端任务定义',
        description: '负责 H5 页面开发与自测',
      }),
    };
    knowledge = {
      isEnabled: true,
      disabledMessage: '知识库不可用',
      findNodeByPath: jest.fn().mockResolvedValue(null),
      createArticleAtPath: jest
        .fn()
        .mockImplementation((input: { path: string; content: string }) =>
          Promise.resolve(node(input.path, input.content)),
        ),
      update: jest
        .fn()
        .mockImplementation(
          (id: string, patch: { content?: string; title?: string }) =>
            Promise.resolve(
              node(
                id.startsWith('node:') ? id.slice(5) : id,
                patch.content ?? '',
              ),
            ),
        ),
      remove: jest.fn().mockResolvedValue(undefined),
      listArticlesByPrefix: jest.fn().mockResolvedValue([]),
      pruneEmptyDirectories: jest.fn().mockResolvedValue(0),
    };
    service = new TaskDocumentService(
      tasksRepo as never,
      templatesRepo as never,
      knowledge as unknown as KnowledgeService,
    );
  });

  it('任务创建时生成 HANDOFF，正文为处理中占位且带版本 Frontmatter', async () => {
    const result = await service.ensureHandoff(currentTask);

    expect(result.path).toBe('/task/20261028/TK-0001/HANDOFF');
    expect(result.url).toBe('/docs/detail/task/20261028/TK-0001/HANDOFF');
    expect(result.version).toBe(1);
    expect(result.content).toBe('> 正在处理中……');
    expect(knowledge.createArticleAtPath).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/task/20261028/TK-0001/HANDOFF',
        title: 'TK-0001 活动页开发 · 任务交付文档',
        content: expect.stringContaining('version: "1"') as string,
      }),
    );
    expect(currentTask.handoffPath).toBe('/task/20261028/TK-0001/HANDOFF');
    expect(currentTask.handoffVersion).toBe(1);
  });

  it('机器人提交完整正文时平台递增版本并覆盖 Frontmatter', async () => {
    const path = '/task/20261028/TK-0001/HANDOFF';
    currentTask = task({
      handoffPath: path,
      handoffVersion: 2,
      handoffUpdatedAt: new Date('2026-10-28T10:00:00+08:00'),
      handoffUpdatedBy: '前端机器人',
    });
    knowledge.findNodeByPath.mockResolvedValue(
      node(
        path,
        '---\nupdate: "2026-10-28 10:00:00"\ndocument: "HANDOFF"\ntask: "TK-0001"\nversion: "2"\n---\n\n旧正文',
      ),
    );

    const result = await service.updateHandoff(1, {
      baseVersion: 2,
      content: '---\nversion: "99"\n---\n\n# 交付\n\n活动页已完成',
      updatedBy: '张三',
    });

    expect(result.document.version).toBe(3);
    expect(result.document.content).toBe('# 交付\n\n活动页已完成');
    expect(result.document.updatedBy).toBe('张三');
    const updated = knowledge.update.mock.calls[0] as [
      string,
      { content: string },
    ];
    expect(updated[1].content).toContain('version: "3"');
    expect(updated[1].content).toContain('updated_by: "张三"');
    expect(updated[1].content).toContain('活动页已完成');
    expect(updated[1].content).not.toContain('version: "99"');
  });

  it('append 模式在保留现有正文的基础上追加进展', async () => {
    const path = '/task/20261028/TK-0001/HANDOFF';
    currentTask = task({ handoffPath: path, handoffVersion: 2 });
    knowledge.findNodeByPath.mockResolvedValue(
      node(path, '---\nversion: "2"\n---\n\n# 交付\n\n已完成登录页'),
    );

    const result = await service.updateHandoff(1, {
      append: '## 21:00 更新\n\n联调完成',
      baseVersion: 2,
      updatedBy: '机器人',
    });

    expect(result.document.version).toBe(3);
    expect(result.document.content).toBe(
      '# 交付\n\n已完成登录页\n\n## 21:00 更新\n\n联调完成',
    );
  });

  it('正文没有变化时不递增版本，也不触发后续通知', async () => {
    const path = '/task/20261028/TK-0001/HANDOFF';
    currentTask = task({ handoffPath: path, handoffVersion: 2 });
    knowledge.findNodeByPath.mockResolvedValue(
      node(path, '---\nversion: "2"\n---\n\n# 交付\n\n已完成登录页'),
    );

    const result = await service.updateHandoff(1, {
      content: '# 交付\n\n已完成登录页',
      baseVersion: 2,
      updatedBy: '张三',
    });

    expect(result.changed).toBe(false);
    expect(result.document.version).toBe(2);
    expect(knowledge.update).not.toHaveBeenCalled();
  });

  it('baseVersion 过期返回冲突，不覆盖别人的修改', async () => {
    const path = '/task/20261028/TK-0001/HANDOFF';
    currentTask = task({ handoffPath: path, handoffVersion: 3 });
    knowledge.findNodeByPath.mockResolvedValue(
      node(path, '---\nversion: "3"\n---\n\n人工补充内容'),
    );

    await expect(
      service.updateHandoff(1, {
        baseVersion: 2,
        content: '旧版本覆盖',
        updatedBy: '机器人',
      }),
    ).rejects.toThrow(ConflictException);
    expect(knowledge.update).not.toHaveBeenCalled();
  });

  it('交付文档仍是处理中占位时不能申请验收', async () => {
    const path = '/task/20261028/TK-0001/HANDOFF';
    currentTask = task({ handoffPath: path, handoffVersion: 1 });
    knowledge.findNodeByPath.mockResolvedValue(
      node(path, '---\nversion: "1"\n---\n\n> 正在处理中……'),
    );

    await expect(service.prepareForAcceptance(currentTask)).rejects.toThrow(
      BadRequestException,
    );
    expect(currentTask.handoffSubmittedVersion).toBeNull();
  });

  it('申请验收锁定当前交付文档版本', async () => {
    const path = '/task/20261028/TK-0001/HANDOFF';
    currentTask = task({
      handoffPath: path,
      handoffVersion: 4,
      handoffUpdatedAt: new Date('2026-10-28T11:00:00+08:00'),
    });
    knowledge.findNodeByPath.mockResolvedValue(
      node(path, '---\nversion: "4"\n---\n\n最终交付内容'),
    );

    const result = await service.prepareForAcceptance(currentTask);

    expect(result.submittedVersion).toBe(4);
    expect(currentTask.handoffSubmittedVersion).toBe(4);
  });

  it('待验收期间交付文档锁定', async () => {
    const path = '/task/20261028/TK-0001/HANDOFF';
    currentTask = task({
      handoffPath: path,
      handoffVersion: 2,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
    });
    knowledge.findNodeByPath.mockResolvedValue(
      node(path, '---\nversion: "2"\n---\n\n交付内容'),
    );

    await expect(
      service.updateHandoff(1, {
        baseVersion: 2,
        content: '待验收时修改',
        updatedBy: '张三',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('复盘固定使用验收日期中的 REVIEW', async () => {
    const result = await service.upsertReview({
      task: task(),
      title: 'TK-0001 活动页开发 · 任务复盘',
      content: '# 任务复盘',
    });

    expect(result.path).toBe('/task/20261028/TK-0001/REVIEW');
    expect(service.reviewPath(task())).toBe('/task/20261028/TK-0001/REVIEW');
  });

  it('旧版本历史任务文档自动登记为当前 HANDOFF', async () => {
    knowledge.listArticlesByPrefix.mockResolvedValue([
      node(
        '/task/20261027/TK-0001/HANDOFF',
        '旧版平台拼接的交付内容',
        new Date('2026-10-27T10:00:00+08:00'),
      ),
    ]);

    const result = await service.ensureHandoff(currentTask);

    expect(result.path).toBe('/task/20261027/TK-0001/HANDOFF');
    expect(result.content).toBe('旧版平台拼接的交付内容');
    expect(result.version).toBe(1);
    expect(currentTask.handoffPath).toBe('/task/20261027/TK-0001/HANDOFF');
    expect(knowledge.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        content: expect.stringContaining('version: "1"') as string,
      }),
    );
  });

  it('旧版本文档迁移为最新版本 REVIEW 并清理其他版本', async () => {
    const oldV0 = node(
      '/task/handoff/20261027/TK-0001/0.md',
      '# TK-0001 活动页开发 · 任务总结移交\n\n> 报告版本：v0 ｜ 生成时间：2026-10-27 10:00:00 ｜ 归档路径：`/task/handoff/20261027/TK-0001/0.md`\n\n正文',
    );
    const latest = node(
      '/task/handoff/20261028/TK-0001/1.md',
      '# TK-0001 活动页开发 · 任务总结移交\n\n> 报告版本：v1 ｜ 生成时间：2026-10-28 12:00:00 ｜ 归档路径：`/task/handoff/20261028/TK-0001/1.md`\n\n正文',
    );
    knowledge.listArticlesByPrefix.mockResolvedValue([oldV0, latest]);

    const migrated = await service.migrateLegacyDocuments();

    expect(migrated).toBe(1);
    expect(knowledge.update).toHaveBeenCalledWith(
      latest.id,
      expect.objectContaining({
        parentPath: '/task/20261028/TK-0001',
        name: 'REVIEW',
        title: 'TK-0001 活动页开发 · 任务复盘',
        content: expect.not.stringContaining('报告版本') as string,
      }),
    );
    const updated = knowledge.update.mock.calls[0] as [
      string,
      { content: string },
    ];
    expect(updated[1].content).toContain('# TK-0001 活动页开发 · 任务复盘');
    expect(updated[1].content).toContain(
      '归档路径：`/task/20261028/TK-0001/REVIEW`',
    );
    expect(knowledge.remove).toHaveBeenCalledWith(oldV0.id);
    expect(knowledge.remove).not.toHaveBeenCalledWith(latest.id);
    expect(knowledge.pruneEmptyDirectories).toHaveBeenCalledWith(
      '/task/handoff',
    );
  });

  it('目标 REVIEW 已存在时保留新文档，只清理旧版本', async () => {
    const old = node('/task/handoff/20261028/TK-0001/0.md', '旧内容');
    const existing = node('/task/20261028/TK-0001/REVIEW', '新内容');
    knowledge.listArticlesByPrefix.mockResolvedValue([old]);
    knowledge.findNodeByPath.mockResolvedValue(existing);

    await service.migrateLegacyDocuments();

    expect(knowledge.update).not.toHaveBeenCalled();
    expect(knowledge.remove).toHaveBeenCalledWith(old.id);
  });

  it('历史任务文档路径去掉 .md 后缀并同步正文里的路径', async () => {
    const suffixed = node(
      '/task/20261029/TK-0037/HANDOFF.md',
      '文档路径：`/task/20261029/TK-0037/HANDOFF.md`',
    );
    knowledge.listArticlesByPrefix.mockResolvedValue([suffixed]);

    const migrated = await service.migrateSuffixedDocumentPaths();

    expect(migrated).toBe(1);
    expect(knowledge.update).toHaveBeenCalledWith(suffixed.id, {
      name: 'HANDOFF',
      content: '文档路径：`/task/20261029/TK-0037/HANDOFF`',
    });
  });

  it('去掉 .md 后缀时目标路径已存在则跳过', async () => {
    const suffixed = node('/task/20261029/TK-0037/HANDOFF.md');
    knowledge.listArticlesByPrefix.mockResolvedValue([suffixed]);
    knowledge.findNodeByPath.mockResolvedValue(
      node('/task/20261029/TK-0037/HANDOFF'),
    );

    const migrated = await service.migrateSuffixedDocumentPaths();

    expect(migrated).toBe(0);
    expect(knowledge.update).not.toHaveBeenCalled();
  });

  it('任务文档目录沿用 HANDOFF 所在目录，REVIEW 与 HANDOFF 同目录', () => {
    currentTask = task({
      handoffPath: '/task/20261020/TK-0001/HANDOFF',
      acceptedAt: new Date('2026-10-28T12:00:00+08:00'),
    });

    expect(service.taskDirectory(currentTask)).toBe('/task/20261020/TK-0001');
    expect(service.reviewPath(currentTask)).toBe(
      '/task/20261020/TK-0001/REVIEW',
    );
    expect(service.taskDocumentPath(currentTask, 'TECH_DESIGN.md')).toBe(
      '/task/20261020/TK-0001/TECH_DESIGN',
    );
  });

  it('列任务目录文档时只取直属文章，HANDOFF/REVIEW 优先', async () => {
    knowledge.listArticlesByPrefix.mockResolvedValue([
      node('/task/20261028/TK-0001/API'),
      node('/task/20261028/TK-0001/REVIEW'),
      node('/task/20261028/TK-0001/HANDOFF'),
      node('/task/20261028/TK-0001/sub/TECH_DESIGN'),
    ]);

    const documents = await service.listTaskDocuments(currentTask);

    expect(knowledge.listArticlesByPrefix).toHaveBeenCalledWith(
      '/task/20261028/TK-0001',
    );
    expect(documents.map((document) => document.name)).toEqual([
      'HANDOFF.md',
      'REVIEW.md',
      'API.md',
    ]);
    expect(documents[2].markdownUrl).toBe(
      '/docs/detail/task/20261028/TK-0001/API.md',
    );
  });

  it('写入任务目录普通文档时补 .md 阅读名并生成 Frontmatter', async () => {
    const document = await service.upsertTaskDocument(currentTask, {
      name: 'TECH_DESIGN.md',
      content: '# 技术方案\n\n正文',
      updatedBy: '后端机器人',
    });

    expect(document.name).toBe('TECH_DESIGN.md');
    expect(document.path).toBe('/task/20261028/TK-0001/TECH_DESIGN');
    expect(knowledge.createArticleAtPath).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/task/20261028/TK-0001/TECH_DESIGN',
        title: 'TK-0001 活动页开发 · TECH_DESIGN.md',
        content: expect.stringContaining('document: "TECH_DESIGN"') as string,
      }),
    );
    expect(knowledge.createArticleAtPath).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('updated_by: "后端机器人"') as string,
      }),
    );
  });

  it('HANDOFF / REVIEW 不允许从任务普通文档接口写入', async () => {
    await expect(
      service.upsertTaskDocument(currentTask, {
        name: 'HANDOFF.md',
        content: '# 覆盖',
        updatedBy: '后端机器人',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.upsertTaskDocument(currentTask, {
        name: 'review',
        content: '# 覆盖',
        updatedBy: '后端机器人',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(knowledge.update).not.toHaveBeenCalled();
    expect(knowledge.createArticleAtPath).not.toHaveBeenCalled();
  });

  it('任务文档清单包含目录约定与阅读地址', () => {
    const markdown = service.taskDocumentsMarkdown(currentTask, [
      {
        name: 'HANDOFF.md',
        path: '/task/20261028/TK-0001/HANDOFF',
        url: '/docs/detail/task/20261028/TK-0001/HANDOFF',
        markdownUrl: '/docs/detail/task/20261028/TK-0001/HANDOFF.md',
        title: '交付文档',
        updatedAt: '2026-10-28T10:00:00+08:00',
      },
      {
        name: 'API.md',
        path: '/task/20261028/TK-0001/API',
        url: '/docs/detail/task/20261028/TK-0001/API',
        markdownUrl: '/docs/detail/task/20261028/TK-0001/API.md',
        title: '接口文档',
        updatedAt: null,
      },
    ]);

    expect(markdown).toContain('文档目录：`/task/20261028/TK-0001`');
    expect(markdown).toContain('需求中明确指定文档地址时');
    expect(markdown).toContain('API.md');
    expect(markdown).toContain('/api/docs/detail/task/20261028/TK-0001/API.md');
    expect(markdown).toContain('/tasks/1/documents.md');
  });

  it('任务文档名拒绝路径分隔符与空名称', async () => {
    for (const name of ['', '../API', 'a/b', '.md']) {
      await expect(
        service.upsertTaskDocument(currentTask, {
          name,
          content: '正文',
          updatedBy: '后端机器人',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
