# 飞书集成调用示例

后端已启动（`pnpm dev:backend`）且 `.env` 配好 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 后可用。

> 自建应用需在飞书开放平台开通对应读权限：
> 云文档 `docx:document:readonly`、表格 `sheets:spreadsheet:readonly`、
> 多维表格 `bitable:app:readonly`、知识库 `wiki:wiki:readonly`（链接为 wiki 节点时需要）。

## 预览飞书链接内容（不落库）

```bash
# 新版文档
curl 'http://localhost:3000/api/feishu/read?url=https://xxx.feishu.cn/docx/ABC123'

# 电子表格
curl 'http://localhost:3000/api/feishu/read?url=https://xxx.feishu.cn/sheets/ABC123'

# 多维表格
curl 'http://localhost:3000/api/feishu/read?url=https://xxx.feishu.cn/base/ABC123'

# 知识库节点（自动解析为实际文档类型）
curl 'http://localhost:3000/api/feishu/read?url=https://xxx.feishu.cn/wiki/ABC123'
```

## 一键同步飞书文档到项目

```bash
curl -X POST http://localhost:3000/api/documents/sync-feishu \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": 1,
    "type": "需求",
    "url": "https://xxx.feishu.cn/docx/ABC123"
  }'
```

同一项目下重复同步同一飞书文档会覆盖更新（按 `feishuToken` 判重）。

## 从飞书多维表格增量同步项目

```bash
curl -X POST http://localhost:3000/api/projects/sync-feishu
# {"since":"2026-08-12T03:15:16.714Z","firstSync":false,"scanned":11,"synced":11}
```

默认源为"研发项目管理"多维表格（见 `backend/src/projects/project-sync.service.ts`）。
首次同步取近 15 天有更新的记录，之后每次取近 7 天；重复执行按 `record_id` 覆盖更新，不会产生重复项目。
