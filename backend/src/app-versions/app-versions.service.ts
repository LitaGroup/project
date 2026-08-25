import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppVersion } from './app-version.entity';

export interface AppVersionInput {
  projectId: number;
  /** 平台：ios / android */
  platform: string;
  /** 目标应用：lita / lita lite */
  appTarget: string;
  /** 版本号（如 1.2.3） */
  version: string;
  /** app 包下载地址 */
  downloadUrl: string;
  /** app 包 md5 */
  md5: string;
  remark?: string;
}

@Injectable()
export class AppVersionsService {
  constructor(
    @InjectRepository(AppVersion)
    private readonly appVersions: Repository<AppVersion>,
  ) {}

  /** 按项目列出 APP 版本；不传 projectId 时返回全部 */
  findByProject(projectId?: number): Promise<AppVersion[]> {
    return this.appVersions.find({
      where: projectId === undefined ? {} : { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<AppVersion> {
    const v = await this.appVersions.findOne({ where: { id } });
    if (!v) throw new NotFoundException(`AppVersion ${id} not found`);
    return v;
  }

  create(input: AppVersionInput): Promise<AppVersion> {
    return this.appVersions.save(
      this.appVersions.create({
        ...input,
        remark: input.remark || null,
      }),
    );
  }

  async remove(id: number): Promise<void> {
    const v = await this.findOne(id);
    await this.appVersions.remove(v);
  }

  /** 删除项目时的应用层级联清理（无物理外键，见 AGENTS.md） */
  removeByProject(projectId: number): Promise<void> {
    return this.appVersions.delete({ projectId }).then(() => undefined);
  }
}
