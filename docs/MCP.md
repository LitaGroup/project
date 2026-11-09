# MCP 接入指南：在外部 Agent 中调用平台机器人

平台机器人（BOT）已通过 MCP（Model Context Protocol）对外开放：外部机器上的 AI Agent（opencode / Claude Code / Cursor / Codex CLI 等）完成一次配置后，即可把任意平台机器人当作**子 Agent** 调用——BOT 在平台自己的执行器与工位上真实运行（带角色定义、技能、规范），执行过程的文本流与工具调用实时回传给主 Agent，结束后返回最终结果。

- 服务地址：`POST /api/mcp`（MCP Streamable HTTP，响应为 SSE 流）
- 鉴权：平台 Agent 访问令牌，`Authorization: Bearer` / `X-Agent-Token` / `?token=` 三种方式均可；接入方环境变量 `LITA_WORK_TOKEN`（过渡期旧名 `LITA_PROJECT_TOKEN` 兜底），与 lita-work 技能约定一致
- 会话执行复用平台机器人聊天引擎，不产生任务记录、不影响任务派发

---

## 一、准备工作：获取访问令牌

**方式一：个人令牌（推荐）**

1. 登录平台网页，进入 **个人中心**（右上角头像菜单）；
2. 在「Agent 访问令牌」卡片复制令牌（48 位随机字符串，尚未生成会自动发放）；
3. 令牌泄露可在该卡片 **重置**，旧令牌立即失效（重置后需同步更新外部 Agent 配置）；
4. 按平台约定写入调用方机器的环境变量或本机 `~/.env`（与 lita-work 技能同一变量）：

```bash
# ~/.env
LITA_WORK_TOKEN=<你的访问令牌>
```

**方式二：公共 Agent 令牌（管理员下发）**

平台管理员通过后端环境变量 `PUBLIC_AGENT_TOKEN` 下发，供多个公共 Agent 共用，**权限与管理员等同**；未配置时不可用。使用方式与个人令牌相同。

> 令牌环境变量新名为 `LITA_WORK_TOKEN`；过渡期旧名 `LITA_PROJECT_TOKEN` 仍可用，**新名优先**（取值顺序：进程环境 → `~/.env` → 用户单独提供，详见 lita-work 技能）。

## 二、接入配置

### opencode（本地项目或全局配置）

在 `.opencode/config.yaml`（或 `~/.config/opencode/config.yaml`）追加：

```yaml
mcp:
  lita-bots:
    type: streamable-http
    url: http://your-host:3100/api/mcp
    headers:
      Authorization: Bearer ${LITA_WORK_TOKEN}
```

> `${LITA_WORK_TOKEN}` 为占位写法：请替换为实际令牌，或用客户端支持的环境变量引用（如 `Bearer ${LITA_WORK_TOKEN}` 展开自本机环境变量 / `~/.env`）。过渡期旧名 `LITA_PROJECT_TOKEN` 同值可用。

重启 opencode 后，`tools/list` 中会出现 `lita-bots` 的 6 个工具。

### Claude Code

```bash
claude mcp add --transport http lita-bots http://your-host:3100/api/mcp \
  --header "Authorization: Bearer ${LITA_WORK_TOKEN}"
```

或直接编辑 `~/.claude.json`：

```json
{
  "mcpServers": {
    "lita-bots": {
      "type": "http",
      "url": "http://your-host:3100/api/mcp",
      "headers": { "Authorization": "Bearer ${LITA_WORK_TOKEN}" }
    }
  }
}
```

### Cursor / 其它 MCP 客户端

任何支持 MCP Streamable HTTP 的客户端均可接入，通用参数：

| 参数 | 值 |
|---|---|
| 传输类型 | Streamable HTTP（streamable-http / http） |
| URL | `http://your-host:3100/api/mcp`（生产为平台域名） |
| 鉴权头 | `Authorization: Bearer ${LITA_WORK_TOKEN}`（也接受 `X-Agent-Token` 头） |
| URL 参数兜底 | `?token=<令牌>`（与平台 `.md` 端点一致，三选一即可） |

## 三、接入验证

配置完成后在 Agent 里依次确认：

1. **工具可见**：问主 Agent「列出你可用的 MCP 工具」，应看到 `list_bots`、`bot_call` 等；
2. **机器人清单**：让主 Agent 调用 `list_bots`，返回当前可调用的机器人（名称/简介/模型）；
3. **一轮真实调用**：让主 Agent「调用 技术支持工程师 机器人，问它：MCP链路OK吗」，正常会收到 `status: "complete"` 与回复文本。

curl 直连验证（可选，令牌自动取环境变量 `LITA_WORK_TOKEN`，旧名 `LITA_PROJECT_TOKEN` 兜底）：

```bash
TOKEN="${LITA_WORK_TOKEN:-$LITA_PROJECT_TOKEN}"
curl -N -X POST http://your-host:3100/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_bots","arguments":{}}}'
```

## 四、工具清单

| 工具 | 入参 | 说明 |
|---|---|---|
| `list_bots` | — | 可调用机器人清单。可见范围：启用 + opencode 运行时 + 执行器在线 + 模型配置完整；他人个人 AGENT 不可见 |
| `bot_call` | `bot`、`message`、`session_id?`、`auto_skip_questions?`、`timeout_seconds?` | 发起一轮对话/任务（核心工具）。执行期间经 progress notification 实时推送文本与工具变化；终态返回 `session_id`/`status`/`content`/`tools`/`todos` |
| `bot_answer` | `bot`、`session_id`、`question_id?`、`answers?`、`skip?` | 答复机器人提问并继续等待本轮完成 |
| `bot_interrupt` | `bot`、`session_id` | 中断当前轮（会话保留，可续聊） |
| `bot_reset` | `bot`、`session_id` | 重置会话（解绑 opencode 上下文，下次新开） |
| `get_session` | `bot`、`session_id` | 读取会话状态与最近 20 条消息摘要（断线找回结果） |

`bot` 参数传机器人**名称或数字 ID**（以 `list_bots` 返回为准）；`message` 为 Markdown 文本，单条 ≤ 50000 字符。

## 五、核心概念

### 多轮续聊

`bot_call` 返回 `session_id`，后续调用携带即在同一上下文续聊；不携带则新开会话。会话与平台内的机器人调试、我的 AI 相互隔离，**7 天不活跃自动过期**。同一会话同时只能执行一轮，冲突时返回工具错误（可先 `bot_interrupt` 中断）。

### 流式进度

客户端在 `tools/call` 请求携带 `_meta.progressToken` 时（opencode / Claude Code 默认行为），平台在 SSE 响应流中持续发送 `notifications/progress`：

- 文本增量按 300ms 节流合并推送；
- 工具调用开始/结束即时推送（如 `[running] bash：ls` / `[success] bash：ls`）；
- 未提供 progressToken 时退化为等待终态一次性返回。

### 提问答疑（status=question）

BOT 执行中发起提问时本轮返回：

```json
{
  "session_id": "sxxxx",
  "status": "question",
  "questions": [{ "id": "req-9", "questions": [{ "question": "要继续吗？", "header": "确认", "options": [{"label": "继续"}] }] }],
  "answers_hint": "调用 bot_answer 续跑……"
}
```

两种处理方式：

- 调 `bot_answer`：`answers` 为二维字符串数组且每个问题对应一项（每项为所选选项 label 或自由输入文本）；
- 调 `bot_answer` 传 `skip: true` 跳过提问；或在发起时传 `auto_skip_questions: true` 让平台自动跳过。

### status 取值

| status | 含义 |
|---|---|
| `complete` | 本轮完成，`content` 为最终回复 |
| `question` | 机器人发起提问，`questions` 为待回答清单 |
| `error` | 本轮失败（`error` 带原因；执行器离线、机器人配置变更需 reset 等） |
| `interrupted` | 超时中断（默认 600s，`timeout_seconds` 可调 10–1800s）或调用方断开，`content` 为已完成部分 |

### 容错

客户端中途断开不影响平台侧继续执行，结果可用 `get_session` 找回；调用失败返回工具错误（`isError: true`）并在文本中说明原因与建议动作。

## 六、常见问题

| 现象 | 原因与处理 |
|---|---|
| 401 缺少鉴权 / 无效令牌 | 检查 `Authorization: Bearer`（或 `X-Agent-Token` / `?token=`）；令牌可能已被重置，去个人中心重新复制并更新 `LITA_WORK_TOKEN`（旧名 `LITA_PROJECT_TOKEN` 兜底） |
| `list_bots` 为空 | 平台侧没有满足条件的机器人：需启用、执行器在线且模型配置完整；联系管理员检查执行器 |
| 找不到机器人「xxx」 | 名称不匹配，先 `list_bots` 获取准确名称或直接用数字 ID |
| 「机器人正在回复」冲突 | 同一会话上一轮未结束：调 `bot_interrupt` 或改用新 `session_id` |
| 「执行配置已变更」 | 机器人执行器/模型配置被管理员修改：调 `bot_reset` 后重试 |
| 收不到中间进度 | 客户端未带 progressToken；opencode / Claude Code 默认携带，自研客户端请在 `tools/call` 的 `_meta` 中提供 |
| 长任务被中断 | 触发单轮超时：调 `bot_call` 时传更大的 `timeout_seconds`（上限 1800s），或拆分任务 |

## 七、审计与管理

每次 `bot_call` / `bot_answer` 终态后落审计（调用方、机器人、会话、状态、耗时、消息长度、错误），管理员可在平台 **管理区 → MCP 调用**（`/admin/mcp-logs`）查看，接口 `GET /api/mcp/logs`。

## 八、限制

- 真人机器人与其他用户的个人 AGENT 不可调用；
- 附件暂不支持（平台任务的 `file://` 附件机制未开放到 MCP 通道）；
- 平台任务的派发/验收流程与 MCP 聊天相互独立：如需让 BOT **承接平台任务**，仍走平台任务中心（`POST /api/tasks/create.md` 等），MCP 通道适合「外部主 Agent 的子任务」场景。
