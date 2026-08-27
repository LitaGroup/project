/** 读取环境变量配置（dev 用 --env-file=.env 自动加载） */
import * as os from 'node:os';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

/** 本机内网 IPv4 地址（取第一个非回环地址；未联网时为 null） */
function lanIp(): string | null {
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}

/** appium 地址的内网版：host 为 localhost/127.0.0.1/::1 时替换为本机内网 IP，供局域网内其他机器访问 */
function toLanUrl(url: string): string {
  const ip = lanIp();
  if (!ip) return url;
  return url.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1|\[?::1\]?)/, `$1${ip}`);
}

/** 逗号分隔列表环境变量 */
function optList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 受管应用包声明（AGENT_PACKAGES，JSON 数组）：按平台+产品映射应用包名，前置校验/版本查询/环境判定用 */
export interface AppPackageConfig {
  /** 平台：android/ios */
  platform: string;
  /** 产品（包文件名第一段）：lita/lite */
  product: string;
  /** 应用包名（android package / ios bundleId） */
  packageId: string;
}

/** 解析 AGENT_PACKAGES（JSON 数组），非法时报错并视为未配置 */
function optPackages(): AppPackageConfig[] {
  const raw = process.env.AGENT_PACKAGES;
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as AppPackageConfig[];
    return list.filter((p) => p.platform && p.packageId);
  } catch (e) {
    console.error(`AGENT_PACKAGES 解析失败（须为 JSON 数组）: ${(e as Error).message}`);
    return [];
  }
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
  /** APP 包目录：人工放置的安装包（.apk/.ipa），供平台远程安装/卸载/查询 */
  appsDir: string;
  /** adb 目标设备序列号（多设备时用 -s 指定；为空自动取 adb devices 发现的在线设备） */
  adbSerial: string | null;
  /** 受管应用包列表（AGENT_PACKAGES）：平台+产品 → 包名映射 */
  packages: AppPackageConfig[];
  /** 平台安装记录状态文件（记录每台模拟器经平台安装的环境/版本） */
  stateFile: string;
  /** 能力上报 */
  capabilities: { platform: string[]; appTarget: string[] };
  /** appium server 地址（本机常驻） */
  appiumUrl: string;
  /** appium server 内网地址（host 为回环地址时替换成本机内网 IP），随 ready 上报给 project 展示 */
  appiumLanUrl: string;
}

export function loadConfig(): AgentConfig {
  const projectWsUrl = requireEnv('PROJECT_WS_URL');
  const agentToken = requireEnv('AGENT_TOKEN');
  // ws://host:port/api/ws → http://host:port（兼容旧的 /ws 路径）
  const projectApiBase = projectWsUrl
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace(/\/(api\/)?ws\/?$/, '');
  const appiumUrl = process.env.APPIUM_URL ?? 'http://localhost:4723';
  return {
    projectWsUrl,
    projectApiBase,
    agentToken,
    agentName: process.env.AGENT_NAME ?? 'appium-agent',
    scriptsDir: process.env.AGENT_SCRIPTS_DIR ?? './scripts',
    appsDir: process.env.AGENT_APPS_DIR ?? './apps',
    adbSerial: process.env.AGENT_ADB_SERIAL || null,
    packages: optPackages(),
    stateFile: process.env.AGENT_STATE_FILE ?? './install-state.json',
    capabilities: {
      platform: optList('AGENT_CAPABILITIES_PLATFORM'),
      appTarget: optList('AGENT_CAPABILITIES_TARGET'),
    },
    appiumUrl,
    appiumLanUrl: toLanUrl(appiumUrl),
  };
}
