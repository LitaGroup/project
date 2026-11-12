/**
 * SSO 登录衔接 Cookie：authorize 时用户未登录，先把接入方参数暂存此短效 Cookie，
 * 跳转飞书 OAuth 登录成功后据此回跳 /api/sso/authorize 续发授权码。
 * 回跳地址由 Cookie 内容重建，authorize 端点会再次完整校验
 * （client 启用、redirect_uri 白名单、会话），因此 Cookie 被篡改不会造成开放重定向。
 */
export const SSO_CONTEXT_COOKIE = 'pmp_sso_ctx';

/** authorize 暂存的接入方上下文（写入 Cookie 的 JSON 结构） */
export interface SsoAuthorizeContext {
  clientId: string;
  redirectUri: string;
  /** 接入方防 CSRF 参数，原样透传 */
  state: string | null;
}

/**
 * 从暂存 Cookie 重建 /api/sso/authorize 跳转地址。
 * 仅接受字段类型合法的上下文；非法或缺失时返回 null，登录流程照常回首页。
 */
export function ssoResumeUrlFromContext(
  raw: string | undefined,
): string | null {
  if (!raw) return null;
  try {
    const ctx = JSON.parse(raw) as Partial<SsoAuthorizeContext>;
    if (typeof ctx.clientId !== 'string' || !ctx.clientId) return null;
    if (typeof ctx.redirectUri !== 'string' || !ctx.redirectUri) return null;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: ctx.clientId,
      redirect_uri: ctx.redirectUri,
    });
    if (typeof ctx.state === 'string' && ctx.state) {
      params.set('state', ctx.state);
    }
    return `/api/sso/authorize?${params.toString()}`;
  } catch {
    return null;
  }
}
