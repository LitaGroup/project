import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import type { AgentConfig } from './config.js';

/** project → agent 下发的任务指令 */
export interface TaskCommand {
  type: 'task';
  runId: number;
  scriptPath: string;
  /** 运行设备：android/ios */
  device: string;
  /** 目标 APP：lita/lite 等（前置校验定位受管模拟器用；无则按 platform 匹配） */
  appTarget?: string | null;
  /** APP 版本号（注入脚本环境变量 APP_VERSION；包安装走 APP 包管理，任务不携带包） */
  appVersion?: string;
  timeout: number;
}

/** project → agent 下发的取消指令 */
export interface CancelCommand {
  type: 'cancel';
  runId: number;
}

/**
 * project → agent 下发的 APP 包操作指令（请求-响应模式，reqId 关联）。
 * 响应为 { type:'app-result', reqId, ok, data?, error? }。
 */
export interface AppCommand {
  type: 'app';
  reqId: string;
  action: 'list' | 'install' | 'uninstall' | 'version' | 'simulators';
  /** install：包目录内的文件名（如 lita-1.2.3.apk） */
  file?: string;
  /** uninstall/version：应用包名 */
  packageId?: string;
  /** uninstall/version：android/ios */
  platform?: string;
}

export type Command = TaskCommand | CancelCommand | AppCommand;

const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * WebSocket client：连 project 中心服务，定时心跳，断线指数退避重连。
 * 收到指令通过 EventEmitter 转发给上层（runner）。
 */
export class WsClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1_000;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private readonly bus = new EventEmitter();

  constructor(private readonly config: AgentConfig) {}

  connect(): void {
    const url = `${this.config.projectWsUrl}?token=${encodeURIComponent(this.config.agentToken)}`;
    this.ws = new WebSocket(url);
    this.ws.on('open', () => {
      this.reconnectDelay = 1_000;
      this.startHeartbeat();
      this.send({
        type: 'ready',
        name: this.config.agentName,
        capabilities: this.config.capabilities,
        appiumUrl: this.config.appiumLanUrl,
      });
    });
    this.ws.on('message', (raw) => {
      try {
        const cmd = JSON.parse(raw.toString()) as Command;
        this.bus.emit('command', cmd);
      } catch {
        // 忽略无法解析的消息
      }
    });
    this.ws.on('close', () => this.scheduleReconnect());
    this.ws.on('error', () => undefined);
  }

  /** 向 project 发消息（progress/done/heartbeat） */
  send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onCommand(handler: (cmd: Command) => void): void {
    this.bus.on('command', handler);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(
      () => this.send({ type: 'heartbeat' }),
      HEARTBEAT_INTERVAL_MS,
    );
  }

  private scheduleReconnect(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    setTimeout(() => this.connect(), delay);
  }
}
