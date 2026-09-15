---
name: project-manage
description: 项目管理平台技能。根据名称模糊搜索项目、获取项目详情（文档/资源/节点/检查/用例/导出/任务及运行信息）、运行检查/用例/导出/任务并流式获取结果、写入/更新项目文档、登记与验收节点、查看/创建/更新/删除缺陷、查看系统设置与更新脚本仓库
version: 1.6.0
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
2. 获取项目详情：文档（含 Markdown 正文地址）、类型、描述，以及资源/节点/检查/用例/导出/任务的清单、运行命令、最近运行结果与运行记录
3. 读取文档 Markdown 正文；写入/更新项目文档（按 fileName upsert）
4. 运行检查/用例/导出/任务，流式读取脚本输出与结果（导出运行详情含产物文件下载链接）
5. 登记项目节点（时间点事项），研发验收后标记达成
6. 查看/创建/更新/删除项目缺陷（含飞书同步来源）
7. 获取平台设置信息、更新脚本仓库

本文件可通过 `http://{host}/SKILL.md` 直接获取。所有请求 URL 以 `.md` 结尾，响应均为 `text/markdown`。

## 基础地址

- 测试环境：`http://project.cinta.team`（生产同域，按实际环境替换）
- 所有路径省略前缀写法如下文，调用时拼在基础地址后（如 `{BASE}/api/projects/search.md?q=pk`）

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
- 任务清单：标题、cron、绑定的检查编号、开关状态、上次执行时间、下次执行时间、上次执行结果 + 详情链接、执行命令 `POST /api/tasks/{taskId}/run.md`、运行记录地址 `GET /api/tasks/{taskId}/runs`
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

### 4. 运行检查 / 用例 / 导出 / 任务（流式）

```bash
curl -N -X POST {BASE}/api/checks/{checkId}/run.md   # 运行一次检查
curl -N -X POST {BASE}/api/tests/{testId}/run.md     # 运行一次用例
curl -N -X POST {BASE}/api/exports/{exportId}/run.md # 运行一次导出
curl -N -X POST {BASE}/api/tasks/{taskId}/run.md     # 手动触发一次任务
```

- 必须带 `-N`（禁用缓冲）以逐行读取
- 响应格式：先头部信息（运行 ID、脚本、详情地址），随后"输出"小节为脚本原始输出逐行追加，终态后附"结果"小节（状态 / 进度 / 成功失败跳过数 / 耗时 / 消息）后结束
- 拿到运行 ID 后也可单次获取详情：

```
GET /api/checks/runs/{runId}.md   # 检查 / 任务的运行详情
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

### 6. 全局列表（JSON，非 .md）

需要跨项目列举数据时使用常规 JSON 接口（`projectId` 均可选，不传返回全部）：

```
GET /api/checks[?projectId=]      # 检查列表
GET /api/tests[?projectId=]       # 用例列表
GET /api/exports[?projectId=]     # 导出列表
GET /api/documents[?projectId=]   # 文档列表（不含正文）
GET /api/tasks[?projectId=]       # 任务列表（附下次执行时间与运行统计）
GET /api/defects[?projectId=]     # 缺陷列表（Markdown 版见第 8 节 /api/defects.md）
GET /api/resources[?projectId=&includeDeleted=]  # 资源列表（不含多语言缓存正文；includeDeleted=true 含软删除）
GET /api/milestones[?projectId=]  # 节点列表（按日期升序，附推导状态）
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

### 8. 缺陷（Markdown）

缺陷归属项目，来源分 脚本 / 飞书 / 录入，状态分 开放 / 修复 / 关闭。飞书来源与项目绑定的多维表格双向同步（同步/回写由平台处理）：

```
GET  /api/defects.md?projectId={id}[&status=开放|修复|关闭][&source=脚本|飞书|录入][&q=关键词]   # 缺陷清单
GET  /api/defects/{defectId}.md                          # 详情（含步骤/预期/实际/截图/备注）
```

写入类操作（均返回 Markdown 结果）：

```bash
curl -X POST {BASE}/api/defects/create.md -H 'Content-Type: application/json' \
  -d '{"projectId": 123, "title": "登录按钮点击无响应", "steps": "1. 打开登录页\n2. 点击登录", "expected": "正常登录", "actual": "无响应", "developer": "张三", "tester": "李四", "platform": "前端", "testScript": "xxx/xxx.test.ts"}'  # source 缺省=录入，可传 脚本
curl -X POST {BASE}/api/defects/{defectId}/update.md -H 'Content-Type: application/json' \
  -d '{"status": "修复"}'   # 可改 title/platform/status/steps/expected/actual/developer/tester/testScript/remark
curl -X POST {BASE}/api/defects/{defectId}/delete.md      # 删除（仅本地，不影响飞书）
```

- 状态流转：改为"修复"时——有 `testScript` 则须该用例最近一次运行通过（否则 400），无则允许手动改；**用例运行通过后后端自动把同项目+同脚本+开放态缺陷流转为"修复"**；改为"关闭"记录验证时间（人工二次确认）
- 端：前端 / 后端 / APP端 / 未知；飞书"人员"字段同步到 `developer`
- 正文图片：`POST /api/images`（multipart，字段 `file`）上传后返回 `/images/...` 链接，可内嵌进 `steps` Markdown

## 工作约定

1. 用户提到某个项目但没给 id 时，先走搜索，不要猜 id
2. 判断"上次运行是否正常"时，优先读项目详情中已汇总的最近结果；需要完整过程再取 `runs/{runId}.md`
3. 运行类操作是长耗时动作，使用 `-N` 流式读取即可，无需轮询
4. 所有接口只读为主；会改变系统状态的操作仅有：运行类（run）、脚本更新（pull）、文档写入（upsert）与 APIPOST 文档导入（sync-apipost）、节点登记与验收（milestones）、缺陷创建/更新/删除（defects）
