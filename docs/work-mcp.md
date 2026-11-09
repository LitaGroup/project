# MCP 接入指南：lita-work 平台工具

平台把原 **lita-work / knowledge-search / file-upload** 三个 Agent 技能（`.md` HTTP 端点）改造成 MCP 服务 **`lita-work`**：外部 Agent（opencode / Claude Code / Cursor 等）完成一次配置后，即可直接调用带 schema 的平台工具——项目、文档、知识库、脚本运行、缺陷/提测、代码分支、文件上传等。

- 服务地址：`POST /api/mcp/work`（MCP Streamable HTTP，响应为 SSE 流）
- 鉴权：平台 Agent 访问令牌（`Authorization: Bearer` / `X-Agent-Token` / `?token=`）或机器人独立令牌（`X-Worker-Token`），与 `.md` 端点同一令牌体系
- 与 `lita-bots`（`POST /api/mcp/bots`，把平台机器人当子 Agent 调用）相互独立，可同时接入

> 原 SKILL.md 技能（`/SKILL.md`、`/knowledge/SKILL.md`、`/file-upload/SKILL.md`）已标记废弃，端点保留过渡；任务协同、工单与机器人管理能力的 MCP 版本在二期提供。

---

## 一、准备工作：获取访问令牌

**方式一：个人令牌（推荐）**

1. 登录平台网页 → 右上角头像 → **个人中心**；
2. 在「Agent 访问令牌」卡片复制令牌（48 位随机字符串，尚未生成会自动发放）；
3. 令牌泄露可在该卡片 **重置**，旧令牌立即失效（重置后需同步更新外部 Agent 配置）。

**方式二：公共 Agent 令牌（管理员下发）**

平台管理员通过后端环境变量 `PUBLIC_AGENT_TOKEN` 下发，供多个公共 Agent 共用，**权限与管理员等同**；未配置时不可用。

**方式三：机器人独立令牌**

机器人可在自己的工位使用 `.opencode/agent-token`（或 `.opencode/.env` 的 `LITA_WORK_TOKEN`）作为 `X-Worker-Token` 调用；平台按机器人身份记录操作人并校验执行方/需求方权限。

```bash
# ~/.env（与技能同一变量）
LITA_WORK_TOKEN=<你的访问令牌>
```

> 过渡期旧名 `LITA_PROJECT_TOKEN` 仍可用，**新名优先**。

## 二、接入配置

### opencode（推荐）

平台机器人已在工位自动注入该配置（`.opencode/opencode.json`），外部机器可手动添加：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "lita-work": {
        "type": "remote",
        "url": "http://your-host:3100/api/mcp/work",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {env:LITA_WORK_TOKEN}"
        }
      }
    }
  }
}
```

`{env:LITA_WORK_TOKEN}` 由 opencode 从本机环境变量展开；也可直接写入实际令牌（注意文件权限）。生产环境把 URL 换成平台域名。

### Claude Code

```bash
claude mcp add --transport http lita-work http://your-host:3100/api/mcp/work \
  --header "Authorization: Bearer ${LITA_WORK_TOKEN}"
```

### Cursor / 其它 MCP 客户端

| 参数 | 值 |
|---|---|
| 传输类型 | Streamable HTTP（streamable-http / http） |
| URL | `http://your-host:3100/api/mcp/work`（生产为平台域名） |
| 鉴权头 | `Authorization: Bearer ${LITA_WORK_TOKEN}`（也接受 `X-Agent-Token` / `X-Worker-Token` 头） |
| URL 参数兜底 | `?token=<令牌>`（三选一即可） |

## 三、工具清单（一期）

### 项目 / 文档 / 资源 / 节点

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `search_projects` | `query` | 按名称模糊搜索项目，返回前 5 个 |
| `get_project` | `projectId` | 项目完整详情（文档/资源/节点/检查/用例/导出/定时任务/提测/缺陷与最近运行结果） |
| `update_project` | `projectId`、`scriptsPath?`、`feishuWebhook?`、`description?`、`resources?` | 仅更新平台本地字段（脚本目录/通知群/描述/人员） |
| `read_document` | `documentId` | 文档元信息 + Markdown 正文 |
| `upsert_document` | `projectId`、`fileName`、`content`、`title?`、`type?`、`description?` | 按 `(projectId, fileName)` upsert |
| `sync_apipost_document` | `projectId`、`url`、`type?` | 导入 APIPOST 接口文档 |
| `list_resources` | `projectId?`、`includeDeleted?` | 资源清单 |
| `read_resource` | `resourceId` | 资源详情（配置/多语言/其它） |
| `sync_resource` | `resourceId` | 重新同步配置文档或多语言文案 |
| `list_milestones` | `projectId?` | 节点清单（附推导状态） |
| `create_milestone` | `projectId`、`date`、`content`、`remark?`、`deliverer?`、`acceptor?` | 登记节点 |
| `update_milestone` | `milestoneId`、…、`achieved?` | 更新节点；`achieved=yes` 验收达成 |
| `delete_milestone` | `milestoneId` | 删除节点 |

### 运行 / 脚本 / 设置

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `run_check` | `checkId`、`timeout_seconds?` | 运行检查，输出经 progress 流式推送 |
| `run_test` | `testId`、`appVersionId?`、`timeout_seconds?` | 运行用例 |
| `run_export` | `exportId`、`timeout_seconds?` | 运行导出（终态含产物下载链接） |
| `run_schedule` | `scheduleId`、`timeout_seconds?` | 手动触发定时任务 |
| `get_run` | `kind`（check/test/export）、`runId` | 查询运行详情与输出 |
| `list_runs` | `kind`（check/test/export/schedule）、`targetId` | 运行历史（倒序，上限 50） |
| `import_scripts` | `projectId` | 导入项目脚本目录下的新脚本 |
| `get_settings` | — | 平台设置概览 |
| `pull_scripts` | — | 更新脚本仓库（git 输出流式推送） |

### 知识库

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `search_knowledge` | `query`、`path?`、`page?`、`pageSize?` | 全文 + 向量混合检索（RAG） |
| `list_knowledge_dir` | `path?` | 浏览目录（子目录 + 文章） |
| `read_knowledge` | `path` | 读取文章全文（含项目/任务文档镜像，只读） |
| `create_knowledge` | `kind`、`parentPath?`、`name`、`title?`、`content?` | 创建文章或目录 |
| `update_knowledge` | `path`、`title?`、`content?`、`name?`、`parentPath?` | 更新 / 移动 / 重命名 |
| `delete_knowledge` | `path`、`recursive?` | 删除（非空目录需 `recursive=true`） |
| `read_feishu_doc` | `url` | 飞书文档转 Markdown（不落库） |

### 缺陷 / 提测

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `list_defects` | `projectId?`、`releaseId?`、`status?`、`priority?`、`q?` | 缺陷清单 Markdown 表格 |
| `get_defect` | `defectId` | 缺陷详情与变更记录 |
| `create_defect` | `projectId`、`expected`、`actual`、`platform?`、`priority?`、`images?`、`testScript?`、`releaseId?` | 创建缺陷（默认按最新有效机器人提测自动关联派单） |
| `update_defect` | `defectId`、字段…、`changeContent?`、`changeRemark?` | 更新缺陷字段 |
| `change_defect_status` | `defectId`、`status`、`remark?` | 专用状态流转（开放/修复/关闭） |
| `add_defect_record` | `defectId`、`content`、`remark?` | 追加变更记录 |
| `delete_defect` | `defectId` | 删除缺陷 |
| `list_releases` | `projectId?` | 提测记录清单 |
| `submit_release` | `projectId`、`testers`、`content?`、`urls?`、`branches?`、`taskId?` | 发起提测（项目流转「测试中」） |
| `update_release_status` | `releaseId`、`status` | 判定提测结果 |

### GitHub / 文件

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `search_github_repos` | `q?` | 组织下仓库搜索 |
| `list_github_branches` | `repo` | 仓库分支联想 |
| `list_code_branches` | `projectId?` | 代码分支登记清单 |
| `register_code_branch` | `projectId`、`repo`、`branch`、`category?`、`remark?` | 登记代码分支（自动监听提交） |
| `update_code_branch` | `id`、字段… | 更新登记 |
| `delete_code_branch` | `id` | 删除登记 |
| `list_code_events` | `projectId?`、`repo?`、`branch?`、`q?`、`limit?` | 提交记录清单 |
| `upload_file` | `filename`、`content_base64`、`mime_type?` | 上传文件（≤50MB），返回公共 URL |

> MCP 无 multipart：`upload_file` 用 base64 传内容，可带 `data:<mime>;base64,` 前缀。

## 四、流式进度与超时

- 运行类与 `pull_scripts` 工具在客户端携带 `_meta.progressToken` 时（opencode / Claude Code 默认行为），经 `notifications/progress` 实时推送脚本输出；
- 等待终态的时长由 `timeout_seconds` 控制（10–1800 秒，默认 1800）；**超时只结束等待，平台侧运行继续**，可稍后用 `get_run` 查询终态；
- 未提供 progressToken 时退化为等待终态一次性返回。

## 五、身份与操作人

- 用户令牌：写操作记录个人中心令牌对应用户为操作人；公共 Agent 令牌方式记「公共 Agent」；
- 机器人令牌（`X-Worker-Token`）：平台识别为机器人身份，任务协同、提测来源任务等按机器人规则处理；
- 任务协同、工单、机器人/任务定义管理仍使用 `.md` 端点（MCP 二期提供）。

## 六、与 lita-bots 的区别

| | `lita-work`（本文档） | `lita-bots`（[MCP.md](./MCP.md)） |
|---|---|---|
| 地址 | `POST /api/mcp/work` | `POST /api/mcp/bots` |
| 用途 | 直接操作平台数据与脚本 | 把平台机器人当子 Agent 调用 |
| 工具 | 项目/知识/运行/缺陷等 40+ 工具 | `list_bots`、`bot_call` 等 6 个 |
| 会话 | 无状态 | 多轮会话（`session_id`） |

两个服务可同时配置，互不影响。

## 七、常见问题

| 现象 | 原因与处理 |
|---|---|
| 401 缺少鉴权 / 无效令牌 | 检查 `Authorization: Bearer`（或 `X-Agent-Token` / `X-Worker-Token` / `?token=`）；令牌可能已被重置，去个人中心重新复制并更新 `LITA_WORK_TOKEN` |
| 工具返回 403（任务文档） | `/task/**` 知识由任务中心维护，请通过任务接口修改 |
| `upload_file` 失败 | 检查 base64 是否为空、文件是否超过 50MB |
| 运行类工具等待超时 | 调大 `timeout_seconds`（≤1800）或稍后用 `get_run` 查询结果 |
| 收不到中间进度 | 客户端未带 progressToken；opencode / Claude Code 默认携带 |
| 需要任务协同能力 | 二期 MCP 工具上线前，继续使用 `.md` 端点（见废弃的 SKILL.md 过渡说明） |
