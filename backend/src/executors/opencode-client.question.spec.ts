import { createServer, type Server } from 'http';
import { OpencodeClient } from './opencode-client';

describe('OpencodeClient question', () => {
  let server: Server;
  let endpoint: { ip: string; port: number };
  let received: Array<{ method: string; path: string; body: string }>;
  /** 模拟旧版服务端：会话级 question 端点返回 404，需要回退全局端点 */
  let legacy: boolean;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const path = req.url ?? '';
        received.push({ method: req.method ?? '', path, body });
        if (req.method === 'GET' && path === '/api/session/s1/question') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              data: [{ id: 'q1', sessionID: 's1', questions: [] }],
            }),
          );
          return;
        }
        if (legacy && path.startsWith('/api/session/')) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ message: 'not found' }));
          return;
        }
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    endpoint = {
      ip: '127.0.0.1',
      port: typeof address === 'object' && address ? address.port : 0,
    };
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    received = [];
    legacy = false;
  });

  it('读取待回答提问', async () => {
    const client = new OpencodeClient(endpoint);
    await expect(client.listQuestions('s1')).resolves.toEqual([
      { id: 'q1', sessionID: 's1', questions: [] },
    ]);
  });

  it('回答 / 跳过提问转发到会话级端点', async () => {
    const client = new OpencodeClient(endpoint);
    await client.replyQuestion('s1', 'q1', [['测试', '自定义回答']]);
    await client.rejectQuestion('s1', 'q1');

    expect(received).toContainEqual({
      method: 'POST',
      path: '/api/session/s1/question/q1/reply',
      body: JSON.stringify({ answers: [['测试', '自定义回答']] }),
    });
    expect(received).toContainEqual({
      method: 'POST',
      path: '/api/session/s1/question/q1/reject',
      body: JSON.stringify({}),
    });
  });

  it('旧版服务端 404 时回退全局端点', async () => {
    legacy = true;
    const client = new OpencodeClient(endpoint);
    await client.replyQuestion('s1', 'q2', [['生产']]);

    expect(received.map((item) => item.path)).toEqual([
      '/api/session/s1/question/q2/reply',
      '/question/q2/reply',
    ]);
  });
});
