import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AgentGateway, type AppOpRequest } from './agent.gateway';
import { RemoteRunService } from '../remote-run/remote-run.service';

/** agent 包目录中的一个安装包（与 appium-agent apps.ts 的 AppPackageInfo 对应） */
export interface AgentAppPackage {
  /** 相对包目录的文件名 */
  file: string;
  /** 目标平台（按扩展名推断） */
  platform: 'android' | 'ios';
  /** 文件大小（字节） */
  size: number;
  /** 文件修改时间（ISO） */
  updatedAt: string;
  /** 应用包名（apk 经 aapt 解析；ipa 为 null） */
  packageId: string | null;
  /** 包自身版本 */
  version: string | null;
  /** 对应模拟器内当前已装版本（未安装为 null） */
  installedVersion: string | null;
  /** 路由到的模拟器名（未匹配为 null，安装时落回默认设备） */
  simulator: string | null;
}

/** 受管模拟器的实时状态（与 appium-agent apps.ts 的 SimulatorStatus 对应） */
export interface AgentSimulator {
  /** 展示名（如 Android Lite） */
  name: string;
  /** 平台：android/ios */
  platform: string;
  /** 产品：lita/lite */
  product: string;
  /** 应用包名 */
  packageId: string;
  /** 设备在线 */
  online: boolean;
  /** 机型（android ro.product.model / ios 设备名；离线或查询失败为 null） */
  model: string | null;
  /** 模拟器内当前已装版本（未安装/离线为 null） */
  installedVersion: string | null;
  /** 已装包的环境（仅平台安装记录与已装版本一致时给出，否则 null） */
  env: string | null;
}

class InstallAppDto {
  /** 包目录内的文件名（如 lita-1.2.3.apk） */
  file: string;
}

class UninstallAppDto {
  /** 应用包名 */
  packageId: string;
  /** android / ios */
  platform: string;
}

/**
 * APP 包管理：把操作经 WebSocket 转发给 appium-agent 执行（请求-响应模式）。
 * 与远程任务互斥：有任务在 agent 上执行时拒绝操作（409），
 * 反之 APP 操作期间 RemoteRunService 暂停任务派发，操作完成后 kickDispatch。
 */
@Controller('agent/apps')
export class AgentAppsController {
  constructor(
    private readonly agentGateway: AgentGateway,
    private readonly remoteRun: RemoteRunService,
  ) {}

  /** 互斥前置检查：agent 在线且无任务执行中 */
  private guard(): void {
    if (!this.agentGateway.isOnline()) {
      throw new ServiceUnavailableException('appium-agent 离线');
    }
    if (this.remoteRun.hasActiveRun()) {
      throw new ConflictException('有任务正在执行机上运行，稍后再试');
    }
  }

  /** 下发操作并等待应答：agent 侧报错（adb 失败等）映射为 502 并透传错误信息 */
  private async call<T>(op: AppOpRequest, timeoutMs?: number): Promise<T> {
    try {
      return await this.agentGateway.requestAppOp<T>(op, timeoutMs);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'appium-agent 离线') {
        throw new ServiceUnavailableException(msg);
      }
      throw new BadGatewayException(msg);
    }
  }

  /** 扫描 agent 包目录，返回安装包列表（含模拟器内已装版本） */
  @Get()
  list(): Promise<AgentAppPackage[]> {
    this.guard();
    return this.call<AgentAppPackage[]>({ action: 'list' }, 30_000);
  }

  /** 受管模拟器实时状态：在线情况 + 已装环境/版本（AGENT_SIMULATORS 声明） */
  @Get('simulators')
  simulators(): Promise<AgentSimulator[]> {
    if (!this.agentGateway.isOnline()) {
      throw new ServiceUnavailableException('appium-agent 离线');
    }
    return this.call<AgentSimulator[]>({ action: 'simulators' }, 30_000);
  }

  /** 安装包目录中的指定包到模拟器 */
  @Post('install')
  async install(@Body() dto: InstallAppDto): Promise<AgentAppPackage> {
    this.guard();
    if (!dto.file) throw new BadRequestException('缺少 file 参数');
    try {
      return await this.call<AgentAppPackage>({
        action: 'install',
        file: dto.file,
      });
    } finally {
      this.remoteRun.kickDispatch();
    }
  }

  /** 从模拟器卸载指定包名的 app */
  @Post('uninstall')
  async uninstall(@Body() dto: UninstallAppDto): Promise<{ ok: true }> {
    this.guard();
    if (!dto.packageId || !dto.platform) {
      throw new BadRequestException('缺少 packageId/platform 参数');
    }
    try {
      await this.call({
        action: 'uninstall',
        packageId: dto.packageId,
        platform: dto.platform,
      });
      return { ok: true };
    } finally {
      this.remoteRun.kickDispatch();
    }
  }

  /** 查询模拟器内指定包名的已装版本（未安装返回 version=null） */
  @Get('installed')
  installed(
    @Query('packageId') packageId?: string,
    @Query('platform') platform?: string,
  ): Promise<{ version: string | null }> {
    this.guard();
    if (!packageId || !platform) {
      throw new BadRequestException('缺少 packageId/platform 参数');
    }
    return this.call<{ version: string | null }>(
      { action: 'version', packageId, platform },
      30_000,
    );
  }
}
