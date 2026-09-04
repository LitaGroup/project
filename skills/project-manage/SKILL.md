---
name: project-manage
description: 项目管理平台技能。根据名称模糊搜索项目、获取项目详情（文档/检查/用例/导出/任务及运行信息）、运行检查/用例/导出/任务并流式获取结果、查看系统设置与更新脚本仓库
version: 1.2.0
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
2. 获取项目详情：文档（含 Markdown 正文地址）、类型、描述，以及检查/用例/导出/任务的清单、运行命令、最近运行结果与运行记录
3. 读取文档 Markdown 正文
4. 运行检查/用例/导出/任务，流式读取脚本输出与结果（导出运行详情含产物文件下载链接）
5. 获取平台设置信息、更新脚本仓库

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

- 项目元信息：类型 / 状态 / 优先级 / 预期发布时间 / 迭代周期 / 资源 / 脚本目录
- 描述正文
- 文档清单：类型 + 标题 + 链接 `GET /api/documents/{docId}.md`（该链接即文档正文）
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

返回文档元信息（标题 / 类型 / 来源 / 所属项目 / 更新时间等）+ Markdown 正文全文。

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
GET /api/defects[?projectId=]     # 缺陷列表
```

## 工作约定

1. 用户提到某个项目但没给 id 时，先走搜索，不要猜 id
2. 判断"上次运行是否正常"时，优先读项目详情中已汇总的最近结果；需要完整过程再取 `runs/{runId}.md`
3. 运行类操作是长耗时动作，使用 `-N` 流式读取即可，无需轮询
4. 所有接口只读为主；会改变系统状态的操作仅有：运行类（run）、脚本更新（pull）
