/** 读取环境变量配置（dev 用 --env-file=.env 自动加载） */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

/** 逗号分隔列表环境变量 */
function optList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface AgentConfig {
  /** project 中心服务 WebSocket 地址 */
  projectWsUrl: string;
  /** project HTTP 基地址（下载脚本用，从 ws url 推导） */
  projectApiBase: string;
  /** 鉴权 token（与 project AGENT_TOKEN 一致） */
  agentToken: string;
  /** 本机标识 */
  agentName: string;
  /** 脚本本地工作目录（下载的脚本放此，须预装 node_modules） */
  scriptsDir: string;
  /** app 包缓存目录（按 md5 命名） */
  appCacheDir: string;
  /** 能力上报 */
  capabilities: { platform: string[]; appTarget: string[] };
  /** appium server 地址（本机常驻） */
  appiumUrl: string;
}

export function loadConfig(): AgentConfig {
  const projectWsUrl = requireEnv('PROJECT_WS_URL');
  const agentToken = requireEnv('AGENT_TOKEN');
  // ws://host:port/ws → http://host:port
  const projectApiBase = projectWsUrl
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace(/\/ws\/?$/, '');
  return {
    projectWsUrl,
    projectApiBase,
    agentToken,
    agentName: process.env.AGENT_NAME ?? 'appium-agent',
    scriptsDir: process.env.AGENT_SCRIPTS_DIR ?? './scripts',
    appCacheDir: process.env.AGENT_APP_CACHE_DIR ?? './app-cache',
    capabilities: {
      platform: optList('AGENT_CAPABILITIES_PLATFORM'),
      appTarget: optList('AGENT_CAPABILITIES_TARGET'),
    },
    appiumUrl: process.env.APPIUM_URL ?? 'http://localhost:4723',
  };
}
