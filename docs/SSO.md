---
description: "> AI 助手提示：本平台对外提供 OAuth2 授权码模式单点登录。接入方网站按本文档拼接 authorize 地址、换取 access_token 并读取用户信息。"
version: 1.0.0
type: docs
---

# SSO 单点登录接入指南

> AI 助手提示：本平台（Lita Work）作为 OAuth2 授权码模式身份提供方（IdP）。接入方需先由管理员在平台「管理 → SSO 应用」登记，拿到 `client_id` 与 `client_secret` 后按本文档接入。授权码一次性、10 分钟有效；`access_token` 有效期 2 小时。

---

## 一、接入前提

1. 管理员在平台网页「管理 → SSO 应用」新建接入方，登记**名称**与**回调地址白名单**（精确匹配，每行一个）；
2. 新建成功后弹窗一次性展示 `client_id` 与 `client_secret`，**关闭后无法再次查看**，请立即保存到接入方服务端；
3. 密钥泄露可在列表「重置密钥」，旧密钥立即失效。

---

## 二、登录流程

```
接入方网站                     平台（IdP）                    飞书
    │  302 跳转 authorize          │                           │
    │ ─────────────────────────►  │                           │
    │                             │  用户未登录：302 /api/auth/feishu
    │                             │ ─────────────────────────►│  飞书授权
    │                             │ ◄─────────────────────────│  回调平台
    │  302 回 redirect_uri?code&state（已登录则直接发码）       │
    │ ◄─────────────────────────  │                           │
    │  POST /api/sso/token        │                           │
    │ ─────────────────────────►  │  校验 code + client 凭证   │
    │  ◄── access_token ───────── │                           │
    │  GET /api/sso/userinfo      │                           │
    │ ─────────────────────────►  │                           │
    │  ◄── 用户信息 ────────────── │                           │
```

用户在平台已有会话时跳过飞书授权，直接静默发码回跳。

---

## 三、端点参考

以下 `{APP_URL}` 为平台部署地址（生产为 `http://work.cinta.team`，该域名未配置证书，仅提供 http）。

### 3.1 授权端点

```
GET {APP_URL}/api/sso/authorize
  ?response_type=code
  &client_id={client_id}
  &redirect_uri={登记的回调地址，需 URL 编码}
  &state={随机防 CSRF 值，原样回传}
  &scope=（可选，预留参数，当前忽略）
```

- `client_id` 无效、应用停用或 `redirect_uri` 不在白名单时，直接返回 400，**不回跳**（防开放重定向）；
- 校验通过时 302 到 `redirect_uri?code=...&state=...`（回调地址自带 query 时用 `&` 追加）。

### 3.2 令牌端点

```
POST {APP_URL}/api/sso/token
Content-Type: application/x-www-form-urlencoded（或 JSON）

grant_type=authorization_code
code={授权码}
redirect_uri={与发码时一致的回调地址}
client_id={client_id}
client_secret={client_secret}
```

凭证也支持 HTTP Basic（`Authorization: Basic base64(client_id:client_secret)`）。成功响应：

```json
{
  "access_token": "…",
  "token_type": "Bearer",
  "expires_in": 7200
}
```

错误按 OAuth2 标准返回 400 与 `{ "error": "invalid_grant", "error_description": "…" }`，错误码包括 `invalid_request` / `invalid_client` / `invalid_grant` / `unsupported_grant_type`。

### 3.3 用户信息端点

```
GET {APP_URL}/api/sso/userinfo
Authorization: Bearer {access_token}
```

成功响应（`access_token` 无效、过期或用户被禁用时返回 401 与 `invalid_token`）：

```json
{
  "id": 123,
  "name": "张三",
  "avatarUrl": "https://…",
  "email": "zhangsan@example.com",
  "department": "研发部",
  "feishuOpenId": "ou_…",
  "feishuUnionId": "un_…"
}
```

---

## 四、示例

```bash
# 1. 引导用户浏览器打开授权地址（示例）
# http://work.cinta.team/api/sso/authorize?response_type=code&client_id=sso_xxx&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&state=xyz

# 2. 回调拿到 code 后换 access_token
curl -X POST http://work.cinta.team/api/sso/token \
  -d grant_type=authorization_code \
  -d code=返回的code \
  -d "redirect_uri=https://app.example.com/callback" \
  -d client_id=sso_xxx \
  -d client_secret=SECRET

# 3. 读取用户信息
curl http://work.cinta.team/api/sso/userinfo \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

---

## 五、安全说明

- **授权码**：一次性、10 分钟有效，绑定 user / client / redirect_uri 三元组，换 `access_token` 时回调地址必须一致；
- **client_secret**：仅创建/重置时一次性展示，服务端保管，不要放进前端代码或 URL；
- **access_token**：独立 JWT（`typ=sso_access`），与平台网页会话令牌互不通用；2 小时过期后重走授权码即可（用户在平台会话 7 天内静默免登）；
- **state**：接入方必须生成随机值并在回调时校验，防 CSRF；
- 回调地址建议使用 https；平台自身访问地址当前为 http（`http://work.cinta.team`）。

---

**维护人**: Lita R&D Team
