import { loadConfig } from './config.js';
import { runTask } from './runner.js';
import { WsClient } from './ws-client.js';

const config = loadConfig();
const client = new WsClient(config);

// 单任务串行：project 端队列保证同一时间只下发一个任务，agent 侧也加 busy 兜底
let busy = false;

client.onCommand(async (cmd) => {
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
