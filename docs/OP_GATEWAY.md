---
description: "> AI 助手提示：机器人 GitHub 操作必须经 OP Gateway；权限由 workers.githubPermission 决定，PAT 加密存于平台并由 Gateway 专用接口按需获取。"
version: 1.1.0
type: docs
---

# OP Gateway：机器人 GitHub 权限网关方案

> AI 助手提示：机器人不应尝试读取、导出或绕过 GitHub PAT。所有 GitHub 远端能力由 OP Gateway 代持凭证并按权限授权。

---

## 一、目标与权限模型

机器人 GitHub 权限分两档可配置档位，保存在 `workers.githubPermission`，由机器人配置页维护：

| 权限 | 值 | 能力 |
|:---|:---|:---|
| 开发权限（默认） | `develop` | clone/fetch/pull、创建任务分支、commit、push 普通分支、创建目标为 `main/stable` 的 PR |
| 发布权限 | `release` | 包含开发权限，并可直推 `main/stable`、审批 PR、合并 PR |

`none` 不作为配置项，仅作真人机器人与个人 AGENT 的内部兜底（禁止通过 Gateway 做任何 GitHub 操作）。

规则：

- 新建/存量 AI 机器人与真人机器人默认 `develop`；个人 AGENT 固定 `none`。全部机器人可在管理区「GitHub 权限」页的「机器人」Tab 调整为 `none` / `develop` / `release`。
- 有权限但未配置凭证时同样不可用。
- 权限决定机器人能做什么；PAT 按档位配置（全平台每档一个），机器人使用其归属档位的 PAT。
- 不允许修改仓库 Administration、Secret、Ruleset。

---

## 二、总体架构

```text
AI 执行环境（无 PAT）
        │ git / gh 能力经 OP Gateway
        │ X-Worker-Token = LITA_WORK_TOKEN
        ▼
OP Gateway（数据面）
        │ X-Gateway-Token + X-Worker-Token
        ▼
平台控制面（NestJS）
        ├─ 反查 Worker
        ├─ 读取 workers.githubPermission
        ├─ 校验 resource/action
        ├─ 解密 github_permission_credentials
        └─ 写审计
        ▼
GitHub（Ruleset 最终兜底）
```

第一期平台侧已实现：

- 机器人三态 GitHub 权限；
- GitHub PAT AES-256-GCM 加密存储；
- 管理区「GitHub 权限」凭证配置；
- Gateway 凭证获取接口与审计；
- 机器人初始化把权限与凭证状态写入工位 `AGENTS.md`。

OP Gateway 数据面（clone/fetch/pull/push、真实 `gh` 执行）按本方案另行部署。

---

## 三、数据模型

### 3.1 机器人权限

```text
workers.githubPermission
- none / develop / release
- 默认 develop；none 表示未配置
- 全部机器人（含真人机器人）可在管理区「GitHub 权限」页配置

workers.resourcePermission
- write / read / none
- 默认 none；与 GitHub 权限相互独立
- write 可访问全部资源；read 仅可访问 readOnly 资源
```

### 3.2 凭证

```text
github_permission_credentials
- permission           唯一，全平台仅两条：develop / release，每档一个 PAT
- githubAccount        GitHub 机器账号（保存 PAT 时经 GitHub API 自动识别，可为空）
- patCiphertext        AES-256-GCM 密文（select:false）
- patIv / patAuthTag   GCM IV 与认证标签（select:false）
- keyVersion           密钥版本
- enabled / rotatedAt
```

- PAT 加密密钥：`GITHUB_PAT_MASTER_KEY`，仅平台控制面持有。
- 数据库单独泄露只能得到密文；页面、JSON、`.md`、日志均不回显 PAT。
- 机器人通过其归属档位使用对应 PAT；档位凭证停用或未配置时 Gateway 拒绝授权。
- 第一期不单独维护仓库清单，实际仓库范围由细粒度 PAT 在 GitHub 侧的 Repository access 控制。

### 3.3 审计

```text
gateway_credential_audits
- leaseId / identityType / userId / workerId / credentialId
- credentialType / resource / action
- allowed / denyReason / requestId
```

`identityType` 为 `worker`（机器人）或 `user`（真人）；`userId` 仅真人身份记录，机器人为空。凭证获取仍只向机器人发放，真人尝试会落一条 `identityType=user` 的拒绝审计，便于和机器人区分。

审计不记录 `X-Gateway-Token`、`X-Worker-Token`、PAT。

---

## 四、权限边界

| action | none | develop | release |
|:---|:---:|:---:|:---:|
| `git.read` | ✗ | ✓ | ✓ |
| `git.write` | ✗ | ✓ | ✓ |
| `gh.pr.create` | ✗ | ✓ | ✓ |
| `gh.pr.approve` | ✗ | ✗ | ✓ |
| `gh.pr.merge` | ✗ | ✗ | ✓ |

GitHub 侧仍需配置两类机器账号与 Ruleset：

| 机器账号 | 用途 | Ruleset |
|:---|:---|:---|
| `ai-reader` / 开发身份 | 开发权限机器人 | `main/stable` 禁止直推，必须 PR，不允许 bypass |
| `ai-writer` / 发布身份 | 发布权限机器人 | 允许直推 `main/stable` 或加入 bypass；不得授予 Administration |

两个平台的 `develop/release` 必须与 PAT 所属 GitHub 身份一致；即使配置错误，GitHub Ruleset 仍是最终拒绝边界。

---

## 五、平台接口

### 5.1 Gateway 凭证获取

详见 [OP_GATEWAY_API.md](./OP_GATEWAY_API.md)。

```http
POST /api/internal/gateway/v1/credentials/acquire
X-Gateway-Token: <OP_GATEWAY_SHARED_TOKEN>
X-Worker-Token: <LITA_WORK_TOKEN>
```

- 双 Token 缺一不可；AI 直接调用缺少 Gateway Token 必然 401。
- 每次请求实时校验权限，不缓存授权结果。
- 成功响应包含短有效期 `leaseId` 与凭证明文，只允许 Gateway 当前请求使用。

### 5.2 资源权限验证

```http
POST /api/internal/gateway/v1/resource-permissions/verify
X-Gateway-Token: <OP_GATEWAY_SHARED_TOKEN>
X-Worker-Token: <LITA_WORK_TOKEN 或 个人中心令牌>
```

- 先按 `workers.agentToken` 反查机器人；未命中再按 `users.agentToken` 反查真人（`users.enabled=false` 视为无效）。
- 响应包含 `{ workerId, permission, identityType, userId }`，不返回任何凭证。
- `permission` 为 `write/read/none`，与 `githubPermission` 独立。机器人取 `workers.resourcePermission`；真人按角色映射：管理员 `write`，成员 `read`。
- 真人响应的 `workerId` 是其真人机器人 ID（`workers.humanUserId`），`userId` 才是 `users.id`；机器人 `identityType=worker`、`userId=null`。
- 每次请求实时读取，令牌重置、用户停用、角色或机器人权限变更后立即生效。
- 供 `admin-api` 的 Agent 资源列表与 MySQL SQL 执行前验权使用；接口细节见 [OP_GATEWAY_API.md](./OP_GATEWAY_API.md) 第九节。

### 5.3 管理接口

```text
GET    /api/github-access                    档位凭证清单（仅管理员，固定两条，不含 PAT）
POST   /api/github-access                    配置档位 PAT（仅管理员，body: permission + pat）
DELETE /api/github-access/:permission        删除档位凭证（仅管理员，develop/release）
```

机器人权限通过既有机器人接口维护：

```text
POST /api/workers
PATCH /api/workers/:id
POST /api/workers/:id/update.md
```

字段为 `githubPermission: develop | release`（AI 机器人仅这两档；`none` 为真人/个人 AGENT 内部兜底），以及独立的 `resourcePermission: none | read | write`。

---

## 六、管理区与机器人配置

### 6.1 管理区「GitHub 权限」

路由：`/admin/github-access`。

- 页面主体只有两条记录：开发权限 / 发布权限，每档一个 PAT；
- 操作列「配置」弹窗仅填写 GitHub 细粒度 PAT，重复配置即更换；
- PAT 只写不回显；
- 机器人归属哪个档位在机器人配置页修改，本页不展示机器人列表。

### 6.2 机器人配置页

机器人右侧「基础信息」新增 `GitHub 权限` 与 `资源权限`：

- GitHub 权限默认「开发权限」，可改为「发布权限」或「无权限」；全部机器人（含真人机器人）均可配置。
- 资源权限默认「无权限」，可改为「只读资源」或「全部资源」；与 GitHub 权限独立。
- 保存后触发初始化，工位 `AGENTS.md` 同步更新两类权限说明。

### 6.3 初始化告知

初始化时在进度行展示：

```text
· GitHub 权限：开发权限；凭证：已配置 / 未配置 / 已停用
```

并在初始化指令中要求把固定小节写入工位 `AGENTS.md`：

- `none`：禁止调用 Gateway、clone、push、创建/审批 PR；
- `develop`：列出允许事项，明确禁止直推保护分支和审批/合并；
- `release`：明确可写 `main/stable`、审批与合并，但要求确认符合当前任务；
- 有权限但未配置凭证时明确说明远端 GitHub 操作暂不可用。
- 资源权限 `none`：禁止调用 AI Gateway 资源接口；`read`：仅可访问只读资源；`write`：可访问全部资源，但只读资源仍由数据库只读事务限制。

`AGENTS.md` 中只写权限与使用规则，不写 PAT、密码、Token、密文或 SecretRef。

---

## 七、环境变量

| 变量 | 说明 |
|:---|:---|
| `OP_GATEWAY_SHARED_TOKEN` | 平台与 Gateway 共享服务 Token；未配置时凭证接口一律 401 |
| `GITHUB_PAT_MASTER_KEY` | PAT AES-256-GCM 主密钥（64 位 hex 或 32 字节原文） |
| `GITHUB_PAT_MASTER_KEY_VERSION` | 密钥版本，默认 `v1`，轮换时递增 |
| `GATEWAY_CREDENTIAL_LEASE_SECONDS` | 授权有效期，默认 60，最大 300 |

---

## 八、第一期验收场景

1. 新建 AI 机器人默认 `develop`。
2. 有权限但未配置 PAT：Gateway 返回 `CREDENTIAL_NOT_CONFIGURED`。
3. 权限 `none`：即使配置了 PAT，也返回 `PERMISSION_NONE`。
4. 仅携带 `X-Worker-Token` 直接调用平台：401。
5. Gateway Token + 有效机器人 Token + 已授权操作：返回凭证与 `leaseId`。
6. `develop` 请求审批/合并：`ACTION_FORBIDDEN`。
7. 管理页保存 PAT 后，任何接口响应不出现明文。
8. 机器人删除后凭证同步删除。
9. 初始化 `AGENTS.md` 包含三态权限说明与凭证状态。
10. GitHub Ruleset 拒绝开发身份直推 `main/stable`。

---

## 九、后续扩展

- 接口协议已按 `credentialType/resource/action` 通用化，可扩展 `postgresql.account`、`redis.auth`；
- 资源网关已实现 MySQL 资源发现与 SQL 执行；Redis/Nacos 当前仅支持资源发现，后续再扩展执行；
- 数据库权限默认无权限，必须单独授权；资源密码始终由 admin-api 持有，不转发给 AI；
- SSH Git、Git LFS、任务级授权与 PR 合并流程按原三期计划演进。

---

**维护人**: Lita R&D Team
