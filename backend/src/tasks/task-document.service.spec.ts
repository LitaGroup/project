import { TaskStatus, TaskSubStatus } from '../common/enums';
import type { KnowledgeNode } from '../knowledge/knowledge.types';
import type { KnowledgeService } from '../knowledge/knowledge.service';
import type { Worker } from '../workers/worker.entity';
import { Task } from './task.entity';
import { TaskDocumentService } from './task-document.service';

describe('TaskDocumentService 任务文档', () => {
  const task = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '活动页开发',
      type: '前端开发',
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      description: '开发活动页',
      input: '开发一个活动页',
      content: '支持移动端',
      outputSpec: '可验收的活动页',
      workPlan: '1. 开发\n2. 自测',
      result: '活动页已上线',
      agentId: 1001,
      acceptedAt: new Date('2026-10-28T12:00:00+08:00'),
      deliveredAt: new Date('2026-10-28T12:00:00+08:00'),
      createdAt: new Date('2026-10-28T09:00:00+08:00'),
      ...over,
    }) as Task;

  const worker = { id: 1001, name: '前端工程师' } as Worker;

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
    title: '旧任务总结',
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

  let tasksRepo: { findOne: jest.Mock };
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
    tasksRepo = { findOne: jest.fn().mockResolvedValue(task()) };
    knowledge = {
      isEnabled: true,
      disabledMessage: '知识库不可用',
      findNodeByPath: jest.fn().mockResolvedValue(null),
      createArticleAtPath: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
      listArticlesByPrefix: jest.fn().mockResolvedValue([]),
      pruneEmptyDirectories: jest.fn().mockResolvedValue(0),
    };
    service = new TaskDocumentService(
      tasksRepo as never,
      knowledge as unknown as KnowledgeService,
    );
  });

  it('生成 HANDOFF.md 交付文档（无版本号）', async () => {
    const result = await service.upsertHandoff({
      task: task(),
      result: '活动页已上线',
      worker,
      appliedAt: new Date('2026-10-28T15:30:00+08:00'),
    });

    expect(result.path).toBe('/task/20261028/TK-0001/HANDOFF.md');
    expect(result.url).toContain('/task/20261028/TK-0001/HANDOFF.md');
    expect(knowledge.createArticleAtPath).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/task/20261028/TK-0001/HANDOFF.md',
        title: 'TK-0001 活动页开发 · 任务交付',
        content: expect.stringContaining('活动页已上线') as string,
      }),
    );
    const created = knowledge.createArticleAtPath.mock.calls[0] as [
      { content: string },
    ];
    expect(created[0].content).toContain('## 五、最终交付物');
    expect(created[0].content).not.toContain('版本');
  });

  it('同一天重新申请覆盖同一个 HANDOFF.md', async () => {
    knowledge.findNodeByPath.mockResolvedValue(
      node('/task/20261028/TK-0001/HANDOFF.md'),
    );
    await service.upsertHandoff({
      task: task(),
      result: '补充后的交付物',
      worker,
      appliedAt: new Date('2026-10-28T16:00:00+08:00'),
    });

    expect(knowledge.createArticleAtPath).not.toHaveBeenCalled();
    expect(knowledge.update).toHaveBeenCalledWith(
      'node:/task/20261028/TK-0001/HANDOFF.md',
      expect.objectContaining({
        title: 'TK-0001 活动页开发 · 任务交付',
        content: expect.stringContaining('补充后的交付物') as string,
      }),
    );
  });

  it('复盘固定使用验收日期中的 REVIEW.md', async () => {
    const result = await service.upsertReview({
      task: task(),
      title: 'TK-0001 活动页开发 · 任务复盘',
      content: '# 任务复盘',
    });

    expect(result.path).toBe('/task/20261028/TK-0001/REVIEW.md');
    expect(service.reviewPath(task())).toBe('/task/20261028/TK-0001/REVIEW.md');
  });

  it('旧版本文档迁移为最新版本 REVIEW.md 并清理其他版本', async () => {
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
        name: 'REVIEW.md',
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
      '归档路径：`/task/20261028/TK-0001/REVIEW.md`',
    );
    expect(knowledge.remove).toHaveBeenCalledWith(oldV0.id);
    expect(knowledge.remove).not.toHaveBeenCalledWith(latest.id);
    expect(knowledge.pruneEmptyDirectories).toHaveBeenCalledWith(
      '/task/handoff',
    );
  });

  it('目标 REVIEW.md 已存在时保留新文档，只清理旧版本', async () => {
    const old = node('/task/handoff/20261028/TK-0001/0.md', '旧内容');
    const existing = node('/task/20261028/TK-0001/REVIEW.md', '新内容');
    knowledge.listArticlesByPrefix.mockResolvedValue([old]);
    knowledge.findNodeByPath.mockResolvedValue(existing);

    await service.migrateLegacyDocuments();

    expect(knowledge.update).not.toHaveBeenCalled();
    expect(knowledge.remove).toHaveBeenCalledWith(old.id);
  });
});
