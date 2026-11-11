import { ConfigService } from '@nestjs/config';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import { FeishuBotCryptoService } from './feishu-bot-crypto.service';
import { localPathOf } from './feishu-bot-client.service';
import { parseInboundMessage } from './feishu-bot-event.service';
import {
  chunkMarkdown,
  FeishuBotMessageService,
  mapTextAnswer,
  markdownCard,
  splitAnswerLabels,
  splitMarkdownBlocks,
} from './feishu-bot-message.service';

function cryptoService(masterKey?: string): FeishuBotCryptoService {
  const stub = {
    get: (key: string) =>
      key === 'FEISHU_BOT_MASTER_KEY'
        ? (masterKey ?? 'a'.repeat(32))
        : undefined,
  } as unknown as ConfigService;
  return new FeishuBotCryptoService(stub);
}

describe('FeishuBotCryptoService', () => {
  it('加密后可解密（AES-256-GCM）', () => {
    const service = cryptoService();
    const encrypted = service.encrypt('cli_secret_123');
    expect(encrypted.ciphertext).not.toContain('cli_secret_123');
    expect(
      service.decrypt({
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      }),
    ).toBe('cli_secret_123');
  });

  it('未配置主密钥时拒绝保存', () => {
    const service = new FeishuBotCryptoService({
      get: () => undefined,
    } as unknown as ConfigService);
    expect(service.available).toBe(false);
    expect(() => service.encrypt('x')).toThrow('FEISHU_BOT_MASTER_KEY');
  });

  it('能解密飞书 AES-256-CBC 事件密文', () => {
    const service = cryptoService();
    const encryptKey = 'event-key-123';
    const plain = JSON.stringify({
      challenge: 'abc',
      type: 'url_verification',
    });
    const key = createHash('sha256').update(encryptKey, 'utf8').digest();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([
      iv,
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]).toString('base64');
    expect(service.decryptEventPayload(encryptKey, encrypted)).toBe(plain);
  });

  it('Verification Token 常量时间比较', () => {
    const service = cryptoService();
    expect(service.safeEqualToken('abc', 'abc')).toBe(true);
    expect(service.safeEqualToken('abc', 'abd')).toBe(false);
    expect(service.safeEqualToken(undefined, 'abc')).toBe(false);
  });
});

describe('飞书消息 Markdown 分片', () => {
  it('短内容不切分', () => {
    expect(chunkMarkdown('hello')).toEqual(['hello']);
  });

  it('长内容按 3600 字符以内分片且内容不丢失', () => {
    const content = Array.from({ length: 600 }, (_, i) => `第 ${i} 行`).join(
      '\n',
    );
    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(3600);
    }
    expect(chunks.join('\n').replace(/\n+/g, '\n')).toBe(
      content.replace(/\n+/g, '\n'),
    );
  });

  it('超长单行硬切', () => {
    const line = 'x'.repeat(8000);
    const chunks = chunkMarkdown(line);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(line);
  });

  it('表格整块保留，不被分片从中间切断', () => {
    const table = [
      '| 业务 | 能解答的典型问题 |',
      '| --- | --- |',
      ...Array.from({ length: 20 }, (_, i) => `| 行${i} | 说明${i} |`),
    ].join('\n');
    // 前置长文本超过单卡上限，表格应整体留在同一张卡
    const text = Array.from({ length: 600 }, (_, i) => `第 ${i} 行`).join('\n');
    const chunks = chunkMarkdown(`${text}\n\n${table}`);
    const tableChunks = chunks.filter((chunk) => chunk.includes('| 业务 |'));
    expect(tableChunks).toHaveLength(1);
    expect(tableChunks[0]).toContain('| --- | --- |');
    expect(tableChunks[0]).toContain('| 行19 | 说明19 |');
  });

  it('表格与相邻段落之间补空行', () => {
    const content = '说明如下\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n后续说明';
    expect(chunkMarkdown(content)).toEqual([
      '说明如下\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n后续说明',
    ]);
  });

  it('代码块内的管道符不识别为表格', () => {
    const fence = '```md\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```';
    const blocks = splitMarkdownBlocks(fence);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].table).toBe(false);
    // 6 个代码块不会被「单卡最多 4 张表」拆开
    const content = Array.from({ length: 6 }, () => fence).join('\n\n');
    expect(chunkMarkdown(content)).toHaveLength(1);
  });

  it('单卡超过 4 张表时拆到下一张卡', () => {
    const table = '| k | v |\n| --- | --- |\n| a | b |';
    const content = Array.from({ length: 5 }, () => table).join('\n\n');
    const chunks = chunkMarkdown(content);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].split('| --- | --- |')).toHaveLength(5); // 4 张表
    expect(chunks[1].split('| --- | --- |')).toHaveLength(2); // 1 张表
  });
});

describe('飞书回复卡片（Card JSON 2.0）', () => {
  const elementsOf = (
    card: Record<string, unknown>,
  ): { tag: string; content: string }[] =>
    (card.body as { elements: { tag: string; content: string }[] }).elements;

  it('使用 2.0 结构，表格保留在 markdown 组件内由飞书原生渲染', () => {
    const card = markdownCard(
      '## 小结\n\n| 字段 | 说明 |\n| --- | --- |\n| id | 玩家 ID |',
    );
    expect(card.schema).toBe('2.0');
    expect(card.config).toMatchObject({ width_mode: 'fill' });
    const elements = elementsOf(card);
    expect(elements).toHaveLength(1);
    expect(elements[0].tag).toBe('markdown');
    expect(elements[0].content).toContain('| id | 玩家 ID |');
  });

  it('超过 4 张表时拆成多个 markdown 组件', () => {
    const table = '| k | v |\n| --- | --- |\n| a | b |';
    const card = markdownCard(
      Array.from({ length: 5 }, () => table).join('\n\n'),
    );
    const elements = elementsOf(card);
    expect(elements).toHaveLength(2);
    expect(elements[0].content.split('| --- | --- |')).toHaveLength(5); // 4 张表
    expect(elements[1].content.split('| --- | --- |')).toHaveLength(2); // 1 张表
  });

  it('空内容仍返回一个 markdown 组件，避免空卡片', () => {
    const elements = elementsOf(markdownCard('   '));
    expect(elements).toEqual([{ tag: 'markdown', content: '' }]);
  });
});

describe('飞书问题作答映射', () => {
  const question = {
    question: '选择环境',
    options: [
      { label: '测试环境' },
      { label: '生产环境' },
      { label: '预发布环境' },
    ],
    multiple: false,
    custom: true,
  };

  it('精确匹配选项 label', () => {
    expect(mapTextAnswer('测试环境', question)).toEqual(['测试环境']);
  });

  it('包含匹配选项 label', () => {
    expect(mapTextAnswer('生产', question)).toEqual(['生产环境']);
  });

  it('未命中选项时按自由输入处理', () => {
    expect(mapTextAnswer('自定义答案', question)).toEqual(['自定义答案']);
  });

  it('不允许自由输入时未命中返回 null', () => {
    expect(
      mapTextAnswer('自定义答案', { ...question, custom: false }),
    ).toBeNull();
  });

  it('多选按分隔符拆分并映射 label', () => {
    const multi = { ...question, multiple: true };
    expect(mapTextAnswer('测试环境、生产环境', multi)).toEqual([
      '测试环境',
      '生产环境',
    ]);
    expect(splitAnswerLabels('测试环境,生产环境 预发布环境')).toEqual([
      '测试环境',
      '生产环境',
      '预发布环境',
    ]);
  });
});

describe('飞书本地素材路径', () => {
  it('接受 /images 与 /files 路径，拒绝目录穿越', () => {
    expect(localPathOf('/files/feishu/a.png')).toContain('feishu/a.png');
    expect(localPathOf('/images/uploads/a.png')).toContain('uploads/a.png');
    expect(localPathOf('/files/../etc/passwd')).toBeNull();
    expect(localPathOf('https://example.com/a.png')).toBeNull();
  });
});

describe('飞书 Markdown 消息发送', () => {
  const clientMock = () => ({
    sendCard: jest.fn(() => Promise.resolve({ messageId: 'om_send' })),
    replyCard: jest.fn(() => Promise.resolve({ messageId: 'om_reply' })),
  });

  it('指定回复目标时逐片走回复接口，否则群发', async () => {
    const client = clientMock();
    const service = new FeishuBotMessageService(client as never);
    await service.sendMarkdown(
      2,
      {} as never,
      'chat_id',
      'oc_group',
      '你好',
      'om_1',
    );
    expect(client.replyCard).toHaveBeenCalledTimes(1);
    expect(client.replyCard.mock.calls[0][2]).toBe('om_1');
    expect(client.sendCard).not.toHaveBeenCalled();

    await service.sendMarkdown(2, {} as never, 'chat_id', 'oc_group', '你好');
    expect(client.sendCard).toHaveBeenCalledTimes(1);
  });

  it('提问卡片同样支持回复到指定消息', async () => {
    const client = clientMock();
    const service = new FeishuBotMessageService(client as never);
    await service.sendQuestionCard(
      2,
      {} as never,
      'chat_id',
      'oc_group',
      1,
      'q1',
      [{ question: '选哪个', options: [{ label: 'A' }] }],
      'om_9',
    );
    expect(client.replyCard).toHaveBeenCalledTimes(1);
    expect(client.replyCard.mock.calls[0][2]).toBe('om_9');
    expect(client.sendCard).not.toHaveBeenCalled();
  });
});

describe('飞书消息事件解析', () => {
  it('解析话题字段 root_id / parent_id / thread_id', () => {
    const message = parseInboundMessage({
      message_id: 'om_2',
      chat_id: 'oc_group',
      chat_type: 'group',
      message_type: 'text',
      content: JSON.stringify({ text: '@_user_1 你好' }),
      root_id: 'om_1',
      parent_id: 'om_1',
      thread_id: 'omt_1',
      mentions: [
        {
          key: '@_user_1',
          id: { open_id: 'ou_bot' },
          name: '机器人',
        },
      ],
    });
    expect(message).toMatchObject({
      messageId: 'om_2',
      chatId: 'oc_group',
      chatType: 'group',
      rootId: 'om_1',
      parentId: 'om_1',
      threadId: 'omt_1',
      mentions: [{ key: '@_user_1', openId: 'ou_bot', name: '机器人' }],
    });
  });

  it('普通群消息不返回话题字段', () => {
    const message = parseInboundMessage({
      message_id: 'om_1',
      chat_id: 'oc_group',
      chat_type: 'group',
      message_type: 'text',
      content: '{}',
    });
    expect(message?.threadId).toBeUndefined();
    expect(message?.rootId).toBeUndefined();
    expect(message?.parentId).toBeUndefined();
  });

  it('缺少 message_id / chat_id 时返回 null', () => {
    expect(parseInboundMessage({ message_id: 'om_1' })).toBeNull();
    expect(parseInboundMessage({ chat_id: 'oc_group' })).toBeNull();
  });
});
