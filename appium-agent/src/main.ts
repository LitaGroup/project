import { loadConfig } from './config.js';
import { runTask } from './runner.js';
import {
  installPackage,
  installedVersion,
  listPackages,
  listSimulators,
  uninstallPackage,
} from './apps.js';
import { WsClient, type AppCommand } from './ws-client.js';

const config = loadConfig();
const client = new WsClient(config);

// 单任务串行：project 端队列保证同一时间只下发一个任务，agent 侧也加 busy 兜底
let busy = false;

/** APP 包操作：list/version 只读，install/uninstall 占用 busy 避免与运行中的任务冲突 */
async function handleAppCommand(cmd: AppCommand): Promise<void> {
  const reply = (ok: boolean, data?: unknown, error?: string) =>
    client.send({ type: 'app-result', reqId: cmd.reqId, ok, data, error });
  if (busy) {
    reply(false, undefined, '执行机忙碌中（有任务运行），稍后再试');
    return;
  }
  const lock = cmd.action === 'install' || cmd.action === 'uninstall';
  if (lock) busy = true;
  try {
    switch (cmd.action) {
      case 'list':
        reply(true, await listPackages(config));
        break;
      case 'simulators':
        reply(true, await listSimulators(config));
        break;
      case 'install':
        if (!cmd.file) throw new Error('install 缺少 file 参数');
        reply(true, await installPackage(config, cmd.file));
        break;
      case 'uninstall':
        if (!cmd.packageId || !cmd.platform) {
          throw new Error('uninstall 缺少 packageId/platform 参数');
        }
        await uninstallPackage(config, cmd.packageId, cmd.platform);
        reply(true, {});
        break;
      case 'version':
        if (!cmd.packageId || !cmd.platform) {
          throw new Error('version 缺少 packageId/platform 参数');
        }
        reply(true, {
          version: await installedVersion(config, cmd.packageId, cmd.platform),
        });
        break;
    }
  } catch (e) {
    reply(false, undefined, (e as Error).message);
  } finally {
    if (lock) busy = false;
  }
}

client.onCommand(async (cmd) => {
  if (cmd.type === 'app') {
    await handleAppCommand(cmd);
    return;
  }
  if (cmd.type !== 'task') {
    // cancel：单任务串行暂不支持中断，project 端超时会标 error 并发 cancel（此处忽略）
    return;
  }
  if (busy) return;
  busy = true;
  try {
    const result = await runTask(cmd, config, (line) => {
      client.send({ type: 'progress', runId: cmd.runId, line });
    });
    client.send({
      type: 'done',
      runId: cmd.runId,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      error: result.error ?? null,
    });
  } catch (e) {
    client.send({
      type: 'done',
      runId: cmd.runId,
      durationMs: 0,
      exitCode: 1,
      error: (e as Error).message,
    });
  } finally {
    busy = false;
  }
});

client.connect();
console.log(`appium-agent 启动，连接 ${config.projectWsUrl}（appium ${config.appiumUrl}）`);
