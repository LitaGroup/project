---
name: knowledge-search
description: 在项目管理平台知识库中搜索、浏览、读取、创建、更新、移动和删除 Markdown 知识，基于 PGVector + 全文混合检索获取带来源引用的 RAG 上下文
version: 1.1.0
author: Lita R&D Team
tags:
  - 知识库
  - RAG
  - 搜索
  - markdown
---

# 知识库技能

## 用途

项目管理平台的知识库以 **Markdown 文章 + 路径目录** 组织，项目文档会自动同步到固定路径。你可以使用本技能：

1. 搜索知识并获得可引用的上下文片段。
2. 浏览知识目录（子目录 + 文章）。
3. 读取指定文章的完整 Markdown。
4. 读取项目文档在知识库中的镜像。
5. 创建、更新、移动、重命名和删除知识文章/目录。

项目同步知识（`/project/**`）只读；其余 `native` 知识可由 Agent 维护。

## 基础地址与鉴权

- 测试环境：`http://project.cinta.team`（生产同域，按实际环境替换）
- 所有 `/api/docs/**/*.md` 地址都要求鉴权，携带个人 Agent 访问令牌：

```bash
# 推荐：请求头
curl -H "X-Agent-Token: $LITA_PROJECT_TOKEN" \
  "{BASE}/api/docs/search.md?q=部署"

# 或 URL 参数
curl "{BASE}/api/docs/search.md?q=部署&token=$LITA_PROJECT_TOKEN"
```

令牌获取顺序：

1. 环境变量 `LITA_PROJECT_TOKEN`。
2. `~/.env` 中的 `LITA_PROJECT_TOKEN`。
3. 请用户打开平台「个人中心 → Agent 访问令牌」复制。

响应均为 `text/markdown`，以 YAML frontmatter 开头。

## 1. 搜索知识（RAG）

```http
GET /api/docs/search.md?q={关键词或问题}[&source=project|feishu|all][&path={目录}][&page=1][&pageSize=8]
```

- `source`：数据源，默认 `project`
  - `project`：站内知识（Markdown + PGVector + 全文检索）
  - `feishu`：直接调用飞书 Search v2，搜索当前登录用户可见的飞书云文档
  - `all`：同时搜索站内知识和飞书，各返回当前页最多 `pageSize` 条
- `path`：可选，仅对站内知识生效，限定该目录及其后代。
- `page`：页码，从 1 开始；`pageSize`：每页条数，1..100，默认 8。旧参数 `limit` 仍可作为 `pageSize` 别名。
- 飞书关键词最多 50 字（飞书 Search v2 限制）。
- 返回每条站内结果的标题、知识路径、章节、相关度、命中方式（`fulltext`/`vector`/`hybrid`）、知识片段、原文 Markdown 地址。
- 返回每条飞书结果的标题、类型、原文链接、所有者、更新时间、摘要，以及 `markdownUrl`（飞书全文转 Markdown 接口）。
- 飞书搜索依赖用户 `user_access_token`：Agent 的 `X-Agent-Token` 对应平台用户，该用户需至少成功登录过平台；授权过期会提示重新登录。
- `source=all` 时若飞书搜索不可用，站内结果仍正常返回，飞书小节带 `error`。

示例：

```bash
# 站内
curl -s -H "X-Agent-Token: $LITA_PROJECT_TOKEN" \
  "$BASE/api/docs/search.md?q=登录失败排查&source=project&page=1&pageSize=20"

# 站内 + 飞书，各返回前 10 条
curl -s -H "X-Agent-Token: $LITA_PROJECT_TOKEN" \
  "$BASE/api/docs/search.md?q=需求评审&source=all&page=1&pageSize=10"

# 仅飞书
curl -s -H "X-Agent-Token: $LITA_PROJECT_TOKEN" \
  "$BASE/api/docs/search.md?q=OKR&source=feishu&page=1&pageSize=20"
```

### 1.1 飞书文档转 Markdown

```http
GET /api/feishu/read.md?url={URL 编码后的飞书文档链接}
```

- 支持 `docx/docs/sheets/base/wiki` 链接；电子表格可用 `?sheet=` 指定工作表，多维表格可用 `?table=&view=`。
- 返回带 frontmatter 的完整 Markdown，可直接保存或提交给下游。
- 搜索结果里的 `markdownUrl` 就是该接口地址。

```bash
curl -s -H "X-Agent-Token: $LITA_PROJECT_TOKEN" \
  "$BASE/api/feishu/read.md?url=https%3A%2F%2Fxxx.feishu.cn%2Fdocx%2FABC123"
```

**推荐流程**：

1. 用自然语言问题或关键术语搜索；需要跨站内和飞书时使用 `source=all`。
2. 阅读返回片段，判断是否需要完整上下文。
3. 站内对关键结果继续读取“原文”地址；飞书调用 `markdownUrl` 获取全文。
4. 基于原文回答，并注明知识路径或飞书链接。

不要仅凭片段编造未出现的内容；片段不足时明确说明。

## 2. 浏览目录

目录地址必须带结尾斜杠，API 使用 `/.md`：

```http
GET /api/docs/detail/.md                     # 根目录
GET /api/docs/detail/guides/.md              # /guides
GET /api/docs/detail/guides/deploy/v2/.md    # /guides/deploy/v2
```

响应返回**直接子目录**和**直接文章**的 Markdown 链接。中文和空格路径段需要 URL 编码，保留 `/` 层级。

## 3. 读取文章

```http
GET /api/docs/detail/guides/deploy/v2.md
```

对应知识路径为 `/guides/deploy/v2`。目录不要加 `.md`（目录用 `/.md`），文章要加 `.md`。

## 4. 读取项目文档

项目中 ID 为 `{documentId}` 的文档同步在以下固定路径：

```text
/project/{projectId}/document/{documentId}
```

访问：

```http
GET /api/docs/detail/project/123/document/456.md
```

项目文档在知识库中为只读镜像，修改请回到平台文档详情页或使用 `project-manage` 技能。

## 5. 维护知识（AI 写接口）

以下接口均使用 `POST`、JSON 请求体，返回 `text/markdown`。路径统一使用**不带结尾 `/` 的绝对路径**（目录也写 `/guides`，不要写 `/guides/`）；目录的读取地址才使用 `/.md`。

### 5.1 创建文章或目录

```http
POST /api/docs/nodes/create.md
Content-Type: application/json

{
  "kind": "article",
  "parentPath": "/guides",
  "name": "deploy",
  "title": "部署说明",
  "content": "# 部署说明\n\n正文 Markdown"
}
```

- `kind=article` 创建文章，`content` 为 Markdown 正文；`kind=directory` 创建目录，`content` 忽略。
- `parentPath` 默认 `/`；父目录必须存在。
- `name` 是单个路径段，不能包含 `/` 或 `..`；`title` 可选，缺省取 `name`。
- 同名路径已存在返回 400，不会覆盖。
- 返回创建结果的 ID、路径、读取地址、网页地址和后续更新/删除调用示例。

### 5.2 更新正文、标题、移动或重命名

```http
POST /api/docs/nodes/update.md
Content-Type: application/json

{
  "path": "/guides/deploy",
  "title": "部署说明 v2",
  "content": "# 新正文",
  "parentPath": "/manual",
  "name": "deploy-v2"
}
```

- `path` 是当前路径，必填；至少再提供一个 `title/content/name/parentPath`。
- 只更新提供的字段。`content` 仅对文章有效。
- 提供 `parentPath` 和/或 `name` 会移动/重命名；目录移动会同步迁移全部后代，并触发后代文章重新生成向量。
- 更新后返回原路径、当前路径和新的读取地址。
- 项目同步知识（`source=project-document`）返回 403。

### 5.3 删除文章或目录

```http
POST /api/docs/nodes/delete.md
Content-Type: application/json

{"path": "/guides/old", "recursive": true}
```

- 删除文章无需 `recursive`。
- 删除空目录无需 `recursive`；**删除非空目录必须显式传 `recursive: true`**，否则返回 400。
- 删除不可恢复；项目同步知识不会被删除。
- 返回被删除节点的 ID、路径、类型和递归标记。

**推荐维护流程**：先搜索/读取确认目标 → 创建或更新 → 用返回的读取地址复核内容。批量维护时逐条操作，不要猜测 ID 或不存在的父目录。

## 常见问题

- **401**：缺少或无效 `X-Agent-Token`，按上文重新取令牌。
- **飞书搜索 99991679 / search:docs:read**：飞书应用未开通「搜索云文档」用户权限。管理员需在飞书开放平台「权限管理」添加 `search:docs:read`，创建并发布应用版本，然后用户退出并重新登录本平台以刷新授权；仅刷新旧 token 不会增加新权限。
- **404 目录不存在**：检查目录是否带结尾 `/`，并且 API 地址以 `/.md` 结尾。
- **404 文章不存在**：检查文章路径是否没有结尾 `/`，API 地址以 `.md` 结尾。
- **503 知识库不可用**：平台尚未配置 PostgreSQL/PGVector，或数据库暂不可用；不要反复重试，告知用户检查知识库配置。
- **搜索降级为 fulltext**：Embedding 未配置或临时失败，检索结果仍可正常使用。
