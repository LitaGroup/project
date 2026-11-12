# MCP 接入指南：lita-work 平台工具

平台把原 **lita-work / knowledge-search / file-upload** 三个 Agent 技能（`.md` HTTP 端点）改造成 MCP 服务 **`lita-work`**：外部 Agent（opencode / Claude Code / Cursor 等）完成一次配置后，即可直接调用带 schema 的平台工具——项目、文档、知识库、脚本运行、缺陷/提测、反馈、灵感、代码分支、文件上传、任务协同、工单和机器人/任务定义管理等。

- 服务地址：`POST /api/mcp/work`（MCP Streamable HTTP，响应为 SSE 流）
- 鉴权：机器人令牌（`Authorization: Bearer` / `X-Worker-Token` / `X-Agent-Token` / `?token=`），或管理员下发的公共 Agent 令牌；与 `.md` 端点同一令牌体系。真人用户没有独立令牌，其令牌就是绑定真人机器人的 `workers.agentToken`
- 与 `lita-bots`（`POST /api/mcp/bots`，把平台机器人当子 Agent 调用）相互独立，可同时接入

> 原 SKILL.md 技能（`/SKILL.md`、`/knowledge/SKILL.md`、`/file-upload/SKILL.md`）已下线，前端不再提供这些技能文档；全部能力已由 MCP 工具覆盖，历史 `.md` 业务接口仍保留兼容。

---

## 一、准备工作：获取机器人令牌

**方式一：个人机器人令牌（推荐）**

1. 登录平台网页 → 右上角头像 → **个人中心**；
2. 在「机器人令牌」卡片复制令牌（48 位随机字符串，尚未生成会自动发放）；这就是你绑定的真人机器人令牌，个人 AGENT 共用同一令牌；
3. 令牌泄露可在该卡片 **重置**，旧令牌立即失效（重置后需同步更新外部 Agent 配置）。

**方式二：公共 Agent 令牌（管理员下发）**

平台管理员通过后端环境变量 `PUBLIC_AGENT_TOKEN` 下发，供多个公共 Agent 共用，**权限与管理员等同**；未配置时不可用。

**方式三：平台机器人令牌**

机器人可在自己的工位使用 `.opencode/agent-token`（或 `.opencode/.env` 的 `LITA_WORK_TOKEN`）作为 `X-Worker-Token` 调用；平台按机器人身份记录操作人并校验执行方/需求方权限。真人机器人令牌同时具备真人身份，个人 AGENT 与其共用。

```bash
# ~/.env（与技能同一变量）
LITA_WORK_TOKEN=<你的机器人令牌>
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

## 三、工具清单

### 项目 / 文档 / 资源 / 节点

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `search_projects` | `query` | 按名称模糊搜索项目，返回前 5 个 |
| `get_project` | `projectId` | 项目完整详情（文档/资源/节点/检查/用例/导出/定时任务/提测/缺陷与最近运行结果） |
| `update_project` | `projectId`、`scriptsPath?`、`description?`、`resources?` | 仅更新平台本地字段（脚本目录/描述/人员） |
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

### 用户反馈

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `list_feedbacks` | `q?`、`status?`、`type?` | 反馈清单 Markdown 表格（含来源：平台/飞书群） |
| `get_feedback` | `feedbackId` | 反馈详情：正文、跟帖（飞书群话题自动收录）与处理信息 |

> 「系统-反馈处理」机器人：飞书反馈群按「收录群」配置后，一个话题自动收录为一条反馈；机器人经 `get_feedback` 读取后按 PROMPT 分发规则创建任务/缺陷（分发动作复用上方任务、缺陷工具）。

### 灵感

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `list_ideas` | `q?`、`status?`、`type?` | 灵感清单 Markdown 表格（构思/废弃/采纳，采纳后带关联需求） |
| `get_idea` | `ideaId` | 灵感详情：正文、图片、类型/状态/创建人与采纳信息 |
| `create_idea` | `title?`、`content?`、`type?`、`images?` | 创建灵感；标题可省略，平台按正文异步生成 |
| `update_idea` | `ideaId`、`title?`、`content?`、`type?`、`images?` | 完善灵感：构思期任何身份可协作编辑，采纳/废弃后仅管理员 |
| `delete_idea` | `ideaId` | 删除灵感：管理员可删任意，创建人仅能撤销「构思」中的灵感 |
| `change_idea_status` | `ideaId`、`status`、`createProject?`、`projectId?`、`projectType?` | 流转状态（仅管理员）：采纳时新建或关联需求池需求 |

> 「我的 AI」可通过 `create_idea` 创建灵感、`update_idea` 完善当前灵感正文、`delete_idea` 删除当前灵感；采纳后灵感与需求池项目建立软关联（`projectId`），可经 `GET /api/projects/{id}.md` 继续推进。

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

### 任务协同

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `list_my_tasks` | `q?`、`status?`、`subStatus?`、`rootOnly?` | 我的任务清单（需求方/执行方/负责方） |
| `get_task` | `taskId` | 任务详情与操作指引 |
| `create_task` | `title?`、`description?`、`input?`、`outputSpec?`、`templateId?` | 创建根任务并自动分配机器人 |
| `list_task_defines` | — | 可分发任务定义与可用机器人 |
| `create_subtask` | `parentTaskId`、`templateId`、`title`、`description?`、`input?`、`outputSpec?` | 父任务机器人创建子任务 |
| `accept_task` / `refuse_task` | `taskId`、`reason?`、`suggestion?` | 接受 / 拒绝邀约（拒绝需理由） |
| `ask_task_question` | `taskId`、`questions` | 执行机器人向需求方提问 |
| `answer_task_question` | `taskId`、`questionId`、`answers?`、`reject?` | 需求方或管理员答复提问 |
| `reply_task_message` | `taskId`、`content` | 需求方回复执行方消息 |
| `list_task_documents` | `taskId` | 任务文档清单 |
| `upsert_task_document` | `taskId`、`name`、`content?`、`title?` | 写入 API.md / TECH_DESIGN.md 等 |
| `read_task_handoff` | `taskId` | 读取交付文档 |
| `update_task_handoff` | `taskId`、`content?`、`append?`、`baseVersion` | 执行机器人维护交付文档 |
| `apply_task_acceptance` | `taskId`、`delivery?`、`problems?`、`detours?`、`lessons?`、`followUps?`、`other?` | 申请验收 |
| `accept_task_handoff` / `refuse_task_handoff` | `taskId`、`content?` | 需求方验收通过 / 返工 |
| `fail_task` | `taskId`、`reason` | 需求方判定失败 |

> 写操作按令牌身份校验：接受/拒绝/提问/申请验收仅机器人令牌（`X-Worker-Token`）；答复/验收/返工/判失败仅任务需求方。`update_task_handoff` 在首次创建时使用 `baseVersion=0`。

### 工单与工单文档

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `list_ticket_defines` | — | 可创建工单的配置（启用且已发布）与起始节点输入字段 |
| `create_ticket` | `workflowDefinitionId`、`title?`、`inputValues?` | 按工单配置创建工单并进入起始节点派发 |
| `get_task_ticket` | `taskId` | 调度工单上下文与可转派任务定义 |
| `route_task_ticket` | `taskId`、`templateId`、`title`、`content`、`outputSpec`、`workPlan` | 澄清后转交任务定义 |
| `get_ticket` | `ticketId` | 工作流工单完整上下文与节点进度 |
| `accept_ticket` | `ticketId`、`outcome`、`remark?` | 发起机器人验收当前验收节点（approved 完成 / rejected 退回） |
| `reject_ticket_node` | `ticketId`、`nodeKey`、`reason` | 当前节点处理机器人拒绝节点 |
| `list_ticket_documents` | `taskId` | 所属工单的交付文档清单 |
| `read_ticket_document` | `taskId`、`documentId` | 读取一篇交付文档 |
| `deliver_ticket_document` | `taskId`、`title`、`url?`、`content?` | 交付链接或正文（二选一） |
| `update_ticket_document` | `taskId`、`documentId`、`title?`、`url?`、`content?` | 更新本任务交付的文档 |
| `delete_ticket_document` | `taskId`、`documentId` | 删除本任务交付的文档 |

> 创建工单：真人机器人令牌以绑定真人身份发起；AI 机器人令牌以机器人自身为发起机器人（工单创建人为空，发起机器人记该机器人）。

### 机器人与任务定义

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `list_workers` / `get_worker` | `role?` / `workerId` | 机器人清单 / 详情 |
| `create_worker` | `name`、`intro?`、`executorId?`、`providerId?`、`modelId?`、`prompt?`、`skills?`、`standards?`、`mcps?`、`taskDefs?`、`ownerUserId?`、`enabled?`、权限与并行上限 | 创建自定义 AI 工作者（保存后自动初始化） |
| `update_worker` | `workerId` + 同上字段 | 编辑机器人（未传字段保持不变） |
| `delete_worker` | `workerId` | 删除自定义机器人 |
| `list_worker_skill_catalog` | `q?` | 技能库目录（配置 `skills` 前查询） |
| `list_worker_standard_catalog` | `q?` | 规范库目录（配置 `standards` 前查询） |
| `list_task_templates` / `get_task_template` | — / `templateId` | 任务定义清单 / 详情 |
| `create_task_template` | `name`、`description?`、`agentIds?` | 创建任务定义 |
| `update_task_template` | `templateId`、`name?`、`description?`、`agentIds?` | 编辑任务定义 |
| `delete_task_template` | `templateId` | 删除任务定义 |

### 飞书会话历史

| 工具 | 主要入参 | 说明 |
|---|---|---|
| `feishu_history` | `chat_id`、`thread_id?`、`limit?` | 查询机器人所在飞书群聊/话题/私聊最近 7 天内的消息（默认 20 条，最多 50）；需机器人绑定飞书应用且有消息读取权限 |

## 四、流式进度与超时

- 运行类与 `pull_scripts` 工具在客户端携带 `_meta.progressToken` 时（opencode / Claude Code 默认行为），经 `notifications/progress` 实时推送脚本输出；
- 等待终态的时长由 `timeout_seconds` 控制（10–1800 秒，默认 1800）；**超时只结束等待，平台侧运行继续**，可稍后用 `get_run` 查询终态；
- 未提供 progressToken 时退化为等待终态一次性返回。

## 五、身份与操作人

- 机器人令牌：平台识别为机器人身份；绑定真人时同时按真人身份处理，写操作记录该真人；未绑定真人的 AI 机器人记录机器人自身；
- 公共 Agent 令牌：写操作记「公共 Agent」；
- 任务协同、工单、机器人/任务定义管理的 MCP 工具与 `.md` 端点使用同一套身份与权限校验；`.md` 端点保留兼容。

## 六、与 lita-bots 的区别

| | `lita-work`（本文档） | `lita-bots`（[MCP_BOTS.md](./MCP_BOTS.md)） |
|---|---|---|
| 地址 | `POST /api/mcp/work` | `POST /api/mcp/bots` |
| 用途 | 直接操作平台数据与脚本 | 把平台机器人当子 Agent 调用 |
| 工具 | 项目/知识/运行/缺陷/任务/工单/机器人等 80+ 工具 | `list_bots`、`bot_call` 等 6 个 |
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
| 需要任务协同能力 | 使用任务协同工具（`list_my_tasks` / `get_task` / `accept_task` 等）；`.md` 端点保留兼容 |
