import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';

/** appium-agent → project 的消息（agent 上报） */
export type AgentMessage =
  | {
      type: 'ready';
      name: string;
      capabilities: { platform: string[]; appTarget: string[] };
      /** agent 本机 appium server 的内网地址（回环地址已替换为内网 IP），设置页展示用 */
      appiumUrl?: string;
    }
  | { type: 'progress'; runId: number; line: string }
  | {
      type: 'done';
      runId: number;
      /** 脚本执行耗时（ms），agent 端计时 */
      durationMs: number | null;
      /** 脚本退出码（0=正常退出，非0=异常） */
      exitCode: number;
      /** 异常描述（超时/agent 自身错误），正常结束时为 null */
      error?: string | null;
    }
  | {
      /** APP 包操作的响应（对应 project 下发的 app 指令，reqId 关联） */
      type: 'app-result';
      reqId: string;
      ok: boolean;
      /** 操作结果（list→AppPackageInfo[]，install→AppPackageInfo，version→{version}） */
      data?: unknown;
      error?: string;
    }
  | { type: 'heartbeat' };

/** project → appium-agent 的 APP 包操作请求体（requestAppOp 入参，reqId 由网关生成） */
export interface AppOpRequest {
  action: 'list' | 'install' | 'uninstall' | 'version' | 'simulators';
  /** install：包目录内的文件名 */
  file?: string;
  /** uninstall/version：应用包名 */
  packageId?: string;
  /** uninstall/version：android/ios */
  platform?: string;
}

/** project → appium-agent 的消息（下发任务/取消/APP 包操作） */
export type AgentCommand =
  | {
      type: 'task';
      runId: number;
      scriptPath: string;
      /** 运行设备：android/ios（远程执行必为这两者） */
      device: string;
      appVersion?: string;
      downloadUrl?: string;
      md5?: string;
      timeout: number;
    }
  | { type: 'cancel'; runId: number }
  | ({ type: 'app'; reqId: string } & AppOpRequest);

/** 心跳超时阈值（毫秒），超过则判定 agent 离线 */
const HEARTBEAT_TIMEOUT_MS = 30_000;
/** 心跳检查间隔 */
const HEARTBEAT_CHECK_MS = 10_000;
/** APP 包操作默认超时（安装大包可能较慢） */
export const APP_OP_TIMEOUT_MS = 180_000;

/**
 * appium-agent 连接层：管理 WebSocket 连接、鉴权、心跳、消息收发。
 * 单台 agent 场景：只维护一个当前连接。业务调度由 TestsService 负责，
 * 本类只暴露连接状态与收发能力，通过 EventEmitter 把消息/断线事件推给上层。
 */
@Injectable()
export class AgentGateway {
  private readonly logger = new Logger(AgentGateway.name);
  private readonly agentToken: string | null;
  private ws: WebSocket | null = null;
  private agentName: string | null = null;
  private agentAppiumUrl: string | null = null;
  private ready = false;
  private lastSeenAt = 0;
  private readonly bus = new EventEmitter();
  private readonly heartbeatTimer: NodeJS.Timeout;
  /** 在途的 APP 包操作请求（reqId → 应答处理） */
  private readonly pendingAppOps = new Map<
    string,
    {
      resolve: (data: unknown) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(config: ConfigService) {
    this.agentToken = config.get<string>('AGENT_TOKEN') || null;
    this.heartbeatTimer = setInterval(
      () => this.checkHeartbeat(),
      HEARTBEAT_CHECK_MS,
    );
  }

  /** 校验 agent 连接 token（WebSocket 握手时用） */
  isValidToken(token: string | null | undefined): boolean {
    return !!this.agentToken && token === this.agentToken;
  }

  /** agent 是否在线且已就绪（连接 + ready 消息） */
  isOnline(): boolean {
    return (
      this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.ready
    );
  }

  /** 当前 agent 名称（记录执行机来源用） */
  getAgentName(): string | null {
    return this.agentName;
  }

  /** 当前 agent 连接信息（设置页展示用）：离线时 name/appiumUrl 为 null */
  getAgentInfo(): {
    online: boolean;
    name: string | null;
    appiumUrl: string | null;
  } {
    return {
      online: this.isOnline(),
      name: this.agentName,
      appiumUrl: this.agentAppiumUrl,
    };
  }

  /**
   * 把 WebSocket server 挂到 NestJS 的 http server 上（http upgrade，路径 /api/ws）。
   * 放在 /api 前缀下：生产反代只需一条 /api 转发规则即可覆盖（仍需开启 Upgrade 头），
   * agent 直连 ws://host:port/api/ws?token=...
   */
  attachToServer(server: Server): void {
    const wss = new WebSocketServer({ server, path: '/api/ws' });
    wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      if (!this.isValidToken(token)) {
        ws.close(4001, 'invalid token');
        return;
      }
      this.attachConnection(ws);
      ws.on('message', (raw) => {
        let msg: AgentMessage;
        try {
          msg = JSON.parse(
            Buffer.from(raw as Uint8Array).toString('utf8'),
          ) as AgentMessage;
        } catch {
          return;
        }
        this.dispatchMessage(msg);
      });
      ws.on('close', () => {
        // 仅当关闭的是当前连接才视为离线（新连接顶替旧连接时忽略旧 close）
        if (this.ws === ws) this.detachConnection();
      });
      ws.on('error', () => undefined);
    });
  }

  /** 注册新连接：若有旧连接则静默顶替（不触发 disconnect 事件） */
  private attachConnection(ws: WebSocket): void {
    if (this.ws && this.ws !== ws) {
      this.ws.removeAllListeners();
      this.ws.close(4000, 'replaced');
    }
    this.ws = ws;
    this.ready = false;
    this.agentName = null;
    this.agentAppiumUrl = null;
    this.lastSeenAt = Date.now();
  }

  /** 当前连接断开：清状态、失败所有在途 APP 操作、通知上层处理在途任务 */
  private detachConnection(): void {
    const wasReady = this.ready;
    this.ws = null;
    this.agentName = null;
    this.agentAppiumUrl = null;
    this.ready = false;
    for (const [reqId, p] of this.pendingAppOps) {
      clearTimeout(p.timer);
      p.reject(new Error('agent 连接已断开'));
      this.pendingAppOps.delete(reqId);
    }
    if (wasReady) {
      this.logger.warn('agent 已断开');
      this.bus.emit('disconnect');
    }
  }

  /** 收到 agent 消息：心跳直接记，app-result 应答挂起的请求，ready 记 name/capabilities，其余转发上层 */
  private dispatchMessage(msg: AgentMessage): void {
    if (msg.type === 'heartbeat') {
      this.lastSeenAt = Date.now();
      return;
    }
    if (msg.type === 'app-result') {
      this.resolveAppOp(msg);
      return;
    }
    if (msg.type === 'ready') {
      this.agentName = msg.name;
      this.agentAppiumUrl = msg.appiumUrl ?? null;
      this.ready = true;
      this.lastSeenAt = Date.now();
      this.logger.log(`agent 已就绪: ${msg.name}`);
    }
    this.bus.emit('message', msg);
  }

  private checkHeartbeat(): void {
    if (this.ws && Date.now() - this.lastSeenAt > HEARTBEAT_TIMEOUT_MS) {
      this.logger.warn('agent 心跳超时，关闭连接');
      try {
        this.ws.close(4002, 'heartbeat timeout');
      } catch {
        // ignore
      }
    }
  }

  /** 向 agent 下发指令；未连接或未就绪时返回 false */
  send(cmd: AgentCommand): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(cmd));
    return true;
  }

  /** 是否有在途的 APP 包操作（任务派发需避让，见 RemoteRunService.dispatch） */
  hasPendingAppOps(): boolean {
    return this.pendingAppOps.size > 0;
  }

  /**
   * 下发 APP 包操作并等待 agent 应答（请求-响应模式，reqId 关联）。
   * agent 离线/发送失败/超时/断线都会 reject；agent 侧 ok=false 也 reject（message 为 agent 报错）。
   */
  requestAppOp<T>(
    op: AppOpRequest,
    timeoutMs: number = APP_OP_TIMEOUT_MS,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.isOnline()) {
        reject(new Error('appium-agent 离线'));
        return;
      }
      const reqId = randomUUID();
      const timer = setTimeout(() => {
        this.pendingAppOps.delete(reqId);
        reject(new Error(`agent 操作超时（>${timeoutMs / 1000}s）`));
      }, timeoutMs);
      this.pendingAppOps.set(reqId, {
        resolve: (data) => resolve(data as T),
        reject,
        timer,
      });
      const sent = this.send({ type: 'app', reqId, ...op });
      if (!sent) {
        clearTimeout(timer);
        this.pendingAppOps.delete(reqId);
        reject(new Error('appium-agent 离线'));
      }
    });
  }

  /** agent 的 app-result 应答：按 reqId 找到挂起的请求并结算 */
  private resolveAppOp(msg: {
    reqId: string;
    ok: boolean;
    data?: unknown;
    error?: string;
  }): void {
    const p = this.pendingAppOps.get(msg.reqId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pendingAppOps.delete(msg.reqId);
    if (msg.ok) {
      p.resolve(msg.data);
    } else {
      p.reject(new Error(msg.error ?? 'agent 操作失败'));
    }
  }

  /** 订阅 agent 上报消息，返回退订函数 */
  onMessage(handler: (msg: AgentMessage) => void): () => void {
    this.bus.on('message', handler);
    return () => this.bus.off('message', handler);
  }

  /** 订阅 agent 断线事件，返回退订函数 */
  onDisconnect(handler: () => void): () => void {
    this.bus.on('disconnect', handler);
    return () => this.bus.off('disconnect', handler);
  }

  /** 供测试/优雅关闭用 */
  destroy(): void {
    clearInterval(this.heartbeatTimer);
    for (const p of this.pendingAppOps.values()) clearTimeout(p.timer);
    this.pendingAppOps.clear();
    this.bus.removeAllListeners();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
