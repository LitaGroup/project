import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

describe('KnowledgeController routes', () => {
  let app: INestApplication;
  const service = {
    readDirectory: jest.fn(),
    readArticle: jest.fn(),
    renderDirectoryMarkdown: jest.fn(),
    renderArticleMarkdown: jest.fn(),
    renderNodeCreatedMarkdown: jest.fn(),
    renderNodeUpdatedMarkdown: jest.fn(),
    renderNodeDeletedMarkdown: jest.fn(),
    search: jest.fn(),
    renderSearchMarkdown: jest.fn(),
    getNodeById: jest.fn(),
    getNodeByPath: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [{ provide: KnowledgeService, useValue: service }],
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
    service.readDirectory.mockResolvedValue({
      path: '/guides',
      title: 'guides',
      parentPath: '/',
      directories: [],
      articles: [],
    });
    service.readArticle.mockResolvedValue({
      id: 'article-1',
      kind: 'article',
      path: '/guides/deploy',
      title: '部署',
      content: '# 部署',
    });
    service.renderDirectoryMarkdown.mockResolvedValue('# 目录');
    service.renderArticleMarkdown.mockReturnValue('# 文章');
  });

  it('目录 JSON 带结尾 /，并保留完整路径', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/api/docs/detail/guides/')
      .expect(200);
    expect((res.body as { path: string }).path).toBe('/guides');
    expect(service.readDirectory).toHaveBeenCalledWith('/guides');
  });

  it('文章 JSON 不带结尾 /', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/api/docs/detail/guides/deploy')
      .expect(200);
    expect((res.body as { path: string }).path).toBe('/guides/deploy');
    expect(service.readArticle).toHaveBeenCalledWith('/guides/deploy');
  });

  it('文章 Markdown 以 .md 结尾', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/api/docs/detail/guides/deploy.md')
      .expect(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.text).toBe('# 文章');
    expect(service.readArticle).toHaveBeenCalledWith('/guides/deploy');
  });

  it('目录 Markdown 以 /.md 结尾', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/api/docs/detail/guides/.md')
      .expect(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(service.renderDirectoryMarkdown).toHaveBeenCalledWith('/guides');
  });

  it('根目录支持 JSON 与 /.md', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/docs/detail/')
      .expect(200);
    await request(app.getHttpServer() as Server)
      .get('/api/docs/detail/.md')
      .expect(200);
    expect(service.readDirectory).toHaveBeenCalledWith('/');
    expect(service.renderDirectoryMarkdown).toHaveBeenCalledWith('/');
  });

  it('拒绝编码斜杠，防止一个路径段被当成多级目录', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/docs/detail/guides%2Fsecret/.md')
      .expect(400);
  });

  describe('AI 维护接口', () => {
    const node = {
      id: 'node-1',
      kind: 'article' as const,
      path: '/guides/deploy',
      parentPath: '/guides',
      name: 'deploy',
      title: '部署',
      content: '# 部署',
      source: 'native' as const,
      sourceDocumentId: null,
      contentHash: 'hash',
      indexStatus: 'pending' as const,
      indexError: null,
      indexAttempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('创建知识返回 Markdown 与读取地址', async () => {
      service.create.mockResolvedValue(node);
      service.renderNodeCreatedMarkdown.mockReturnValue('# 已创建');
      const res = await request(app.getHttpServer() as Server)
        .post('/api/docs/nodes/create.md')
        .send({
          kind: 'article',
          parentPath: '/guides',
          name: 'deploy',
          title: '部署',
          content: '# 部署',
        })
        .expect(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(service.create).toHaveBeenCalledWith(
        expect.objectContaining({ parentPath: '/guides', name: 'deploy' }),
      );
      expect(res.text).toBe('# 已创建');
    });

    it('按当前路径更新并支持移动', async () => {
      service.getNodeByPath.mockResolvedValue(node);
      service.update.mockResolvedValue({ ...node, path: '/manual/deploy' });
      service.renderNodeUpdatedMarkdown.mockReturnValue('# 已更新');
      await request(app.getHttpServer() as Server)
        .post('/api/docs/nodes/update.md')
        .send({
          path: '/guides/deploy',
          title: '部署 v2',
          parentPath: '/manual',
          name: 'deploy',
        })
        .expect(200);
      expect(service.update).toHaveBeenCalledWith('node-1', {
        title: '部署 v2',
        content: undefined,
        parentPath: '/manual',
        name: 'deploy',
      });
      expect(service.renderNodeUpdatedMarkdown).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/manual/deploy' }),
        '/guides/deploy',
      );
    });

    it('按路径删除，非空目录需显式 recursive', async () => {
      service.getNodeByPath.mockResolvedValue({ ...node, kind: 'directory' });
      service.remove.mockResolvedValue(undefined);
      service.renderNodeDeletedMarkdown.mockReturnValue('# 已删除');
      const res = await request(app.getHttpServer() as Server)
        .post('/api/docs/nodes/delete.md')
        .send({ path: '/guides', recursive: true })
        .expect(200);
      expect(service.remove).toHaveBeenCalledWith('node-1', true);
      expect(res.text).toBe('# 已删除');
    });
  });
});
