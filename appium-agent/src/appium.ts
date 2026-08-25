/**
 * appium session 管理：通过 appium REST API 创建/关闭 session。
 * 创建时传 app 包路径，appium 自动安装+启动 app（Android UiAutomator2 / iOS XCUITest）。
 * appium server 须在本机常驻（开机自启或手动启动）。
 */

export interface AppiumSession {
  sessionId: string;
  appiumUrl: string;
}

interface AppiumResponse {
  value?: {
    sessionId?: string;
    error?: string;
    message?: string;
  };
  sessionId?: string;
}

/** 创建 appium session：安装+启动 app，返回 session id 供脚本 attach */
export async function createSession(
  appiumUrl: string,
  device: string,
  appPath: string,
): Promise<AppiumSession> {
  const isAndroid = device === 'android';
  const body = {
    capabilities: {
      alwaysMatch: {
        platformName: isAndroid ? 'Android' : 'iOS',
        'appium:automationName': isAndroid ? 'UiAutomator2' : 'XCUITest',
        'appium:app': appPath,
        // 每次装新包（下载的可能是新版本）
        'appium:noReset': false,
        // 长任务：单条 appium 指令超时放宽
        'appium:newCommandTimeout': 600,
      },
      firstMatch: [{}],
    },
  };
  const res = await fetch(`${appiumUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as AppiumResponse | null;
  const sessionId = data?.value?.sessionId ?? data?.sessionId ?? null;
  if (!sessionId) {
    throw new Error(
      `appium 创建 session 失败: ${data?.value?.error ?? `HTTP ${res.status}`}`,
    );
  }
  return { sessionId, appiumUrl };
}

/** 关闭 session：让 appium 清理 driver/模拟器会话（失败忽略） */
export async function closeSession(session: AppiumSession): Promise<void> {
  await fetch(`${session.appiumUrl}/session/${session.sessionId}`, {
    method: 'DELETE',
  }).catch(() => undefined);
}
