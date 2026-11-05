import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { Repository } from 'typeorm';
import { WorkerGithubPermission } from '../common/enums';
import {
  GithubCredentialStatus,
  GithubPermissionCredential,
} from '../github-gateway/github-permission-credential.entity';

/** 管理页可见的档位凭证配置（不含任何密文与 PAT） */
export interface GithubPermissionCredentialView {
  permission: WorkerGithubPermission;
  configured: boolean;
  githubAccount: string | null;
  enabled: boolean;
  rotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 管理页保存输入：PAT 只写不读 */
export interface SaveGithubPermissionCredentialInput {
  permission: WorkerGithubPermission;
  pat?: string | null;
  enabled?: boolean;
}

/** AES-256-GCM 加密后的 PAT 载荷 */
interface EncryptedPat {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}

const CONFIGURABLE_PERMISSIONS: WorkerGithubPermission[] = [
  WorkerGithubPermission.DEVELOP,
  WorkerGithubPermission.RELEASE,
];

/**
 * 权限档位 GitHub PAT 凭证存储：全平台仅 开发权限 / 发布权限 两条记录。
 * 数据库只保存 AES-256-GCM 密文，主密钥仅存在于平台控制面环境变量；
 * 唯一返回明文 PAT 的调用方是 OP Gateway 专用内部接口。
 */
@Injectable()
export class GithubPermissionCredentialService {
  private readonly masterKey: Buffer | null;
  private readonly keyVersion: string;

  constructor(
    @InjectRepository(GithubPermissionCredential)
    private readonly credentials: Repository<GithubPermissionCredential>,
    @Optional()
    private readonly config?: ConfigService,
  ) {
    const raw = this.config?.get<string>('GITHUB_PAT_MASTER_KEY')?.trim() || '';
    this.keyVersion =
      this.config?.get<string>('GITHUB_PAT_MASTER_KEY_VERSION')?.trim() || 'v1';
    this.masterKey = this.parseMasterKey(raw);
  }

  /** 管理页清单：固定返回 开发权限 / 发布权限 两条记录，不含 PAT 与密文 */
  async list(): Promise<GithubPermissionCredentialView[]> {
    const rows = await this.credentials.find({
      where: CONFIGURABLE_PERMISSIONS.map((permission) => ({ permission })),
    });
    const byPermission = new Map(
      rows.map((row) => [row.permission, row] as const),
    );
    return CONFIGURABLE_PERMISSIONS.map((permission) => {
      const row = byPermission.get(permission);
      return {
        permission,
        configured: Boolean(row),
        githubAccount: row?.githubAccount ?? null,
        enabled: Boolean(row?.enabled),
        rotatedAt: row?.rotatedAt?.toISOString() ?? null,
        createdAt: row?.createdAt.toISOString() ?? new Date(0).toISOString(),
        updatedAt: row?.updatedAt.toISOString() ?? new Date(0).toISOString(),
      };
    });
  }

  /** 保存/更新档位凭证：新建必须提供 PAT；已配置时传入新 PAT 即更换 */
  async save(input: SaveGithubPermissionCredentialInput): Promise<void> {
    const permission = this.assertPermission(input.permission);
    const existing = await this.findByPermission(permission);
    const pat = input.pat?.trim();
    if (!existing && !pat) {
      throw new BadRequestException('首次配置必须填写 GitHub PAT');
    }
    if (pat && !this.masterKey) {
      throw new BadRequestException(
        '未配置 GITHUB_PAT_MASTER_KEY，不能保存 GitHub PAT',
      );
    }

    const enabled = input.enabled ?? existing?.enabled ?? true;
    const patch: Partial<GithubPermissionCredential> = {
      permission,
      enabled,
    };
    if (pat) {
      const encrypted = this.encrypt(pat);
      patch.githubAccount = await this.resolveGithubAccount(pat);
      patch.patCiphertext = encrypted.ciphertext;
      patch.patIv = encrypted.iv;
      patch.patAuthTag = encrypted.authTag;
      patch.keyVersion = encrypted.keyVersion;
      patch.rotatedAt = new Date();
    }
    if (existing) {
      await this.credentials.update({ id: existing.id }, patch);
      return;
    }
    await this.credentials.save(
      this.credentials.create({
        ...patch,
        githubAccount: patch.githubAccount ?? null,
        patCiphertext: patch.patCiphertext ?? '',
        patIv: patch.patIv ?? '',
        patAuthTag: patch.patAuthTag ?? '',
        keyVersion: patch.keyVersion ?? this.keyVersion,
        rotatedAt: patch.rotatedAt ?? new Date(),
      }),
    );
  }

  /** 删除档位凭证（不影响机器人权限归属） */
  async remove(permission: WorkerGithubPermission): Promise<void> {
    this.assertPermission(permission);
    const existing = await this.findByPermission(permission);
    if (!existing) throw new NotFoundException('该权限尚未配置 GitHub 凭证');
    await this.credentials.delete({ id: existing.id });
  }

  /** 档位凭证状态（不含 PAT） */
  async statusOf(
    permission: WorkerGithubPermission,
  ): Promise<GithubCredentialStatus> {
    if (!CONFIGURABLE_PERMISSIONS.includes(permission)) {
      return {
        configured: false,
        enabled: false,
        githubAccount: null,
        rotatedAt: null,
      };
    }
    const row = await this.credentials.findOne({
      where: { permission },
      select: {
        id: true,
        permission: true,
        githubAccount: true,
        enabled: true,
        rotatedAt: true,
      },
    });
    return {
      configured: Boolean(row),
      enabled: Boolean(row?.enabled),
      githubAccount: row?.githubAccount ?? null,
      rotatedAt: row?.rotatedAt?.toISOString() ?? null,
    };
  }

  /** 仅 Gateway 内部接口使用：解密启用中的档位 PAT */
  async decryptEnabledPat(permission: WorkerGithubPermission): Promise<{
    credentialId: number;
    githubAccount: string | null;
    pat: string;
  }> {
    const row = await this.findByPermission(permission);
    if (!row) {
      throw new ForbiddenException('GITHUB_CREDENTIAL_NOT_CONFIGURED');
    }
    if (!row.enabled) {
      throw new ForbiddenException('CREDENTIAL_DISABLED');
    }
    return {
      credentialId: row.id,
      githubAccount: row.githubAccount,
      pat: this.decrypt(row),
    };
  }

  /** 管理接口用：仅管理员可维护凭证 */
  assertAdmin(role: string | undefined): void {
    if (role !== '管理员') {
      throw new ForbiddenException('仅管理员可管理 GitHub 凭证');
    }
  }

  /** 服务 Token 常量时间比较（Gateway 内部接口使用） */
  static safeEqual(actual: string, expected: string): boolean {
    const a = Buffer.from(actual, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** 档位合法性：仅 开发权限 / 发布权限 可配置凭证 */
  private assertPermission(permission: unknown): WorkerGithubPermission {
    if (
      permission === WorkerGithubPermission.DEVELOP ||
      permission === WorkerGithubPermission.RELEASE
    ) {
      return permission;
    }
    throw new BadRequestException(
      'permission 仅支持 develop（开发权限）/ release（发布权限）',
    );
  }

  private async findByPermission(
    permission: WorkerGithubPermission,
  ): Promise<GithubPermissionCredential | null> {
    return this.credentials
      .createQueryBuilder('credential')
      .addSelect([
        'credential.patCiphertext',
        'credential.patIv',
        'credential.patAuthTag',
        'credential.keyVersion',
      ])
      .where('credential.permission = :permission', { permission })
      .getOne();
  }

  /** 保存 PAT 时自动识别所属 GitHub 账号；失败不阻断（账号仅展示用） */
  private async resolveGithubAccount(pat: string): Promise<string | null> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { login?: unknown };
      return typeof data.login === 'string' && data.login
        ? data.login.slice(0, 100)
        : null;
    } catch {
      return null;
    }
  }

  private encrypt(pat: string): EncryptedPat {
    if (!this.masterKey) {
      throw new BadRequestException(
        '未配置 GITHUB_PAT_MASTER_KEY，不能保存 GitHub PAT',
      );
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(pat, 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: this.keyVersion,
    };
  }

  private decrypt(row: GithubPermissionCredential): string {
    if (!this.masterKey) {
      throw new ForbiddenException('CREDENTIAL_UNAVAILABLE');
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.masterKey,
        Buffer.from(row.patIv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(row.patAuthTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(row.patCiphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ForbiddenException('CREDENTIAL_UNAVAILABLE');
    }
  }

  /** 主密钥：64 位 hex（32 字节）或 32 字节原文；配置错误时启动后首次加解密明确失败 */
  private parseMasterKey(raw: string): Buffer | null {
    if (!raw) return null;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    const buffer = Buffer.from(raw, 'utf8');
    if (buffer.length === 32) return buffer;
    throw new Error(
      'GITHUB_PAT_MASTER_KEY 必须是 64 位 hex 或 32 字节原文（AES-256）',
    );
  }
}
