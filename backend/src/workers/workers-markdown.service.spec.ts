import { WorkerLiveStatus, WorkerRole, WorkerRuntime } from '../common/enums';
import type { WorkerView, WorkersService } from './workers.service';
import type { WorkerEnvironmentService } from './worker-environment.service';
import { WorkersMarkdownService } from './workers-markdown.service';

function workerView(over: Partial<WorkerView> = {}): WorkerView {
  return {
    id: 1001,
    name: '活动开发机器人',
    systemKey: null,
    intro: '负责活动前端开发',
    avatarUrl: null,
    role: WorkerRole.WORKER,
    runtime: WorkerRuntime.OPENCODE,
    executorId: 1,
    providerId: 'openai',
    modelId: 'gpt-5',
    variant: null,
    prompt: '# 角色定义',
    skills: null,
    standards: null,
    taskDefs: null,
    humanUserId: null,
    humanUserName: null,
    personalAgentUserId: null,
    ownerUserId: null,
    ownerName: null,
    agentToken: 'must-not-leak',
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    system: false,
    workdir: '/worker/1001',
    liveStatus: WorkerLiveStatus.IDLE,
    activeTask: null,
    ...over,
  };
}

describe('WorkersMarkdownService', () => {
  const workers = {
    findAll: jest.fn(),
    findOneView: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const environment = {
    start: jest.fn(),
  };
  let service: WorkersMarkdownService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorkersMarkdownService(
      workers as unknown as WorkersService,
      environment as unknown as WorkerEnvironmentService,
    );
  });

  it('清单不输出 agentToken，并包含详情链接', async () => {
    workers.findAll.mockResolvedValue([workerView()]);

    const markdown = await service.listMarkdown();

    expect(markdown).toContain('[1001](/api/workers/1001.md)');
    expect(markdown).toContain('活动开发机器人');
    expect(markdown).not.toContain('must-not-leak');
    expect(markdown).not.toContain('agentToken');
    expect(markdown).toContain('POST /api/workers/create.md');
  });

  it('详情展示机器人定义且不泄露令牌', async () => {
    workers.findOneView.mockResolvedValue(workerView());

    const markdown = await service.findOneMarkdown(1001);

    expect(markdown).toContain('# 活动开发机器人');
    expect(markdown).toContain('## 机器人定义 AGENTS.md');
    expect(markdown).toContain('# 角色定义');
    expect(markdown).not.toContain('must-not-leak');
  });

  it('创建成功后自动启动初始化并返回运行状态', async () => {
    const created = workerView();
    workers.create.mockResolvedValue(created);
    environment.start.mockResolvedValue({
      workerId: 1001,
      status: 'running',
      lines: [],
      error: null,
      workdir: '/worker/1001',
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });

    const markdown = await service.createMarkdown({
      name: '活动开发机器人',
    });

    expect(workers.create).toHaveBeenCalledWith({
      name: '活动开发机器人',
    });
    expect(environment.start).toHaveBeenCalledWith(1001);
    expect(markdown).toContain('# 机器人已创建');
    expect(markdown).toContain('工位初始化：running');
  });

  it('编辑真人机器人时跳过初始化', async () => {
    workers.update.mockResolvedValue(
      workerView({
        runtime: WorkerRuntime.HUMAN,
        humanUserId: 7,
        humanUserName: '张三',
        executorId: null,
        providerId: null,
        modelId: null,
      }),
    );

    const markdown = await service.updateMarkdown(1001, { intro: '新简介' });

    expect(environment.start).not.toHaveBeenCalled();
    expect(markdown).toContain('工位初始化：跳过');
    expect(markdown).toContain('真人机器人由绑定用户执行');
  });

  it('初始化前置条件失败时保留已保存配置并返回原因', async () => {
    workers.update.mockResolvedValue(workerView());
    environment.start.mockRejectedValue(new Error('执行器 #1 离线或不存在'));

    const markdown = await service.updateMarkdown(1001, { intro: '新简介' });

    expect(workers.update).toHaveBeenCalledWith(1001, { intro: '新简介' });
    expect(markdown).toContain('机器人已更新');
    expect(markdown).toContain('工位初始化：未启动');
    expect(markdown).toContain('执行器 #1 离线或不存在');
    expect(markdown).toContain('配置已保存成功');
  });

  it('删除前读取机器人信息，结果不返回详情链接', async () => {
    workers.findOneView.mockResolvedValue(workerView());

    const markdown = await service.removeMarkdown(1001);

    expect(workers.remove).toHaveBeenCalledWith(1001);
    expect(markdown).toContain('# 机器人已删除');
    expect(markdown).not.toContain('/api/workers/1001.md');
  });
});
