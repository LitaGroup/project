import { ConfigService } from '@nestjs/config';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import { FeishuBotCryptoService } from './feishu-bot-crypto.service';
import { localPathOf } from './feishu-bot-client.service';
import {
  chunkMarkdown,
  mapTextAnswer,
  splitAnswerLabels,
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
