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
    tasksRepo = { findOne: jest.fn().mockResolvedValue(task()) };
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
      createArticleAtPath: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
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

  it('生成 HANDOFF 交付文档（路径不带 .md 后缀）', async () => {
    const result = await service.upsertHandoff({
      task: task(),
      result: '活动页已上线',
      worker: { ...worker, ownerName: '王五' },
      appliedAt: new Date('2026-10-28T15:30:00+08:00'),
      requesterName: '张三',
      report: {
        delivery:
          '交付活动页；代码仓库 LitaGroup/activity，分支 test；文档 /project/8/document/9',
        problems: '接口字段缺失，补充后回归通过。',
        detours: '首次使用了旧接口，切换到 v2。',
        lessons: '开发前先确认接口版本。',
        followUps: '后续补充埋点。',
        other: '测试环境地址见项目文档。',
      },
    });

    expect(result.path).toBe('/task/20261028/TK-0001/HANDOFF');
    expect(result.url).toBe('/docs/detail/task/20261028/TK-0001/HANDOFF');
    expect(knowledge.createArticleAtPath).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/task/20261028/TK-0001/HANDOFF',
        title: 'TK-0001 活动页开发 · 任务交付文档',
        content: expect.stringContaining('活动页已上线') as string,
      }),
    );
    const created = knowledge.createArticleAtPath.mock.calls[0] as [
      { content: string },
    ];
    const content = created[0].content;
    expect(content).toContain('## 0、任务与责任');
    expect(content).toContain('| 任务定义 | 前端任务定义 |');
    expect(content).toContain('| 需求方 | 张三 |');
    expect(content).toContain('| 机器人负责人 | 王五 |');
    expect(content).toContain('负责 H5 页面开发与自测');
    expect(content).toContain('## 1、需求说明');
    expect(content).toContain('### 原始需求');
    expect(content).toContain('### 分析后的需求');
    expect(content).toContain('LitaGroup/activity，分支 test');
    expect(content).toContain('## 3、实现问题与解决');
    expect(content).toContain('## 4、弯路与经验复盘');
    expect(content).toContain('## 5、遗留建议与后续待办');
    expect(content).toContain('## 6、其它需要保留的信息');
    expect(content).not.toContain('报告版本');
  });

  it('交付说明缺失时保留明确占位且不把分析需求冒充原始需求', async () => {
    await service.upsertHandoff({
      task: task({ input: null, description: '开发一个活动页', result: null }),
      result: null,
      worker,
      appliedAt: new Date('2026-10-28T15:30:00+08:00'),
    });

    const created = knowledge.createArticleAtPath.mock.calls[0] as [
      { content: string },
    ];
    const content = created[0].content;
    expect(content).toContain('原始输入未单独保存');
    expect(content).toContain('（执行机器人未提交交付说明，记录中未体现）');
    expect(content).toContain('（未记录实现问题与解决过程）');
    expect(content).toContain('（无最终交付记录）');
    expect(content).not.toContain('（暂无）');
  });

  it('同一天重新申请覆盖同一个 HANDOFF', async () => {
    knowledge.findNodeByPath.mockResolvedValue(
      node('/task/20261028/TK-0001/HANDOFF'),
    );
    await service.upsertHandoff({
      task: task(),
      result: '补充后的交付物',
      worker,
      appliedAt: new Date('2026-10-28T16:00:00+08:00'),
    });

    expect(knowledge.createArticleAtPath).not.toHaveBeenCalled();
    expect(knowledge.update).toHaveBeenCalledWith(
      'node:/task/20261028/TK-0001/HANDOFF',
      expect.objectContaining({
        title: 'TK-0001 活动页开发 · 任务交付文档',
        content: expect.stringContaining('补充后的交付物') as string,
      }),
    );
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
});
