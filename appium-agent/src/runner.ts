import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { AgentConfig } from './config.js';
import { preflightRunTarget } from './apps.js';
import type { TaskCommand } from './ws-client.js';

export interface RunResult {
  durationMs: number;
  exitCode: number;
  error?: string | null;
}

/**
 * 执行一次任务：前置校验（模拟器已启动 + APP 已安装，失败直接返回错误）
 * → 下载脚本 → spawn node 跑脚本（逐行回传 stdout）。
 * APP 包的安装/卸载由 APP 包管理统一处理，任务不携带包、agent 不建 appium session；
 * 脚本经 APPIUM_URL 自行创建/attach session。
 * 任一步异常都返回 error 终态，不抛出（由上层统一上报 done）。
 */
export async function runTask(
  task: TaskCommand,
  config: AgentConfig,
  onLine: (line: string) => void,
): Promise<RunResult> {
  const startedAt = Date.now();
  try {
    // 前置校验：模拟器未启动 / APP 未安装直接失败（错误原因经 done 回传 project）
    await preflightRunTarget(config, task.device, task.appTarget);
    const scriptLocalPath = await downloadScript(task.scriptPath, config);
    // 脚本经环境变量获取 appium 连接信息与运行上下文
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      APPIUM_URL: config.appiumUrl,
      TEST_RUN_ID: String(task.runId),
      APP_VERSION: task.appVersion ?? '',
      APP_PLATFORM: task.device,
    };
    const result = await spawnAndStream(
      scriptLocalPath,
      config.scriptsDir,
      env,
      task.timeout,
      onLine,
    );
    return {
      durationMs: Date.now() - startedAt,
      exitCode: result.exitCode,
      error: result.error ?? null,
    };
  } catch (e) {
    return {
      durationMs: Date.now() - startedAt,
      exitCode: 1,
      error: (e as Error).message,
    };
  }
}

/** 从 project 下载脚本到本地工作目录（带 token 鉴权） */
async function downloadScript(
  scriptPath: string,
  config: AgentConfig,
): Promise<string> {
  const url = `${config.projectApiBase}/api/scripts?path=${encodeURIComponent(scriptPath)}&token=${encodeURIComponent(config.agentToken)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `下载脚本失败: HTTP ${res.status} ${await res.text().catch(() => '')}`,
    );
  }
  const content = await res.text();
  const local = path.resolve(config.scriptsDir, scriptPath);
  await fs.mkdir(path.dirname(local), { recursive: true });
  await fs.writeFile(local, content, 'utf8');
  return local;
}

/** spawn node 跑脚本，逐行回传 stdout；超时 SIGTERM */
function spawnAndStream(
  scriptPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  onLine: (line: string) => void,
): Promise<{ exitCode: number; error?: string | null }> {
  return new Promise((resolve) => {
    let timedOut = false;
    const child = spawn('node', [scriptPath], { cwd, env });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx = buffer.indexOf('\n');
      while (idx >= 0) {
        onLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf('\n');
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buffer.trim()) onLine(buffer);
      resolve({
        exitCode: code ?? 0,
        error: timedOut
          ? `脚本执行超时（>${timeoutMs / 1000}s）`
          : null,
      });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, error: e.message });
    });
  });
}
