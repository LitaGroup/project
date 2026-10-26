---
name: project-manage
description: 项目管理平台技能。根据名称模糊搜索项目、获取项目详情（文档/资源/节点/检查/用例/导出/定时任务/提测记录及运行信息）、运行检查/用例/导出/定时任务并流式获取结果、向项目导入 scripts 仓库的新脚本、修改项目配置（脚本目录/飞书通知群/描述/人员）、写入/更新项目文档、登记与验收节点、项目提测（状态流转「测试中」并通知提测群与项目人员）、登记项目代码分支（GitHub 仓库+分支）并查询监听到的提交/合并记录、查询缺陷清单与详情、创建/编辑/状态变更/删除缺陷、查看系统设置与更新脚本仓库、搜索/创建/更新/移动/删除平台知识库
version: 1.14.0
author: Lita R&D Team
tags:
  - 项目管理
  - 检查
  - 测试
  - 定时任务
  - markdown
---

# 项目管理技能

## 技能描述

对接项目管理平台（以 AI 为中心的项目管理与脚本运行平台），供 Agent 完成以下工作：

1. 按项目名称模糊搜索项目
2. 获取项目详情：文档（含 Markdown 正文地址）、类型、描述，以及资源/节点/检查/用例/导出/定时任务的清单、运行命令、最近运行结果与运行记录
3. 读取文档 Markdown 正文；写入/更新项目文档（按 fileName upsert）
4. 运行检查/用例/导出/定时任务，流式读取脚本输出与结果（导出运行详情含产物文件下载链接）
5. 向 scripts 仓库提交代码后，把新脚本同步导入到指定项目（自动登记为 检查/用例/导出）
6. 修改项目本地配置：脚本目录、飞书通知群、描述、人员
7. 登记项目节点（时间点事项），研发验收后标记达成
8. 项目提测：创建提测记录，项目状态流转「测试中」，通知提测群与项目人员（见第 8 节）
9. 查询缺陷清单与详情、创建/编辑缺陷、变更状态、追加变更记录、删除缺陷（见第 9 节）
10. 登记项目代码分支（GitHub 仓库+分支，标注 后端/H5/安卓/IOS/其它），平台自动监听 test/main/stable 等分支的新提交/合并（见第 10 节）
11. 获取平台设置信息、更新脚本仓库
12. 搜索平台知识库、浏览知识目录、读取知识文章与项目文档镜像（见第 11 节；也可单独安装 `knowledge-search` 技能）
13. 创建知识文章/目录，更新正文、标题，移动/重命名，删除文章或目录（见第 11.4 节）

本文件可通过 `http://{host}/SKILL.md` 直接获取。所有请求 URL 以 `.md` 结尾，响应均为 `text/markdown`，且以 YAML frontmatter 开头：必含 `update`（最后更新时间，北京时间 `YYYY-MM-DD HH:mm:ss`，实体类视图取数据最后更新时间，其余取响应生成时间），部分视图含 `title`/`filename`/`description` 等标识字段。

## 基础地址

- 测试环境：`http://project.cinta.team`（生产同域，按实际环境替换）
- 所有路径省略前缀写法如下文，调用时拼在基础地址后（如 `{BASE}/api/projects/search.md?q=pk`）

## 鉴权

所有 `/api/...*.md` 端点要求鉴权，凭 **agent 访问令牌**（`LITA_PROJECT_TOKEN`）调用。令牌归属个人：登录网页 → 右上角头像 → 个人中心 → "Agent 访问令牌"可查看、复制与重置，重置后旧令牌立即失效。个人中心另提供「一键设置令牌（Shell）」脚本，可把令牌写入本机配置。

### 令牌获取顺序（按优先级）

发起请求前，按下述顺序取令牌，取到即用，不要向用户重复索要已存在的令牌：

1. **环境变量 `LITA_PROJECT_TOKEN`**：先看进程环境是否已有
   ```bash
   echo "$LITA_PROJECT_TOKEN"
   ```
2. **`~/.env` 中的 `LITA_PROJECT_TOKEN`**：读取本机配置文件
   ```bash
   grep '^LITA_PROJECT_TOKEN=' ~/.env 2>/dev/null | cut -d= -f2-
   ```
3. **用户单独配置 / 临时提供**：以上都没有时，请用户登录个人中心复制令牌，或用「一键设置令牌」脚本写入 `~/.env` 后重试：
   ```bash
   { grep -v '^LITA_PROJECT_TOKEN=' ~/.env 2>/dev/null; echo 'LITA_PROJECT_TOKEN={TOKEN}'; } > ~/.env.tmp && mv ~/.env.tmp ~/.env
   ```

### 携带方式（任选）

```bash
# 方式一：请求头（推荐）
curl -H "X-Agent-Token: {TOKEN}" {BASE}/api/projects/search.md?q=pk

# 方式二：URL 参数
curl "{BASE}/api/projects/search.md?q=pk&token={TOKEN}"
```

令牌无效或缺失返回 401。网页内直接点击 `.md` 链接无需令牌（浏览器会话自动放行）。

### 操作人记录

通过 agent 令牌发起的写操作（如缺陷创建/更新/状态变更/追加记录）会自动记录**令牌对应用户**为操作人，展示在缺陷详情的"变更记录"中（来源 `AI` + 操作人姓名）；系统自动流转（如脚本回归通过关闭缺陷）操作人为空。

## 能力清单

### 1. 搜索项目

```
GET /api/projects/search.md?q={项目名称关键词}
```

- 名称模糊匹配；结果按匹配度分级（精确 > 前缀 > 包含），同级创建时间倒序，返回前 5 个
- 每条含：名称、类型、状态、id、更新时间与 `[详情](/api/projects/{id}.md)` 链接

### 2. 项目详情

```
GET /api/projects/{id}.md
```

返回内容：

- 项目元信息：类型 / 状态 / 优先级 / 预期发布时间 / 迭代周期 / 人员 / 脚本目录
- 描述正文
- 文档清单：类型 + 标题 + 链接 `GET /api/documents/{docId}.md`（该链接即文档正文）
- 资源清单（需求方提供的素材/信息，已隐藏软删除）：状态 + 标题 + 链接 `GET /api/resources/{id}.md` + 类型 + 来源 URL
- 节点清单（时间点事项，按日期升序）：推导状态（准备中/提前达成/达成/延期/取消）+ 日期 + 内容 + id + 实际达成日期/交付人/验收人/备注
- 检查清单：每条含编号、描述、脚本路径、运行命令 `POST /api/checks/{checkId}/run.md`、最近一次运行结果摘要 + 详情链接 `GET /api/checks/runs/{runId}.md`、运行历史地址
- 用例（测试）清单：结构同检查（base 为 `/api/tests`）
- 导出清单：结构同检查（base 为 `/api/exports`）；导出运行详情的 Markdown 视图含产物文件下载链接（`/export-files/{exportId}/{runId}/{file}`）
- 定时任务清单：标题、cron、绑定的检查编号、开关状态、上次执行时间、下次执行时间、上次执行结果 + 执行命令 `POST /api/schedules/{scheduleId}/run.md`、运行记录地址 `GET /api/schedules/{scheduleId}/runs`
- 提测记录小节（最近 5 条）：时间 / 提测人 / 状态 / 判定人 / 判定时间 / 测试人员 / 内容摘要；全量清单地址 `GET /api/releases.md?projectId={id}`（见第 8 节）
- 缺陷清单：每条含 id + 详情链接 `GET /api/defects/{id}.md` + 状态 + 预期 + 端 + 优先级 + 用例脚本；"缺陷"小节另附本项目全部缺陷清单地址 `GET /api/defects.md?projectId={id}`（见第 9 节）
- 末尾"AI 操作"小节列出全部可用端点

典型流程：**搜索 → 取目标项目 id → 读项目详情 → 再决定运行什么**。

### 3. 读取文档正文

```
GET /api/documents/{docId}.md
```

返回文档元信息（标题 / 类型 / 来源 / 所属项目 / 更新时间等）+ Markdown 正文全文。来源为 apipost 的接口文档正文由后端把 swagger JSON 实时转换为 Markdown（按目录分组的接口清单 + 参数/请求体/响应表格），可直接阅读。

### 3.1 读取资源详情

```
GET /api/resources/{id}.md
```

返回资源元信息（标题 / 类型 / 状态 / 链接 / 前缀 / 绑定文档 / 描述 / 更新时间）+ 正文：配置类型=绑定文档的 Markdown 内容（亦可经 `/api/documents/{documentId}.md` 直接读文档）；多语言=已同步的文案 Markdown 表格缓存（未同步时提示先调 `POST /api/resources/{id}/sync`，同步按前缀拉取 Lita word/sheet 接口）；其它=描述。资源类型枚举：配置/多语言/文件资源/UI/其它（UI=蓝湖地址，仅存链接；文件资源/其它 暂未开放创建）；多语言以前缀 `{SHEET}$NAMESPACE` 标识（SHEET=Activity/Frontend/FE/Backend，省略默认 Activity）；状态枚举：缺失/草稿/确认/废弃（废弃为软删除，列表默认隐藏；无凭据[URL/多语言前缀]时状态只能为 缺失/废弃）。

### 3.2 写入项目文档（upsert）

```
POST /api/documents/upsert.md
Content-Type: application/json

{"projectId": 123, "fileName": "deploy-guide.md", "title": "部署指引", "type": "技术", "content": "# 正文 Markdown", "description": "可选描述"}
```

- 按 `(projectId, fileName)` 判重：**`fileName` 是稳定唯一标识**（同一项目下唯一），与展示用 `title` 解耦——同一 fileName 重复调用即更新，不会新建
- 已存在 → 覆盖正文（`title`/`type`/`description` 提供了才更新，不填保持原样）；不存在 → 新建（`title` 缺省取 fileName、`type` 缺省"技术"）
- `type` 可选：需求/功能/测试/技术/接口/配置
- 响应为 text/markdown：创建/更新结果 + 文档 ID + 阅读地址 `GET /api/documents/{docId}.md`
- 若 fileName 命中外部导入（飞书/apipost）的文档会返回 403（外部文档只能从源同步更新）

### 3.3 导入 APIPOST 接口文档

```
POST /api/documents/sync-apipost
Content-Type: application/json

{"projectId": 123, "url": "https://docs.apipost.net/docs/detail/xxxx", "type": "接口", "description": "可选描述"}
```

- `url` 支持 docs.apipost.net 文档页与 openapi.apipost.net swagger 链接两种格式（同项目判重，重复调用即更新）
- 文档类型缺省"接口"；正文存原始 swagger JSON，经 `GET /api/documents/{docId}.md` 读取时自动转换为 Markdown
- 同一 apipost 项目重复导入不会新建文档（按 `(projectId, 规范化原文链接)` upsert）

**建议每个项目沉淀以下文档**（fileName 固定，便于重复 upsert；正文为 Markdown，脚本类内容用 ```` ```yaml ```` / ```` ```json ```` / ```` ```sql ```` 代码块包裹）：

| 文档 | fileName | type |
| --- | --- | --- |
| 技术设计文档 | `TECHNICAL_DESIGN.md` | 技术 |
| 接口文档 | `API.md` 或 `SWAGGER.json` | 接口 |
| 配置脚本（Yaml/Json） | `xxxxx-xxxx.yaml`（按项目命名） | 配置 |
| SQL脚本 | `init.sql` | 技术 |

### 4. 运行检查 / 用例 / 导出 / 定时任务（流式）

```bash
curl -N -X POST {BASE}/api/checks/{checkId}/run.md          # 运行一次检查
curl -N -X POST {BASE}/api/tests/{testId}/run.md            # 运行一次用例
curl -N -X POST {BASE}/api/exports/{exportId}/run.md        # 运行一次导出
curl -N -X POST {BASE}/api/schedules/{scheduleId}/run.md    # 手动触发一次定时任务
```

- 必须带 `-N`（禁用缓冲）以逐行读取
- 响应格式：先头部信息（运行 ID、脚本、详情地址），随后"输出"小节为脚本原始输出逐行追加，终态后附"结果"小节（状态 / 进度 / 成功失败跳过数 / 耗时 / 消息）后结束
- 拿到运行 ID 后也可单次获取详情：

```
GET /api/checks/runs/{runId}.md   # 检查 / 定时任务的运行详情
GET /api/tests/runs/{runId}.md    # 用例的运行详情
GET /api/exports/runs/{runId}.md  # 导出的运行详情（含产物文件下载链接）
```

（JSON 版详情与 SSE 实时流分别为 `GET .../runs/{runId}` 与 `GET .../runs/{runId}/stream`）

### 5. 系统能力

```
GET /api/settings.md                  # 平台设置：环境 / 端口 / 脚本目录 / 图片目录 / 访问域名 / agent 在线状态等
curl -N -X POST {BASE}/api/settings/scripts/pull.md   # 更新脚本仓库（git pull）
```

脚本更新为流式响应："输出"小节逐行返回 git 输出，结束附"结果"小节（success / error + 消息）。超时 60 秒。

### 5.1 同步脚本到项目（导入）

**向 scripts 仓库提交代码后**，把新脚本同步登记到平台，一次导入 检查（`.check.ts`）/ 用例（`.test.ts`）/ 导出（`.export.ts`）三类：

```
POST /api/scripts/import.md
Content-Type: application/json

{"projectId": 123}
```

标准流程（提交代码后）：

```bash
curl -X POST {BASE}/api/projects/123/update.md -H 'Content-Type: application/json' -d '{"scriptsPath": "projects/xxx"}'  # 首次使用先配置脚本目录（见 5.2）
curl -N -X POST {BASE}/api/settings/scripts/pull.md     # 更新平台侧脚本仓库（代码已在平台服务器上时可跳过）
curl -X POST {BASE}/api/scripts/import.md -H 'Content-Type: application/json' -d '{"projectId": 123}'  # 导入新脚本
```

- 必须指定项目；按脚本路径判重（已登记的跳过），编号由文件名生成（`daily.check.ts` → `daily`，冲突追加 `-2`/`-3`）
- 响应为 text/markdown：按 检查/用例/导出 三小节列出 新增数量、编号、脚本路径与运行命令（拿到 checkId/testId/exportId 可直接调对应 `run.md` 运行）
- **缺 `projectId`、项目不存在、或项目未配置脚本目录（scriptsPath）时不执行导入**，响应中会明确给出原因与下一步指引（先搜索项目 → 再配置脚本目录 → 再导入），按提示操作后重试即可
- 导出脚本须位于项目脚本目录的 `exports` 子目录；未发现新脚本时响应会提示先执行 `POST /api/settings/scripts/pull.md`

### 5.2 修改项目配置

```
POST /api/projects/{projectId}/update.md
Content-Type: application/json

{"scriptsPath": "projects/xxx", "feishuWebhook": "e09e9672-1f50-4b65-a181-8750bae489fc", "description": "# 描述 Markdown", "resources": {"frontend": "张三", "backend": "李四", "qa": "王五"}}
```

- 仅开放本地字段：`scriptsPath`（脚本目录，相对脚本根目录的子目录，即提交代码所在的目录）、`feishuWebhook`（群机器人 webhook secret，粘贴完整 hook 地址自动截取）、`description`（Markdown 描述）、`resources`（人员 `{frontend?, backend?, qa?, client?}`）
- 所有字段选填，只更新提供的字段；传空串清除，`resources` 传 `{}`/`null` 清除
- 响应为 text/markdown：本次变更字段与新值 + 项目详情地址 `GET /api/projects/{id}.md`
- 刻意不含类型/状态/优先级/迭代周期/预期发布时间——这些字段来自飞书同步，下次同步会被飞书侧覆盖

### 6. 全局列表（JSON，非 .md）

需要跨项目列举数据时使用常规 JSON 接口（`projectId` 均可选，不传返回全部）：

```
GET /api/checks[?projectId=]      # 检查列表
GET /api/tests[?projectId=]       # 用例列表
GET /api/exports[?projectId=]     # 导出列表
GET /api/documents[?projectId=]   # 文档列表（不含正文）
GET /api/schedules[?projectId=]    # 定时任务列表（附下次执行时间与运行统计）
GET /api/defects[?projectId=]     # 缺陷列表（Markdown 清单见 9.1 `/api/defects.md`，详情见 9.2 `/api/defects/{id}.md`）
GET /api/releases.md?projectId=   # 提测记录清单（Markdown，见 8.2；仅 .md 版）
GET /api/resources[?projectId=&includeDeleted=]  # 资源列表（不含多语言缓存正文；includeDeleted=true 含软删除）
GET /api/milestones[?projectId=]  # 节点列表（按日期升序，附推导状态）
GET /api/code-branches[?projectId=]  # 代码分支登记列表（见第 10 节）
GET /api/code-events[?projectId=&repo=&branch=&q=]  # 监听到的提交记录（JSON，Markdown 清单见 10.1）
```

### 7. 节点（JSON，非 .md）

节点表示项目在某个时间点需要完成的事项，`date` 指北京时间当日 23:59:59 前：

```bash
curl -X POST {BASE}/api/milestones -H 'Content-Type: application/json' \
  -d '{"projectId": 123, "date": "2026-10-01", "content": "完成联调", "deliverer": "张三", "acceptor": "李四"}'  # 新建（deliverer/acceptor/remark 可空）
curl -X PATCH {BASE}/api/milestones/{milestoneId} -H 'Content-Type: application/json' \
  -d '{"achieved": "yes"}'   # 研发验收后标记达成：自动记录北京时间当天为实际达成日期；no 撤销达成、cancel 取消节点
```

- 状态不落库，由 达成标记 + 实际达成日期 + 日期 推导：cancel→取消；yes→达成日期早于日期1天以上=提前达成 / 等于=达成 / 晚于=延期；no→今天超过日期=延期，否则=准备中
- **是否达成须研发验收后才能标记 yes**（平台不校验操作者，流程上由验收人确认后标记）
- 更新（改日期/内容/备注/交付人/验收人）走同一个 `PATCH /api/milestones/{id}`；删除 `DELETE /api/milestones/{id}`

### 8. 项目提测（Markdown）

提测表示项目进入测试状态：创建一条提测记录（默认状态「待冒烟」），项目状态流转「测试中」，并向提测群「H5 Release | 提测上线」与项目人员（前端/后端/测试/客户端 + 测试人员）发飞书机器人卡片。允许重复提测（保持「测试中」仅追加记录）。提测结果由测试同学判定为「已通过 / 未通过」（见 8.3）。

#### 8.1 发起提测

```
POST /api/projects/{projectId}/release.md
Content-Type: application/json

{"testers": ["王五"], "content": "# 提测内容 Markdown", "urls": ["https://..."], "branches": [{"repo": "LitaGroup/lita-h5", "branch": "test"}]}
```

- 仅 `testers` 必填：**至少 1 人且须为用户系统内用户**（即登录过本平台的飞书用户），不存在返回 400 并列出无效姓名
- `content`（提测内容 Markdown）/ `urls`（访问地址数组）/ `branches`（代码分支）均可空；提测时间由后端按当前时间生成；操作人取令牌对应用户
- 响应为 text/markdown：提测结果（项目/状态/人员/地址/分支/内容）+ 项目详情与提测记录清单地址；通知发送失败仅告警，不影响提测

#### 8.2 查询提测记录（清单）

```
GET /api/releases.md?projectId={id}
```

按提测时间倒序返回全部提测记录（时间 / 提测人 / 状态 / 判定人 / 判定时间 / 测试人员 / 访问地址 / 代码分支 / 内容摘要）；不传 `projectId` 返回全平台。

#### 8.3 判定提测结果（测试同学操作）

```
POST /api/releases/{releaseId}/status.md
Content-Type: application/json

{"status": "已通过"}
```

- 状态枚举：`待冒烟`（提测默认）/ `已通过` / `未通过`；`{releaseId}` 取自 8.2 清单的 `id`
- 改为「已通过 / 未通过」时记录判定人（令牌对应用户）与判定时间；改回「待冒烟」会清空判定人/判定时间（重新冒烟），状态未变化时幂等返回
- 响应为 text/markdown：项目 / 提测记录 / 提测人 / 测试人员 / 当前状态 / 判定人 / 判定时间 + 清单地址

### 9. 缺陷（Markdown）

缺陷归属项目，**仅平台内维护**（接口/人工创建，不与飞书同步）。属性：端 / 优先级（高/中/低）/ 预期功能描述 / 实际结果描述 / 图片（多张）/ 用例脚本 / 状态（开放 / 修复 / 关闭）。

#### 9.1 查询缺陷（清单）

```
GET /api/defects.md?projectId={id}[&status=开放|修复|关闭][&priority=高|中|低][&q=关键词]
```

- 返回 Markdown 表格：`ID | 预期 | 端 | 状态 | 优先级 | 项目`；`projectId` 可选（不传返回全部项目），`q` 模糊匹配 预期 + 实际，`status`/`priority` 按枚举筛选（可组合）
- 表格的 `ID` 列即详情链接，直接点开 `GET /api/defects/{defectId}.md` 查看单条

#### 9.2 获取缺陷详情

```
GET /api/defects/{defectId}.md
```

- 返回：元信息（ID/项目/状态/端/优先级/用例/创建·修复·验证·更新时间）+ 预期功能描述 + 实际结果描述 + 图片（`/images/...` 链接）+ 变更记录表（时间/状态/来源/操作人/变更内容/备注）+ "AI 操作"小节（各端点示例）
- 图片为 `/images/...` 相对链接，拼基础地址即可访问

#### 9.3 编辑缺陷（创建 / 更新 / 状态变更 / 变更记录 / 删除）

写入类操作均返回 Markdown 结果：

```bash
# 新建（expected/actual 必填；platform 前端|后端|APP端|未知；priority 高|中|低；images 传上传接口返回的 /images/... 数组；testScript 可选）
curl -X POST {BASE}/api/defects/create.md -H 'Content-Type: application/json' \
  -d '{"projectId": 123, "expected": "登录按钮点击后正常进入首页", "actual": "点击无响应", "platform": "前端", "priority": "高", "images": ["/images/uploads/20261014/xxx.png"], "testScript": "xxx/xxx.test.ts"}'

# 更新字段（可改 platform/priority/status/expected/actual/images/testScript；changeContent/changeRemark 写入变更记录）
curl -X POST {BASE}/api/defects/{defectId}/update.md -H 'Content-Type: application/json' \
  -d '{"priority": "高", "actual": "新的实际结果", "changeContent": "补充信息", "changeRemark": "原因"}'

# 专用状态变更（开放/修复/关闭；可带备注，自动生成变更记录，状态未变化时幂等返回"状态未变化"）
curl -X POST {BASE}/api/defects/{defectId}/status.md -H 'Content-Type: application/json' \
  -d '{"status": "修复", "remark": "研发已修复，等待回归"}'

# 追加变更记录（只记录，不改缺陷字段）
curl -X POST {BASE}/api/defects/{defectId}/records.md -H 'Content-Type: application/json' \
  -d '{"content": "复核处理进度", "remark": "已通知开发"}'

# 删除（仅本地，含变更记录）
curl -X POST {BASE}/api/defects/{defectId}/delete.md
```

- 状态流转：开放 → 修复 → 关闭。标记"修复"无前置校验（表示研发已修复、等待脚本回归验证）；**脚本用例运行通过后后端自动把同项目+同脚本+"修复"态缺陷流转为"关闭"**（记验证时间）；改为"关闭"亦可人工确认
- **变更记录**（append-only，仅本地存储）：创建/状态流转/脚本回归通过自动记录；来源分 录入/AI/自动；操作人取令牌对应用户（系统自动流转为空）；详情 `.md` 末尾附完整记录表（时间/状态/来源/操作人/变更内容/备注）
- 端：前端 / 后端 / APP端 / 未知；优先级：高 / 中 / 低（默认中）
- 图片：`POST /api/images`（multipart，字段 `file`）上传后返回 `/images/...` 链接，缺陷 `images` 存该路径数组（最多 9 张，update 时全量覆盖，空数组清除）

### 10. GitHub 代码分支与提交监听

项目可登记「代码分支」= 该项目涉及修改的 GitHub 仓库与分支（归属标注：后端/H5/安卓/IOS/其它）。登记后平台每分钟轮询该分支，新提交/合并自动记录（后续动作——代码 review、自动化测试等——将基于记录触发）。

#### 10.1 查询提交记录（清单）

```
GET /api/code-events.md?projectId={id}[&repo=][&branch=][&q=关键词][&limit=]
```

- 按提交时间倒序；每条含 时间 / 仓库 @ 分支 / 提交信息首行 / 合并标记 / 作者 / 提交链接
- `projectId` 匹配该项目登记的全部 (仓库+分支) 组合；`q` 模糊匹配 提交信息+作者
- JSON 版：`GET /api/code-events?projectId=`（每条附 `projects` 关联项目数组）

#### 10.2 登记 / 管理代码分支（JSON）

```bash
# 仓库搜索（组织 LitaGroup 下，q 匹配 名称/描述；最多 50 条，按最近更新倒序）
curl '{BASE}/api/github/repos?q=lita-android'
# 分支联想（选定仓库后的全部分支名）
curl '{BASE}/api/github/branches?repo=lita-android'
# 登记代码分支（repo 支持仓库名/全名/完整 URL；category 可选 后端/H5/安卓/IOS/其它，缺省其它）
curl -X POST {BASE}/api/code-branches -H 'Content-Type: application/json' \
  -d '{"projectId": 123, "repo": "lita-android", "branch": "test", "category": "安卓", "remark": "合并到 test 触发回归"}'
# 编辑 / 删除
curl -X PATCH {BASE}/api/code-branches/{id} -H 'Content-Type: application/json' -d '{"branch": "stable"}'
curl -X DELETE {BASE}/api/code-branches/{id}
```

- `repo` 归一化存 `LitaGroup/{name}`，仅支持该组织下的仓库（否则 400）；同项目同 (repo, branch) 唯一
- 监听范围 = 全平台登记的 (repo, branch) 去重集合；分支建议登记 test/main/stable
- 项目详情 `.md` 含「代码分支」小节与本项目提交记录地址；删除项目时登记随之删除（已记录的提交保留）

## 11. 知识库（Markdown + 路径）

知识库以路径组织 Markdown，支持全文 + PGVector 混合检索。独立技能 `knowledge-search` 见 `http://{host}/knowledge/SKILL.md`。

### 11.1 搜索知识（RAG 上下文）

```
GET /api/docs/search.md?q={关键词}[&source=project|feishu|all][&path={目录}][&page=1][&pageSize=8]
```

- `source` 默认 `project`：`project`=站内知识，`feishu`=飞书 Search v2，`all`=两源同时搜索（各返回当前页最多 `pageSize` 条）
- `pageSize` 范围 1..100；`page` 从 1 开始；旧 `limit` 是 `pageSize` 别名
- 飞书搜索使用当前平台用户登录飞书时获得的 `user_access_token`，授权过期需重新登录；飞书关键词最多 50 字
- 报 `99991679 / search:docs:read` 表示飞书应用缺少「搜索云文档」权限：管理员需添加 `search:docs:read`、发布应用版本，然后用户退出并重新登录平台；刷新旧 token 不会补充新权限
- 站内结果带标题、知识路径、章节、相关度、命中方式和原文链接；飞书结果带原文链接与 `markdownUrl`
- `source=all` 时飞书不可用不影响站内结果（飞书小节带 error）
- 先搜索，再按需读取原文；回答时注明知识路径/飞书链接，不要只凭片段推测

### 11.2 飞书文档转 Markdown

```
GET /api/feishu/read.md?url={URL 编码后的飞书文档链接}
```

- 支持 `docx/docs/sheets/base/wiki`；返回带 frontmatter 的完整 Markdown
- 搜索结果的 `markdownUrl` 即该地址，可直接交给下游 Agent

### 11.3 浏览目录 / 读取文章

```
GET /api/docs/detail/.md                              # 根目录
GET /api/docs/detail/guides/.md                       # 目录（结尾斜杠，API 用 /.md）
GET /api/docs/detail/guides/deploy.md                 # 文章（无结尾斜杠，API 用 .md）
GET /api/docs/detail/project/{projectId}/document/{documentId}.md  # 项目文档镜像
```

- 目录返回直接子目录和直接文章；文章返回完整 Markdown
- 项目文档在知识库中只读，修改仍走 `POST /api/documents/upsert.md` 或平台文档详情

### 11.4 维护知识（AI Markdown 接口）

所有接口为 `POST`，JSON body，返回 `text/markdown`。路径使用不带结尾 `/` 的绝对路径（目录也写 `/guides`）。

```bash
# 创建文章（kind=directory 时创建目录，content 忽略）
curl -X POST {BASE}/api/docs/nodes/create.md -H 'Content-Type: application/json' -H "X-Agent-Token: $LITA_PROJECT_TOKEN" \
  -d '{"kind":"article","parentPath":"/guides","name":"deploy","title":"部署说明","content":"# 部署\n\n正文"}'

# 更新正文/标题，或移动/重命名（path 为当前路径，至少再提供一个字段）
curl -X POST {BASE}/api/docs/nodes/update.md -H 'Content-Type: application/json' -H "X-Agent-Token: $LITA_PROJECT_TOKEN" \
  -d '{"path":"/guides/deploy","title":"部署说明 v2","parentPath":"/manual","name":"deploy-v2"}'

# 删除文章；非空目录必须 recursive=true
curl -X POST {BASE}/api/docs/nodes/delete.md -H 'Content-Type: application/json' -H "X-Agent-Token: $LITA_PROJECT_TOKEN" \
  -d '{"path":"/guides/old","recursive":true}'
```

- 创建时 `parentPath` 默认 `/`，父目录必须存在，路径冲突返回 400
- 更新至少提供 `title/content/name/parentPath` 之一；目录移动会递归迁移后代并重建后代向量
- 删除不可恢复；项目同步的 `/project/**` 知识只读，拒绝更新/删除
- 返回内容含节点 ID、原/当前路径、类型、读取地址和网页地址，可直接用于后续复核

## 工作约定

1. 用户提到某个项目但没给 id 时，先走搜索，不要猜 id
2. 判断"上次运行是否正常"时，优先读项目详情中已汇总的最近结果；需要完整过程再取 `runs/{runId}.md`
3. 运行类操作是长耗时动作，使用 `-N` 流式读取即可，无需轮询
4. 所有接口只读为主；会改变系统状态的操作仅有：运行类（run）、脚本更新（pull）与脚本导入（scripts/import.md）、项目配置更新（projects update.md）、文档写入（upsert）与 APIPOST 文档导入（sync-apipost）、节点登记与验收（milestones）、项目提测（projects release.md）与提测结果判定（releases/{id}/status.md）、缺陷创建/状态变更/更新/删除（defects）、代码分支登记/编辑/删除（code-branches）、知识创建/更新/移动/删除（docs/nodes/*.md）
5. 向 scripts 仓库提交代码后，按 5.1 的流程把新脚本导入到项目；导入的 检查/用例 描述默认留空，可在项目详情确认后由人工补充
