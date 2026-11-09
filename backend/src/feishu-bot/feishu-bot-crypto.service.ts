import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

/** AES-256-GCM 加密载荷 */
interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}

/** 密文三件套（可空组合表示未配置） */
export interface SecretTriple {
  ciphertext: string | null;
  iv: string | null;
  authTag: string | null;
}

/**
 * 飞书机器人凭据加密：
 * - APP Secret / Verification Token / Encrypt Key 以 AES-256-GCM 落库；
 * - 主密钥 FEISHU_BOT_MASTER_KEY 仅存在于环境变量（与 GitHub PAT 主密钥分开）；
 * - 另提供飞书事件 Encrypt Key 的 AES-256-CBC 解密（飞书事件推送协议）。
 */
@Injectable()
export class FeishuBotCryptoService {
  private readonly masterKey: Buffer | null;
  private readonly keyVersion: string;

  constructor(@Optional() config?: ConfigService) {
    const raw = config?.get<string>('FEISHU_BOT_MASTER_KEY')?.trim() || '';
    this.keyVersion =
      config?.get<string>('FEISHU_BOT_MASTER_KEY_VERSION')?.trim() || 'v1';
    this.masterKey = this.parseMasterKey(raw);
  }

  /** 是否已配置主密钥（未配置时禁止保存凭据） */
  get available(): boolean {
    return this.masterKey !== null;
  }

  encrypt(plain: string): EncryptedSecret {
    if (!this.masterKey) {
      throw new BadRequestException(
        '未配置 FEISHU_BOT_MASTER_KEY，不能保存飞书凭据',
      );
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: this.keyVersion,
    };
  }

  decrypt(triple: SecretTriple): string {
    if (!this.masterKey) {
      throw new ForbiddenException('FEISHU_BOT_CREDENTIAL_UNAVAILABLE');
    }
    if (!triple.ciphertext || !triple.iv || !triple.authTag) {
      throw new ForbiddenException('FEISHU_BOT_CREDENTIAL_UNAVAILABLE');
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.masterKey,
        Buffer.from(triple.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(triple.authTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(triple.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ForbiddenException('FEISHU_BOT_CREDENTIAL_UNAVAILABLE');
    }
  }

  /** Verification Token 常量时间比较（避免时序侧信道） */
  safeEqualToken(actual: string | undefined, expected: string): boolean {
    if (!actual) return false;
    const a = Buffer.from(actual, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * 飞书事件解密（AES-256-CBC）：
   * 密文 base64 解码后前 16 字节为 IV，密钥为 SHA256(Encrypt Key) 二进制。
   */
  decryptEventPayload(encryptKey: string, cipherBase64: string): string {
    const data = Buffer.from(cipherBase64, 'base64');
    if (data.length <= 16) {
      throw new BadRequestException('飞书加密事件数据无效');
    }
    const key = createHash('sha256').update(encryptKey, 'utf8').digest();
    const iv = data.subarray(0, 16);
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([
      decipher.update(data.subarray(16)),
      decipher.final(),
    ]).toString('utf8');
  }

  /** 主密钥：64 位 hex（32 字节）或 32 字节原文；配置错误时启动后首次加解密明确失败 */
  private parseMasterKey(raw: string): Buffer | null {
    if (!raw) return null;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    const buffer = Buffer.from(raw, 'utf8');
    if (buffer.length === 32) return buffer;
    throw new Error(
      'FEISHU_BOT_MASTER_KEY 必须是 64 位 hex 或 32 字节原文（AES-256）',
    );
  }
}
