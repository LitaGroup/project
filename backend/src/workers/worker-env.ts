/**
 * 工位凭据文件的 shell 写入工具（初始化与派发共用）。
 * 令牌只经服务端拼进 shell 命令落盘，不进入 Prompt、SSE 进度或日志。
 */

/** 单引号包裹 shell 参数（内部单引号按 shell 规则转义） */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** 写入工位 .opencode/agent-token（权限 600） */
export function agentTokenShell(workdir: string, token: string): string {
  const path = `${workdir}/.opencode/agent-token`;
  return (
    `printf '%s' ${shellQuote(token)} > ${shellQuote(path)} && ` +
    `chmod 600 ${shellQuote(path)}`
  );
}

/**
 * 更新工位 .opencode/.env 的指定键（保留其他键，权限 600；文件不存在时创建）。
 * 工位 .env 固定注入两个令牌：
 * - LITA_PROJECT_TOKEN：机器人独立令牌，访问项目平台 .md 接口
 * - LITA_USER_TOKEN：Lita 用户令牌，供 lita-api 等技能使用
 */
export function workerEnvShell(
  workdir: string,
  entries: Record<string, string>,
): string {
  const path = `${workdir}/.opencode/.env`;
  const tmp = `${path}.tmp`;
  const keys = Object.keys(entries);
  if (!keys.length) throw new Error('workerEnvShell 至少需要一个环境变量');
  const filters = keys
    .map(
      (key) =>
        `grep -v ${shellQuote(`^${key}=`)} ${shellQuote(path)} 2>/dev/null`,
    )
    .join(' | ');
  const lines = Object.entries(entries)
    .map(([key, value]) => shellQuote(`${key}=${value}`))
    .join(' ');
  return (
    `{ ${filters}; printf '%s\\n' ${lines}; } > ${shellQuote(tmp)} && ` +
    `chmod 600 ${shellQuote(tmp)} && mv ${shellQuote(tmp)} ${shellQuote(path)}`
  );
}
