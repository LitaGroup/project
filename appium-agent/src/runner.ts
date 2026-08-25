import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { AgentConfig } from './config.js';
import { closeSession, createSession, type AppiumSession } from './appium.js';
import type { TaskCommand } from './ws-client.js';

export interface RunResult {
  durationMs: number;
  exitCode: number;
  error?: string | null;
}

/**
 * 执行一次任务：下载脚本 → 下载+校验 app → 创建 appium session（装+开 app）
 * → spawn node 跑脚本（逐行回传 stdout）→ 关闭 session。
 * 任一步异常都返回 error 终态，不抛出（由上层统一上报 done）。
 */
export async function runTask(
  task: TaskCommand,
  config: AgentConfig,
  onLine: (line: string) => void,
): Promise<RunResult> {
  const startedAt = Date.now();
  let session: AppiumSession | null = null;
  try {
    const scriptLocalPath = await downloadScript(task.scriptPath, config);
    let appPath: string | null = null;
    if (task.downloadUrl && task.md5) {
      appPath = await downloadApp(
        task.downloadUrl,
        task.md5,
        task.device,
        config,
      );
    }
    // 创建 appium session（装+开 app）
    if (appPath) {
      session = await createSession(config.appiumUrl, task.device, appPath);
    }
    // 脚本经环境变量获取 appium 连接信息，用 appium client attach session 执行用例
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      APPIUM_URL: config.appiumUrl,
      APPIUM_SESSION_ID: session?.sessionId ?? '',
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
  } finally {
    if (session) await closeSession(session).catch(() => undefined);
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

/** 下载 app 包，按 md5 校验并缓存（同包不重复下载） */
async function downloadApp(
  downloadUrl: string,
  md5: string,
  platform: string,
  config: AgentConfig,
): Promise<string> {
  const ext = platform === 'android' ? '.apk' : '.ipa';
  const cachePath = path.join(config.appCacheDir, `${md5}${ext}`);
  try {
    await fs.access(cachePath);
    return cachePath; // 缓存命中
  } catch {
    // 未缓存，继续下载
  }
  await fs.mkdir(config.appCacheDir, { recursive: true });
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`下载 app 失败: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = createHash('md5').update(buf).digest('hex');
  if (hash !== md5) {
    throw new Error(`app md5 校验失败: 实际 ${hash}，期望 ${md5}`);
  }
  await fs.writeFile(cachePath, buf);
  return cachePath;
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
