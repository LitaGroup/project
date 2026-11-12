---
description: "> AI 助手提示：定义 lita-work / lita-bots / lita-proxy 三个 MCP 服务的令牌获取与客户端接入配置（opencode / Claude Code / Codex CLI）。"
version: 1.1.0
type: docs
---

# MCP 接入指南：lita-work / lita-bots / lita-proxy

> AI 助手提示：外部 Agent（opencode / Claude Code / Codex CLI / Cursor 等）按本文档完成一次配置，即可调用平台 MCP 服务。三个服务共用同一枚机器人令牌 `LITA_WORK_TOKEN`，可单独或同时接入。

三个服务均使用 **MCP Streamable HTTP** 传输：

| 服务 | 地址 | 用途 | 工具数 |
|---|---|---|---|
| `lita-work` | `http://work.cinta.team/api/mcp/work` | 直接操作平台数据：项目 / 文档 / 知识库 / 脚本运行 / 缺陷 / 提测 / 反馈 / 灵感 / 代码分支 / 任务协同 / 工单 / 机器人管理 / 飞书会话历史 | 96 |
| `lita-bots` | `http://work.cinta.team/api/mcp/bots` | 把平台机器人当**子 Agent** 调用（多轮会话、提问、中断、断线找回） | 6 |
| `lita-proxy` | `http://proxy.cinta.team/mcp` | 内部资源运维：MySQL SQL、Nacos 配置、XXL-JOB 任务 | 14 |

- 本地开发环境把 `work.cinta.team` 换成 `localhost:3100`（`lita-proxy` 无本地实例）。
- 鉴权统一：`Authorization: Bearer <LITA_WORK_TOKEN>`。`lita-work` / `lita-bots` 还接受 `X-Worker-Token` / `X-Agent-Token` 头或 `?token=` 参数；`lita-proxy` 只接受 `Authorization: Bearer` 或 `X-Worker-Token`（`X-Agent-Token` 返回 401）。

---

## 一、LITA_WORK_TOKEN：获取与存放

### 1.1 令牌是什么

`LITA_WORK_TOKEN` 是平台的**机器人令牌**（48 位随机字符串）。平台只有机器人令牌，没有用户级 Agent 令牌：

- **真人用户**：令牌就是其绑定的真人机器人的 `workers.agentToken`，个人 AGENT 共用同一令牌；
- **AI 机器人**：使用机器人自身令牌，操作按机器人身份记录；
- **公共 Agent**：管理员通过后端环境变量 `PUBLIC_AGENT_TOKEN` 下发，权限与管理员等同，未配置时不可用。

### 1.2 获取方式

| 方式 | 获取位置 | 说明 |
|---|---|---|
| 个人机器人令牌（推荐） | 平台网页 → 右上角头像 → **个人中心** → 「机器人令牌」卡片 | 尚未生成会自动发放；泄露可在此**重置**，旧令牌立即失效 |
| 公共 Agent 令牌 | 管理员下发 | 多人共用，权限高，慎用 |
| 平台机器人工位 | `.opencode/agent-token` 或 `.opencode/.env` 的 `LITA_WORK_TOKEN` | 平台自动初始化，仅供该机器人使用 |

### 1.3 存放方式

**方式一：本机环境变量（通用）**

```bash
# ~/.env（不要提交到任何仓库）
LITA_WORK_TOKEN=<你的机器人令牌>
```

```bash
# ~/.zshrc 或 ~/.bashrc，登录后自动生效
export LITA_WORK_TOKEN="<你的机器人令牌>"
```

`{env:LITA_WORK_TOKEN}` 由客户端**从启动进程的环境变量**展开，因此变量必须对启动 Agent 的 shell 可见。注意 `~/.env` 不会被 shell 自动加载，需要 `source ~/.env` 或手动 `export` 后才生效。

**方式二：opencode secrets 文件（本机长期使用推荐）**

```bash
mkdir -p ~/.config/opencode/secrets
printf '%s' '<你的机器人令牌>' > ~/.config/opencode/secrets/lita-work-token
chmod 600 ~/.config/opencode/secrets/lita-work-token
```

配置中用 `{file:secrets/lita-work-token}` 引用（路径相对 opencode 配置目录），令牌不进入进程环境，也不依赖 shell 配置。

**方式三：客户端命令参数**

Claude Code 的 `--header`、Codex 的 `bearer_token_env_var` 均见下文各节。

> 过渡期旧名 `LITA_PROJECT_TOKEN` 仍可用，**新名优先**。禁止把真实令牌写入仓库、文档、截图或日志；泄露后立即在个人中心重置，并同步更新所有客户端配置。

---

## 二、三个服务怎么选

### 2.1 lita-work：直接操作平台数据

覆盖项目、文档、资源、节点、脚本运行、知识库、缺陷/提测、用户反馈、灵感、GitHub 代码分支、文件上传、任务协同、工单、机器人/任务定义和飞书会话历史查询。代表性工具：

| 分类 | 代表工具 |
|---|---|
| 项目 / 文档 / 资源 / 节点 | `search_projects`、`get_project`、`update_project`、`read_document`、`upsert_document`、`sync_apipost_document`、`list_resources`、`read_resource`、`sync_resource`、`list_milestones`、`create_milestone`、`update_milestone`、`delete_milestone` |
| 运行 / 脚本 / 设置 | `run_check`、`run_test`、`run_export`、`run_schedule`、`get_run`、`list_runs`、`import_scripts`、`pull_scripts`、`get_settings` |
| 知识库 | `search_knowledge`、`list_knowledge_dir`、`read_knowledge`、`create_knowledge`、`update_knowledge`、`delete_knowledge`、`read_feishu_doc` |
| 缺陷 / 提测 | `list_defects`、`get_defect`、`create_defect`、`update_defect`、`change_defect_status`、`add_defect_record`、`delete_defect`、`list_releases`、`submit_release`、`update_release_status` |
| 用户反馈 | `list_feedbacks`、`get_feedback`（含「系统-反馈处理」从飞书反馈群自动收录的话题反馈与跟帖） |
| 灵感 | `list_ideas`、`get_idea`、`create_idea`、`update_idea`、`delete_idea`、`change_idea_status`（采纳时新建或关联需求池需求） |
| GitHub / 文件 | `search_github_repos`、`list_github_branches`、`list_code_branches`、`register_code_branch`、`update_code_branch`、`delete_code_branch`、`list_code_events`、`upload_file` |
| 任务协同 | `list_my_tasks`、`get_task`、`create_task`、`list_task_defines`、`create_subtask`、`accept_task` / `refuse_task`、`ask_task_question`、`answer_task_question`、`reply_task_message`、`list_task_documents`、`upsert_task_document`、`read_task_handoff`、`update_task_handoff`、`apply_task_acceptance`、`accept_task_handoff` / `refuse_task_handoff`、`fail_task`、`get_task_callback_url` |
| 工单与工单文档 | `get_task_ticket`、`route_task_ticket`、`get_ticket`、`reject_ticket_node`、`list_ticket_documents`、`read_ticket_document`、`deliver_ticket_document`、`update_ticket_document`、`delete_ticket_document` |
| 机器人与任务定义 | `list_workers`、`get_worker`、`create_worker`、`update_worker`、`delete_worker`、`list_worker_skill_catalog`、`list_worker_standard_catalog`、`list_task_templates`、`get_task_template`、`create_task_template`、`update_task_template`、`delete_task_template` |
| 飞书会话 | `feishu_history`（群聊/话题/私聊最近 7 天消息，需机器人绑定飞书应用） |

- 写操作按令牌身份校验：任务接受/拒绝/提问/申请验收仅机器人令牌；答复/验收/返工/判失败仅任务需求方；
- `/project/**`、`/task/**` 知识为系统镜像，只读，变更走对应业务流程；
- 全部 96 个工具的清单与入参见 [lita-work 接入指南](http://work.cinta.team/work-mcp.md)。

### 2.2 lita-bots：把平台机器人当子 Agent

| 工具 | 说明 |
|---|---|
| `list_bots` | 可调用机器人清单（启用 + 执行器在线 + 模型配置完整） |
| `bot_call` | 发起一轮对话/任务，执行过程经 progress 实时推送 |
| `bot_answer` | 答复机器人提问并继续本轮 |
| `bot_interrupt` | 中断当前轮（会话保留） |
| `bot_reset` | 重置会话（解绑上下文） |
| `get_session` | 读取会话状态（断线找回结果） |

会话 7 天不活跃自动过期；机器人中途提问返回 `status=question`，需用 `bot_answer` 续跑。完整说明见 [lita-bots 接入指南](http://work.cinta.team/MCP_BOTS.md)。

### 2.3 lita-proxy：内部资源运维

独立服务（不在本仓库），按机器人 `resourcePermission` 鉴权：`write` 可访问全部资源，`read` 仅可访问 `readOnly=true` 的资源，`none` 无权限。`name` / `env` 必须取自 `list_resources`，不要猜测。

**资源**

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `list_resources` | `kind?`（mysql/nacos/redis/xxljob）、`env?`（test/prod） | 列出当前机器人有权访问的资源元信息（不含密码）；`read` 权限仅返回只读资源 |

**MySQL**

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `execute_sql` | `name`、`env`、`query` | 执行单条 SQL（≤65536 字符）；只读资源由数据库只读事务强制拒绝写语句；查询务必带条件与 `LIMIT` |

**Nacos**

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `list_nacos_namespaces` | `name`、`env` | 列出命名空间 |
| `list_nacos_configs` | `name`、`env`、`namespace?`、`dataId?`、`group?`、`pageNo?`、`pageSize?` | 分页列出配置标识（不含正文） |
| `get_nacos_config` | `name`、`env`、`dataId`、`group?`、`namespace?` | 读取配置正文 |
| `publish_nacos_config` | `name`、`env`、`dataId`、`content`、`group?`、`namespace?`、`type?` | 发布/覆盖配置；需 `write` 权限，生产变更前必须获得用户明确确认 |
| `delete_nacos_config` | `name`、`env`、`dataId`、`group?`、`namespace?` | 删除配置；不可逆，生产环境删除前必须获得用户明确确认 |

**XXL-JOB**

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `list_xxljob_executors` | `name`、`env`、`appname?`、`title?`、`pageNo?`、`pageSize?` | 执行器（job group）清单 |
| `list_xxljob_jobs` | `name`、`env`、`jobGroup?`、`triggerStatus?`、`jobDesc?`、`executorHandler?`、`author?`、`pageNo?`、`pageSize?` | 任务清单（不含 GLUE 源码） |
| `list_xxljob_logs` | `name`、`env`、`jobGroup`、`jobId?`、`logStatus?`、`filterTime?`、`pageNo?`、`pageSize?` | 调度日志摘要 |
| `get_xxljob_log` | `name`、`env`、`logId`、`fromLineNum?` | 日志正文，可用 `fromLineNum` 增量拉取 |
| `trigger_xxljob_job` | `name`、`env`、`jobId`、`executorParam?` | 手动触发一次（异步执行） |
| `start_xxljob_job` | `name`、`env`、`jobId` | 启动调度 |
| `stop_xxljob_job` | `name`、`env`、`jobId` | 停止调度 |

> 生产环境的写操作（SQL 写入、Nacos 发布/删除、任务启动/停止/触发）必须先获得用户明确确认，Agent 不得自行执行。

---

## 三、opencode 配置

编辑 `~/.config/opencode/opencode.json`（全局）或项目 `.opencode/opencode.json`（项目级）：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "lita-work": {
        "type": "remote",
        "url": "http://work.cinta.team/api/mcp/work",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {env:LITA_WORK_TOKEN}"
        }
      },
      "lita-bots": {
        "type": "remote",
        "url": "http://work.cinta.team/api/mcp/bots",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {env:LITA_WORK_TOKEN}"
        }
      },
      "lita-proxy": {
        "type": "remote",
        "url": "http://proxy.cinta.team/mcp",
        "oauth": false,
        "headers": {
          "X-Worker-Token": "{env:LITA_WORK_TOKEN}"
        }
      }
    }
  }
}
```

- `{env:LITA_WORK_TOKEN}`：从 opencode 进程环境展开，变量需已 export；
- 也可改用 secrets 文件：把三处令牌值替换为 `{file:secrets/lita-work-token}`（相对 `~/.config/opencode/`，建议 `chmod 600`），不依赖环境变量；
- `lita-proxy` 同样可以写 `"Authorization": "Bearer {env:LITA_WORK_TOKEN}"`，两种写法等价。

保存后 opencode 自动加载，`tools/list` 中会出现三个服务的工具。

---

## 四、Claude Code 配置

```bash
# 先让当前 shell 能看到令牌（或写入 ~/.zshrc 后重开终端）
export LITA_WORK_TOKEN="<你的机器人令牌>"

claude mcp add --transport http lita-work http://work.cinta.team/api/mcp/work \
  --header "Authorization: Bearer ${LITA_WORK_TOKEN}"

claude mcp add --transport http lita-bots http://work.cinta.team/api/mcp/bots \
  --header "Authorization: Bearer ${LITA_WORK_TOKEN}"

claude mcp add --transport http lita-proxy http://proxy.cinta.team/mcp \
  --header "X-Worker-Token: ${LITA_WORK_TOKEN}"
```

也可以直接编辑 `~/.claude.json`：

```json
{
  "mcpServers": {
    "lita-work": {
      "type": "http",
      "url": "http://work.cinta.team/api/mcp/work",
      "headers": { "Authorization": "Bearer ${LITA_WORK_TOKEN}" }
    },
    "lita-bots": {
      "type": "http",
      "url": "http://work.cinta.team/api/mcp/bots",
      "headers": { "Authorization": "Bearer ${LITA_WORK_TOKEN}" }
    },
    "lita-proxy": {
      "type": "http",
      "url": "http://proxy.cinta.team/mcp",
      "headers": { "X-Worker-Token": "${LITA_WORK_TOKEN}" }
    }
  }
}
```

> `claude mcp add --header` 中的 `${LITA_WORK_TOKEN}` 由 shell 在添加时展开并以明文写入配置，注意 `~/.claude.json` 权限（`chmod 600`）；重置令牌后需重新执行添加命令。

---

## 五、Codex CLI 配置

编辑 `~/.codex/config.toml`：

```toml
[mcp_servers.lita-work]
url = "http://work.cinta.team/api/mcp/work"
bearer_token_env_var = "LITA_WORK_TOKEN"

[mcp_servers.lita-bots]
url = "http://work.cinta.team/api/mcp/bots"
bearer_token_env_var = "LITA_WORK_TOKEN"

[mcp_servers.lita-proxy]
url = "http://proxy.cinta.team/mcp"
bearer_token_env_var = "LITA_WORK_TOKEN"
```

- `bearer_token_env_var` 只保存**环境变量名**，Codex 每次请求时读取，令牌不落盘；
- 需要改用 `X-Worker-Token` 时（如 `lita-proxy`）：

```toml
[mcp_servers.lita-proxy]
url = "http://proxy.cinta.team/mcp"
env_http_headers = { "X-Worker-Token" = "LITA_WORK_TOKEN" }
```

- 也可用命令添加：

```bash
codex mcp add lita-work --url http://work.cinta.team/api/mcp/work --bearer-token-env-var LITA_WORK_TOKEN
codex mcp add lita-bots --url http://work.cinta.team/api/mcp/bots --bearer-token-env-var LITA_WORK_TOKEN
codex mcp add lita-proxy --url http://proxy.cinta.team/mcp --bearer-token-env-var LITA_WORK_TOKEN
codex mcp list
```

启动 Codex 的 shell 必须已 export `LITA_WORK_TOKEN`，否则连接会收到 401。

---

## 六、Cursor / 其它客户端

任何支持 MCP Streamable HTTP 的客户端均可接入，通用参数：

| 参数 | lita-work | lita-bots | lita-proxy |
|---|---|---|---|
| 传输类型 | Streamable HTTP（streamable-http / http） | 同左 | 同左 |
| URL | `http://work.cinta.team/api/mcp/work` | `http://work.cinta.team/api/mcp/bots` | `http://proxy.cinta.team/mcp` |
| 鉴权头 | `Authorization: Bearer <TOKEN>` | 同左 | `Authorization: Bearer <TOKEN>` 或 `X-Worker-Token: <TOKEN>` |
| URL 参数兜底 | `?token=<TOKEN>` | `?token=<TOKEN>` | 不支持 |

---

## 七、接入验证

### 7.1 curl 冒烟

```bash
export LITA_WORK_TOKEN="<你的机器人令牌>"

# lita-work：应返回 search_projects / get_settings 等工具
curl -sS -X POST http://work.cinta.team/api/mcp/work \
  -H "Authorization: Bearer $LITA_WORK_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# lita-bots：应返回 list_bots / bot_call 等 6 个工具
curl -sS -X POST http://work.cinta.team/api/mcp/bots \
  -H "Authorization: Bearer $LITA_WORK_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# lita-proxy：应返回 list_resources / execute_sql 等 14 个工具
curl -sS -X POST http://proxy.cinta.team/mcp \
  -H "Authorization: Bearer $LITA_WORK_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

响应可能是 SSE 流（`event: message` + `data:` 行）或普通 JSON，均属正常。

### 7.2 Agent 内验证

1. 让 Agent 列出可用 MCP 工具，应看到三个服务的工具名前缀；
2. `lita-work`：调用 `get_settings` 或 `search_projects`；
3. `lita-bots`：调用 `list_bots`，应返回机器人清单；
4. `lita-proxy`：调用 `list_resources`，应返回当前机器人有权访问的资源。

---

## 八、常见问题

| 现象 | 原因与处理 |
|---|---|
| 401 缺少鉴权 / 无效令牌 | 检查请求头格式；令牌可能已被重置，去个人中心重新复制并更新 `LITA_WORK_TOKEN` |
| `lita-proxy` 返回 401 且用的是 `X-Agent-Token` | 该服务不支持此头，改用 `Authorization: Bearer` 或 `X-Worker-Token` |
| `lita-proxy` 看不到资源 / 403 | 机器人权限不足：`read` 只能访问 `readOnly=true` 的资源，写操作需管理员开通 `write` 并确认资源非只读 |
| `{env:LITA_WORK_TOKEN}` 展开为空 | 变量不在 opencode 进程环境：写入 `~/.zshrc` 后重开终端，或改用 `{file:secrets/lita-work-token}` |
| opencode 工具列表没有新服务 | 配置 JSON 格式错误或客户端未重载，检查日志后重启 |
| 收不到中间进度 | 客户端未携带 `_meta.progressToken`；opencode / Claude Code 默认携带 |
| 运行类工具等待超时 | `timeout_seconds` 上限 1800；超时只结束等待，平台侧继续运行，稍后用 `get_run` 查询 |
| `lita-bots` 提示「机器人正在回复」 | 同一会话上一轮未结束：先 `bot_interrupt` 或换新 `session_id` |

---

## 九、深入文档

| 文档 | 内容 |
|---|---|
| [lita-work 接入指南](http://work.cinta.team/work-mcp.md) | lita-work 全部工具清单、入参、流式进度与身份规则 |
| [lita-bots 接入指南](http://work.cinta.team/MCP_BOTS.md) | lita-bots 会话、提问、状态码、审计与管理细节 |

---

**维护人**: Lita R&D Team
