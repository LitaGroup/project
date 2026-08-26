/**
 * APP 包管理：扫描本机配置的包目录（AGENT_APPS_DIR），
 * 经 adb（android）/ xcrun simctl（ios 模拟器）对模拟器做安装/卸载/版本查询。
 * android 包名与包版本经 aapt（Android SDK build-tools）解析 apk 获得。
 *
 * 多模拟器：AGENT_SIMULATORS 声明受管模拟器（名称/平台/产品/序列号/包名），
 * 安装/卸载按包名（apk 解析）或产品+平台（文件名第一段）路由到对应设备；
 * 经平台安装的来源环境（文件名第二段 prod/test…）记入状态文件（AGENT_STATE_FILE），
 * 仅当已装版本与记录一致时才展示环境（手动装/换包显示未知）。
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { AgentConfig, SimulatorConfig } from './config.js';

/** 包目录中的一个安装包 */
export interface AppPackageInfo {
  /** 相对包目录的文件名（如 lita-1.2.3.apk） */
  file: string;
  /** 目标平台（按扩展名推断：.apk → android，.ipa/.app → ios） */
  platform: 'android' | 'ios';
  /** 文件大小（字节） */
  size: number;
  /** 文件修改时间（ISO） */
  updatedAt: string;
  /** 应用包名（apk 经 aapt 解析；ipa 不解析为 null） */
  packageId: string | null;
  /** 包自身版本（versionName / CFBundleShortVersionString） */
  version: string | null;
  /** 对应模拟器内当前已装版本（未安装或查询失败为 null） */
  installedVersion: string | null;
  /** 路由到的模拟器名（未匹配为 null，安装时落回默认设备） */
  simulator: string | null;
}

/** 受管模拟器的实时状态（右侧模拟器面板） */
export interface SimulatorStatus {
  name: string;
  platform: string;
  product: string;
  packageId: string;
  /** 设备在线（adb devices / simctl booted 可见） */
  online: boolean;
  /** 机型（android ro.product.model / ios 设备名；离线或查询失败为 null） */
  model: string | null;
  /** 模拟器内当前已装版本（未安装/离线为 null） */
  installedVersion: string | null;
  /** 已装包的环境（仅平台安装记录与已装版本一致时给出，否则 null） */
  env: string | null;
}

const ADB_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 180_000;

/** 执行外部命令，返回 stdout；非零退出/超时 reject */
function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || stdout || error.message).trim()));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** adb 参数前缀：指定序列号用 -s，否则用 AGENT_ADB_SERIAL 兜底，再否则默认设备 */
function adbArgs(
  config: AgentConfig,
  args: string[],
  serial?: string | null,
): string[] {
  const target = serial ?? config.adbSerial;
  return target ? ['-s', target, ...args] : args;
}

/** 把包目录内的相对文件名解析为绝对路径，拒绝绝对路径与 .. 穿越 */
function resolveInDir(appsDir: string, file: string): string {
  const root = path.resolve(appsDir);
  const p = path.resolve(root, file);
  if (p !== root && !p.startsWith(root + path.sep)) {
    throw new Error(`非法文件路径: ${file}`);
  }
  return p;
}

function platformOf(file: string): 'android' | 'ios' | null {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.apk') return 'android';
  if (ext === '.ipa' || ext === '.app') return 'ios';
  return null;
}

/**
 * 从包文件名解析产品与环境（约定 {产品}.{环境}.{...}.apk，如 lita.prod.2_285_1.apk）。
 * 无环境段时 env 为 null。
 */
export function parsePackageFileName(file: string): {
  product: string;
  env: string | null;
} {
  const stem = file.replace(/\.(apk|ipa|app)$/i, '');
  const segs = stem.split('.');
  if (segs.length < 2) return { product: stem, env: null };
  return { product: segs[0], env: segs[1] };
}

/** 路由：优先按包名匹配模拟器，其次按产品+平台；都不中返回 null（落默认设备） */
function findSimulator(
  config: AgentConfig,
  hint: { packageId?: string | null; product?: string; platform?: string },
): SimulatorConfig | null {
  if (hint.packageId) {
    const byPkg = config.simulators.find((s) => s.packageId === hint.packageId);
    if (byPkg) return byPkg;
  }
  if (hint.product && hint.platform) {
    return (
      config.simulators.find(
        (s) => s.product === hint.product && s.platform === hint.platform,
      ) ?? null
    );
  }
  return null;
}

// ---------- 运行前置校验 ----------

/**
 * 任务执行前置校验：按 platform + appTarget（产品）定位受管模拟器，
 * 模拟器未启动 / APP 未安装时抛错（message 即失败原因，经 done 回传 project）。
 * 返回命中的模拟器配置（可供调用方继续使用 serial/packageId）。
 */
export async function preflightRunTarget(
  config: AgentConfig,
  platform: string,
  appTarget?: string | null,
): Promise<SimulatorConfig> {
  const sim =
    (appTarget
      ? config.simulators.find(
          (s) => s.platform === platform && s.product === appTarget,
        )
      : null) ??
    config.simulators.find((s) => s.platform === platform) ??
    null;
  if (!sim) {
    throw new Error(
      `未配置 ${platform}${appTarget ? `/${appTarget}` : ''} 的受管模拟器（AGENT_SIMULATORS）`,
    );
  }
  if (!(await deviceOnline(sim))) {
    throw new Error(
      `模拟器未启动：${sim.name}（${sim.platform}，${sim.serial}），请先启动模拟器`,
    );
  }
  const installed = await installedVersion(
    config,
    sim.packageId,
    sim.platform,
    sim.serial,
  ).catch(() => null);
  if (!installed) {
    throw new Error(
      `APP 未安装：${sim.packageId}（${sim.name}），请先在 APP 页安装`,
    );
  }
  return sim;
}

// ---------- 平台安装记录（环境判定依据） ----------

/** stateFile 内容：{ "<serial>:<packageId>": { env, version, file, at } } */
type InstallState = Record<
  string,
  { env: string | null; version: string | null; file: string; at: string }
>;

async function loadState(config: AgentConfig): Promise<InstallState> {
  try {
    return JSON.parse(await fs.readFile(config.stateFile, 'utf8'));
  } catch {
    return {};
  }
}

async function saveState(
  config: AgentConfig,
  state: InstallState,
): Promise<void> {
  await fs.mkdir(path.dirname(path.resolve(config.stateFile)), {
    recursive: true,
  });
  await fs.writeFile(config.stateFile, JSON.stringify(state, null, 2), 'utf8');
}

// ---------- aapt（解析 apk 包名/版本） ----------

let cachedAapt: string | null | undefined;

/** 定位 aapt：ANDROID_HOME build-tools 最新版，兜底 PATH 中的 aapt；都没有返回 null */
async function aaptPath(): Promise<string | null> {
  if (cachedAapt !== undefined) return cachedAapt;
  cachedAapt = null;
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (home) {
    try {
      const versions = (await fs.readdir(path.join(home, 'build-tools')))
        .sort()
        .reverse();
      for (const v of versions) {
        const p = path.join(home, 'build-tools', v, 'aapt');
        try {
          await fs.access(p);
          cachedAapt = p;
          break;
        } catch {
          // 继续找下一个版本目录
        }
      }
    } catch {
      // 无 build-tools 目录
    }
  }
  if (!cachedAapt) {
    try {
      await run('aapt', ['version'], 5_000);
      cachedAapt = 'aapt';
    } catch {
      // PATH 中也没有
    }
  }
  return cachedAapt;
}

/** 解析 apk 的包名与版本（aapt dump badging），失败返回 nulls */
async function parseApk(
  apkPath: string,
): Promise<{ packageId: string | null; version: string | null }> {
  const aapt = await aaptPath();
  if (!aapt) return { packageId: null, version: null };
  try {
    const out = await run(aapt, ['dump', 'badging', apkPath], ADB_TIMEOUT_MS);
    const m = out.match(/^package: name='([^']+)'[^\n]*versionName='([^']*)'/m);
    return { packageId: m?.[1] ?? null, version: m?.[2] || null };
  } catch {
    return { packageId: null, version: null };
  }
}

// ---------- 设备与已装版本查询 ----------

/** 设备是否在线（android：adb devices 可见且为 device 状态；ios：simctl booted 列表含该 udid） */
async function deviceOnline(sim: SimulatorConfig): Promise<boolean> {
  try {
    if (sim.platform === 'android') {
      const out = await run('adb', ['devices'], ADB_TIMEOUT_MS);
      return out
        .split('\n')
        .some((l) => l.startsWith(sim.serial) && l.includes('device'));
    }
    const out = await run(
      'xcrun',
      ['simctl', 'list', 'devices', 'booted'],
      ADB_TIMEOUT_MS,
    );
    return out.includes(sim.serial);
  } catch {
    return false;
  }
}

/** 查询模拟器机型：android 读 ro.product.model；ios 取 simctl 设备名（即机型，如 iPhone 16 Pro）。查询失败返回 null */
async function deviceModel(sim: SimulatorConfig): Promise<string | null> {
  try {
    if (sim.platform === 'android') {
      const out = await run(
        'adb',
        ['-s', sim.serial, 'shell', 'getprop', 'ro.product.model'],
        ADB_TIMEOUT_MS,
      );
      return out.trim() || null;
    }
    // ios：simctl 列表中按 udid 找到设备行，机型即设备名（如 "iPhone 16 Pro (UDID) (Booted)"）
    const out = await run('xcrun', ['simctl', 'list', 'devices'], ADB_TIMEOUT_MS);
    const line = out.split('\n').find((l) => l.includes(sim.serial));
    return line?.match(/^\s*(.+?)\s+\(/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** 查询模拟器内已装 app 的版本；未安装返回 null，查询失败抛错 */
export async function installedVersion(
  config: AgentConfig,
  packageId: string,
  platform: string,
  serial?: string | null,
): Promise<string | null> {
  if (platform === 'android') {
    const out = await run(
      'adb',
      adbArgs(config, ['shell', 'dumpsys', 'package', packageId], serial),
      ADB_TIMEOUT_MS,
    );
    if (out.includes('Unable to find package')) return null;
    return out.match(/versionName=(\S+)/)?.[1] ?? null;
  }
  // ios 模拟器：定位已装 app 的 bundle，读 Info.plist 的版本号
  const container = await run(
    'xcrun',
    ['simctl', 'get_app_container', serial ?? 'booted', packageId, 'app'],
    ADB_TIMEOUT_MS,
  ).catch(() => null);
  if (!container) return null; // 未安装
  const plist = path.join(container.trim(), 'Info.plist');
  const out = await run(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print:CFBundleShortVersionString', plist],
    ADB_TIMEOUT_MS,
  );
  return out.trim() || null;
}

// ---------- 包目录扫描 ----------

/** 扫描包目录（仅顶层）下的 .apk/.ipa，附包名/包版本/对应模拟器内已装版本 */
export async function listPackages(
  config: AgentConfig,
): Promise<AppPackageInfo[]> {
  let entries;
  try {
    entries = await fs.readdir(config.appsDir, { withFileTypes: true });
  } catch {
    return []; // 目录不存在视为空
  }
  const result: AppPackageInfo[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const platform = platformOf(e.name);
    if (!platform) continue;
    const full = path.join(config.appsDir, e.name);
    const stat = await fs.stat(full);
    const { product } = parsePackageFileName(e.name);
    let packageId: string | null = null;
    let version: string | null = null;
    if (platform === 'android') {
      ({ packageId, version } = await parseApk(full));
    }
    const sim = findSimulator(config, { packageId, product, platform });
    let installed: string | null = null;
    if (packageId) {
      installed = await installedVersion(
        config,
        packageId,
        platform,
        sim?.serial,
      ).catch(() => null);
    }
    result.push({
      file: e.name,
      platform,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      packageId,
      version,
      installedVersion: installed,
      simulator: sim?.name ?? null,
    });
  }
  result.sort((a, b) => a.file.localeCompare(b.file));
  return result;
}

// ---------- 模拟器状态 ----------

/** 受管模拟器实时状态：在线情况 + 已装版本 + 环境（仅平台安装记录一致时） */
export async function listSimulators(
  config: AgentConfig,
): Promise<SimulatorStatus[]> {
  const state = await loadState(config);
  return Promise.all(
    config.simulators.map(async (sim) => {
      const online = await deviceOnline(sim);
      let model: string | null = null;
      let installed: string | null = null;
      if (online) {
        [model, installed] = await Promise.all([
          deviceModel(sim),
          installedVersion(
            config,
            sim.packageId,
            sim.platform,
            sim.serial,
          ).catch(() => null),
        ]);
      }
      const record = state[`${sim.serial}:${sim.packageId}`];
      // 已装版本与平台安装记录一致时才认为环境可信（手动装/换包则未知）
      const env =
        installed && record && record.version === installed
          ? record.env
          : null;
      return {
        name: sim.name,
        platform: sim.platform,
        product: sim.product,
        packageId: sim.packageId,
        online,
        model,
        installedVersion: installed,
        env,
      };
    }),
  );
}

// ---------- 安装 / 卸载 ----------

/** 安装包目录中的指定包到对应模拟器（按包名/产品路由），并记录来源环境 */
export async function installPackage(
  config: AgentConfig,
  file: string,
): Promise<AppPackageInfo> {
  const platform = platformOf(file);
  if (!platform) throw new Error(`无法识别的安装包类型: ${file}`);
  const full = resolveInDir(config.appsDir, file);
  await fs.access(full); // 不存在则抛错
  const { product, env } = parsePackageFileName(file);
  const { packageId, version } =
    platform === 'android'
      ? await parseApk(full)
      : { packageId: null, version: null };
  const sim = findSimulator(config, { packageId, product, platform });
  const serial = sim?.serial ?? null;
  if (platform === 'android') {
    const out = await run(
      'adb',
      adbArgs(config, ['install', '-r', full], serial),
      INSTALL_TIMEOUT_MS,
    );
    if (!out.includes('Success')) {
      throw new Error(`adb install 失败: ${out.trim()}`);
    }
  } else {
    await run(
      'xcrun',
      ['simctl', 'install', serial ?? 'booted', full],
      INSTALL_TIMEOUT_MS,
    );
  }
  const installed = packageId
    ? await installedVersion(config, packageId, platform, serial).catch(
        () => null,
      )
    : null;
  // 记录平台安装的来源环境（卸载/重装会覆盖）
  if (serial && packageId) {
    const state = await loadState(config);
    state[`${serial}:${packageId}`] = {
      env,
      version: installed ?? version,
      file,
      at: new Date().toISOString(),
    };
    await saveState(config, state).catch(() => undefined);
  }
  const stat = await fs.stat(full);
  return {
    file,
    platform,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    packageId,
    version,
    installedVersion: installed,
    simulator: sim?.name ?? null,
  };
}

/** 从对应模拟器卸载指定包名的 app，并清除平台安装记录 */
export async function uninstallPackage(
  config: AgentConfig,
  packageId: string,
  platform: string,
): Promise<void> {
  const sim = findSimulator(config, { packageId, platform });
  const serial = sim?.serial ?? null;
  if (platform === 'android') {
    const out = await run(
      'adb',
      adbArgs(config, ['uninstall', packageId], serial),
      INSTALL_TIMEOUT_MS,
    );
    if (!out.includes('Success')) {
      throw new Error(`adb uninstall 失败: ${out.trim()}`);
    }
  } else {
    await run(
      'xcrun',
      ['simctl', 'uninstall', serial ?? 'booted', packageId],
      INSTALL_TIMEOUT_MS,
    );
  }
  if (serial) {
    const state = await loadState(config);
    delete state[`${serial}:${packageId}`];
    await saveState(config, state).catch(() => undefined);
  }
}
