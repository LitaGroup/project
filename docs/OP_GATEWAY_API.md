---
description: "> AI 助手提示：OP Gateway 必须先携带 Gateway Token 与机器人 Token 调用平台凭证获取接口；接口只对可信 Gateway 开放，响应中的 Token/密码不得转发给 AI、写入日志或缓存超过有效期。"
version: 1.0.0
type: docs
---

# OP Gateway 凭证获取接口

> AI 助手提示：本接口是 OP Gateway 与平台之间的内部控制面接口。AI/普通机器人没有 `X-Gateway-Token`，不能直接调用；返回的凭证只能由 Gateway 在当前操作内使用。

---

## 一、接口定义

```http
POST /api/internal/gateway/v1/credentials/acquire
```

用途：

1. 验证 OP Gateway 服务身份；
2. 通过机器人 `LITA_WORK_TOKEN` 确定真实 `workerId`；
3. 校验机器人对目标资源与操作的权限；
4. 返回本次操作所需凭证；
5. 写入凭证获取审计。

接口约束：

- 仅允许 OP Gateway 调用，不对网页、AI 执行机、普通 `.md` Agent 开放；
- 双 Token 缺一不可；
- 请求与响应均必须走 HTTPS / 内网通道；
- 响应必须带 `Cache-Control: no-store`；
- 平台不记录、不返回 `X-Gateway-Token`、`X-Worker-Token` 和凭证明文。

---

## 二、请求

### 2.1 请求头

| Header | 必填 | 说明 |
|:---|:---:|:---|
| `X-Gateway-Token` | 是 | 平台与 OP Gateway 共享的服务 Token，配置在平台 `OP_GATEWAY_SHARED_TOKEN` |
| `X-Worker-Token` | 是 | 机器人独立令牌，即工位 `LITA_WORK_TOKEN` |
| `X-Request-Id` | 否 | Gateway 生成的请求 ID，用于链路追踪与审计 |
| `Content-Type` | 是 | `application/json` |

### 2.2 请求体

```json
{
  "credentialType": "github.pat",
  "resource": "LitaGroup/repo-a",
  "action": "git.write"
}
```

| 字段 | 类型 | 必填 | 说明 |
|:---|:---|:---:|:---|
| `credentialType` | string | 是 | 凭证类型。第一期仅支持 `github.pat` |
| `resource` | string | 是 | 授权资源。GitHub 仓库为 `owner/name`，可带 `.git` 后缀，平台会归一化为 `owner/name` |
| `action` | string | 是 | 本次准备执行的操作 |

### 2.3 第一期 action 与权限矩阵

| action | `none` | `develop` | `release` |
|:---|:---:|:---:|:---:|
| `git.read` | ✗ | ✓ | ✓ |
| `git.write` | ✗ | ✓ | ✓ |
| `gh.pr.create` | ✗ | ✓ | ✓ |
| `gh.pr.approve` | ✗ | ✗ | ✓ |
| `gh.pr.merge` | ✗ | ✗ | ✓ |

说明：

- `workers.githubPermission` 是唯一权限来源；
- AI 机器人可配置档位仅 `develop` / `release` 两档；`none` 为真人机器人与个人 AGENT 的内部兜底；
- 有权限但没有启用中的 PAT 时返回 `CREDENTIAL_NOT_CONFIGURED`；
- `git.write` 不区分目标分支；`main/stable` 是否可直推由 GitHub Ruleset 根据机器账号最终强制。

---

## 三、成功响应

```json
{
  "leaseId": "lease_01K9x9x9x9x9x9x9x9x9x9",
  "workerId": 1001,
  "credential": {
    "type": "github.pat",
    "data": {
      "host": "github.com",
      "username": "ai-developer",
      "token": "github_pat_xxx"
    }
  },
  "issuedAt": "2026-11-04T10:00:00.000Z",
  "expiresAt": "2026-11-04T10:01:00.000Z"
}
```

| 字段 | 说明 |
|:---|:---|
| `leaseId` | 本次授权租用 ID，用于关联 Gateway 操作与平台审计 |
| `workerId` | `X-Worker-Token` 反查出的机器人 ID |
| `credential.type` | 与请求 `credentialType` 一致 |
| `credential.data.host` | GitHub 服务地址，固定 `github.com` |
| `credential.data.username` | PAT 所属 GitHub 机器账号 |
| `credential.data.token` | 明文 PAT，仅 Gateway 当前请求内存中可用 |
| `issuedAt` / `expiresAt` | 本次授权有效期（秒），不代表 GitHub PAT 自身生命周期 |

默认有效期为 60 秒，平台可用 `GATEWAY_CREDENTIAL_LEASE_SECONDS` 配置，最大 300 秒。第一期平台侧每次请求实时校验权限；Gateway 不应缓存超过 `expiresAt`。

---

## 四、错误响应

```json
{
  "code": "ACTION_FORBIDDEN",
  "message": "当前权限不允许执行 gh.pr.approve",
  "requestId": "req_01K..."
}
```

| HTTP | code | 场景 |
|---:|:---|:---|
| 400 | `INVALID_REQUEST` | 请求体缺失、`resource` 非法、`action` 为空 |
| 400 | `CREDENTIAL_TYPE_UNSUPPORTED` | 凭证类型尚未支持 |
| 401 | `GATEWAY_UNAUTHORIZED` | Gateway Token 缺失/无效，或平台未配置共享 Token |
| 401 | `WORKER_UNAUTHORIZED` | 机器人 Token 缺失/无效或机器人已停用 |
| 403 | `PERMISSION_NONE` | 机器人 GitHub 权限为 `none` |
| 403 | `ACTION_FORBIDDEN` | 当前权限不允许该 action |
| 403 | `CREDENTIAL_NOT_CONFIGURED` | 有权限但未配置启用中的 PAT |
| 403 | `CREDENTIAL_DISABLED` | 凭证已停用 |
| 503 | `CREDENTIAL_UNAVAILABLE` | 凭证解密失败、密钥不可用或服务暂时不可用 |

平台会记录审计：`leaseId`、`workerId`、`credentialId`、`credentialType`、`resource`、`action`、是否允许、拒绝原因、`requestId`。审计与日志不包含任何 Token 或凭证明文。

---

## 五、扩展协议（预留）

接口按 `credentialType` 区分凭证类型，后续可扩展数据库与 Redis。**扩展类型默认不支持，必须平台显式实现并授权后才可使用。**

### 5.1 数据库账号

```json
{
  "credentialType": "postgresql.account",
  "resource": "project-main",
  "action": "database.connect"
}
```

预留响应结构：

```json
{
  "credential": {
    "type": "postgresql.account",
    "data": {
      "host": "postgres.internal",
      "port": 5432,
      "database": "project",
      "username": "task_robot",
      "password": "xxx",
      "sslMode": "require"
    }
  }
}
```

### 5.2 Redis 密码

```json
{
  "credentialType": "redis.auth",
  "resource": "session-cache",
  "action": "redis.connect"
}
```

预留响应结构：

```json
{
  "credential": {
    "type": "redis.auth",
    "data": {
      "host": "redis.internal",
      "port": 6379,
      "database": 0,
      "username": "task_robot",
      "password": "xxx",
      "tls": true
    }
  }
}
```

扩展原则：

1. 数据库、Redis 权限与 GitHub 权限相互独立，默认无权限；
2. 每种类型必须实现独立 Provider，校验自己的 `resource` 与 `action`；
3. 不提供按 Secret 名称任意读取凭证的能力；
4. 凭证返回给 Gateway 不等于允许 Gateway 转发给 AI。

---

## 六、Gateway 使用要求

1. 每次操作前实时调用本接口；第一期不缓存凭证与授权结果。
2. 只在当前请求内存中持有凭证，不写入磁盘、日志、错误信息或 AI 可访问文件。
3. 不把原始响应或 `credential.data` 转发给 AI。
4. 不使用一次授权执行其它 `action`。
5. 4xx 不重试；5xx 可按幂等请求有限重试。
6. 授权失败时不访问上游资源。
7. `main/stable` 直推、PR 审查等约束以 GitHub Ruleset 为最终安全边界。

---

## 七、平台配置

| 环境变量 | 说明 |
|:---|:---|
| `OP_GATEWAY_SHARED_TOKEN` | 平台与 OP Gateway 共享的服务 Token；未配置时接口一律 401 |
| `GITHUB_PAT_MASTER_KEY` | 机器人 GitHub PAT 的 AES-256-GCM 主密钥（64 位 hex 或 32 字节原文） |
| `GITHUB_PAT_MASTER_KEY_VERSION` | 加密密钥版本，默认 `v1` |
| `GATEWAY_CREDENTIAL_LEASE_SECONDS` | 授权有效期，默认 60，最大 300 |

---

## 八、调用示例

成功：

```bash
curl -X POST 'https://platform.internal/api/internal/gateway/v1/credentials/acquire' \
  -H 'X-Gateway-Token: gateway-token' \
  -H 'X-Worker-Token: worker-token' \
  -H 'X-Request-Id: req-123' \
  -H 'Content-Type: application/json' \
  -d '{"credentialType":"github.pat","resource":"LitaGroup/repo-a.git","action":"git.write"}'
```

无权限机器人：

```bash
# HTTP 403
{"code":"PERMISSION_NONE","message":"当前机器人没有 GitHub 权限","requestId":"req-124"}
```

---

**维护人**: Lita R&D Team
