import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import {
  TaskTemplatesController,
  TaskTemplatesListMarkdownController,
  TaskTemplatesMarkdownController,
} from '../tasks/task-templates.controller';
import { TaskTemplatesService } from '../tasks/task-templates.service';
import {
  TaskTypesController,
  TaskTypesListMarkdownController,
  TaskTypesMarkdownController,
} from '../task-types/task-types.controller';
import { TaskTypesService } from '../task-types/task-types.service';
import { WorkersController } from '../workers/workers.controller';
import {
  WorkersListMarkdownController,
  WorkersMarkdownController,
} from '../workers/workers-markdown.controller';
import { WorkersMarkdownService } from '../workers/workers-markdown.service';
import { WorkerEnvironmentService } from '../workers/worker-environment.service';
import { WorkerOptimizeService } from '../workers/worker-optimize.service';
import { WorkerSkillCatalogService } from '../workers/worker-skill-catalog.service';
import { WorkerStandardCatalogService } from '../workers/worker-standard-catalog.service';
import { WorkersService } from '../workers/workers.service';

describe('Agent 管理接口路由', () => {
  let app: INestApplication;
  const workersMarkdown = {
    listMarkdown: jest.fn(),
    findOneMarkdown: jest.fn(),
    createMarkdown: jest.fn(),
    updateMarkdown: jest.fn(),
    removeMarkdown: jest.fn(),
  };
  const workers = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findOneView: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const templates = {
    listMarkdown: jest.fn(),
    findOneMarkdown: jest.fn(),
    createMarkdown: jest.fn(),
    updateMarkdown: jest.fn(),
    removeMarkdown: jest.fn(),
  };
  const taskTypes = {
    listMarkdown: jest.fn(),
    findOneMarkdown: jest.fn(),
    createMarkdown: jest.fn(),
    updateMarkdown: jest.fn(),
    removeMarkdown: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        WorkersListMarkdownController,
        WorkersMarkdownController,
        WorkersController,
        TaskTemplatesListMarkdownController,
        TaskTemplatesMarkdownController,
        TaskTemplatesController,
        TaskTypesListMarkdownController,
        TaskTypesMarkdownController,
        TaskTypesController,
      ],
      providers: [
        { provide: WorkersMarkdownService, useValue: workersMarkdown },
        { provide: WorkersService, useValue: workers },
        { provide: WorkerEnvironmentService, useValue: {} },
        { provide: WorkerOptimizeService, useValue: {} },
        { provide: WorkerSkillCatalogService, useValue: {} },
        { provide: WorkerStandardCatalogService, useValue: {} },
        { provide: TaskTemplatesService, useValue: templates },
        { provide: TaskTypesService, useValue: taskTypes },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    workers.findOne.mockResolvedValue({
      id: 1001,
      personalAgentUserId: null,
    });
    workersMarkdown.listMarkdown.mockResolvedValue('# 机器人清单');
    workersMarkdown.findOneMarkdown.mockResolvedValue('# 机器人详情');
    workersMarkdown.createMarkdown.mockResolvedValue('# 机器人已创建');
    workersMarkdown.updateMarkdown.mockResolvedValue('# 机器人已更新');
    workersMarkdown.removeMarkdown.mockResolvedValue('# 机器人已删除');
    templates.listMarkdown.mockResolvedValue('# 任务定义');
    templates.findOneMarkdown.mockResolvedValue('# 任务定义详情');
    templates.createMarkdown.mockResolvedValue('# 任务定义已创建');
    templates.updateMarkdown.mockResolvedValue('# 任务定义已更新');
    templates.removeMarkdown.mockResolvedValue('# 任务定义已删除');
    taskTypes.listMarkdown.mockResolvedValue('# 任务类型');
    taskTypes.findOneMarkdown.mockResolvedValue('# 任务类型详情');
    taskTypes.createMarkdown.mockResolvedValue('# 任务类型已创建');
    taskTypes.updateMarkdown.mockResolvedValue('# 任务类型已更新');
    taskTypes.removeMarkdown.mockResolvedValue('# 任务类型已删除');
  });

  it('机器人清单与详情命中 Markdown 控制器', async () => {
    const server = app.getHttpServer() as Server;
    const list = await request(server).get('/api/workers.md').expect(200);
    expect(list.text).toBe('# 机器人清单');
    expect(list.headers['content-type']).toContain('text/markdown');

    const detail = await request(server)
      .get('/api/workers/1001.md')
      .expect(200);
    expect(detail.text).toBe('# 机器人详情');
    expect(workersMarkdown.findOneMarkdown).toHaveBeenCalledWith(1001);
  });

  it('机器人写接口返回 HTTP 200 Markdown', async () => {
    const server = app.getHttpServer() as Server;
    const created = await request(server)
      .post('/api/workers/create.md')
      .send({ name: '机器人' })
      .expect(200);
    expect(created.text).toBe('# 机器人已创建');
    expect(workersMarkdown.createMarkdown).toHaveBeenCalledWith({
      name: '机器人',
    });

    const updated = await request(server)
      .post('/api/workers/1001/update.md')
      .send({ intro: '新简介' })
      .expect(200);
    expect(updated.text).toBe('# 机器人已更新');

    const removed = await request(server)
      .post('/api/workers/1001/delete.md')
      .expect(200);
    expect(removed.text).toBe('# 机器人已删除');
  });

  it('任务定义与任务类型的 Markdown 路由优先于 JSON :id', async () => {
    const server = app.getHttpServer() as Server;

    const templateList = await request(server)
      .get('/api/task-templates.md')
      .expect(200);
    expect(templateList.text).toBe('# 任务定义');
    const templateDetail = await request(server)
      .get('/api/task-templates/10.md')
      .expect(200);
    expect(templateDetail.text).toBe('# 任务定义详情');

    const typeList = await request(server)
      .get('/api/task-types.md')
      .expect(200);
    expect(typeList.text).toBe('# 任务类型');
    const typeDetail = await request(server)
      .get('/api/task-types/1.md')
      .expect(200);
    expect(typeDetail.text).toBe('# 任务类型详情');
  });

  it('任务定义与任务类型写接口返回 HTTP 200 Markdown', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/task-templates/create.md')
      .send({ name: '新定义' })
      .expect(200);
    expect(templates.createMarkdown).toHaveBeenCalled();

    await request(server)
      .post('/api/task-templates/1000/update.md')
      .send({ description: '新描述' })
      .expect(200);
    expect(templates.updateMarkdown).toHaveBeenCalledWith(1000, {
      description: '新描述',
    });

    await request(server)
      .post('/api/task-types/create.md')
      .send({ name: '数据分析' })
      .expect(200);
    expect(taskTypes.createMarkdown).toHaveBeenCalled();

    await request(server).post('/api/task-types/1/delete.md').expect(200);
    expect(taskTypes.removeMarkdown).toHaveBeenCalledWith(1);
  });
});
