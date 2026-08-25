import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * 脚本下载：供 appium-agent 远程拉取脚本文件内容（GET /api/scripts?path=）。
 * 复用 CHECK_SCRIPTS_DIR 作为脚本根目录，路径校验与 tests/checks 的 normalizeScriptPath 一致。
 */
@Injectable()
export class ScriptsService {
  private readonly scriptsDir: string;

  constructor(config: ConfigService) {
    this.scriptsDir = path.resolve(
      config.get<string>('CHECK_SCRIPTS_DIR') ??
        path.resolve(process.cwd(), '../scripts'),
    );
  }

  /** 脚本根目录绝对路径（供其它服务复用） */
  getScriptsDir(): string {
    return this.scriptsDir;
  }

  /**
   * 读取脚本文件内容。path 为相对脚本根目录的路径，拒绝绝对路径与目录穿越。
   * 返回 UTF-8 文本（.ts 脚本）。
   */
  async readScript(relPath: string): Promise<string> {
    const normalized = this.normalizePath(relPath);
    const abs = path.resolve(this.scriptsDir, normalized);
    if (!abs.startsWith(this.scriptsDir + path.sep)) {
      throw new BadRequestException('脚本位置不合法');
    }
    try {
      return await fs.readFile(abs, 'utf8');
    } catch {
      throw new NotFoundException(`脚本文件不存在: ${relPath}`);
    }
  }

  /** 只允许相对路径，拒绝绝对路径与目录穿越 */
  private normalizePath(p: string): string {
    const normalized = p.trim().replace(/\\/g, '/');
    if (
      !normalized ||
      path.isAbsolute(normalized) ||
      normalized.split('/').includes('..')
    ) {
      throw new BadRequestException(
        '脚本位置必须是相对脚本根目录的路径，如 rank/daily.test.ts',
      );
    }
    return normalized;
  }
}
