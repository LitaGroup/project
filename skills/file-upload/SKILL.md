---
name: file-upload
description: "上传任意文件到项目管理平台并返回无需登录即可访问的公共 URL。Use when: 需要分享报告、图片、压缩包、日志、文档或其他生成的文件。"
version: 1.0.0
author: Lita R&D Team
tags:
  - 文件
  - 上传
  - 分享
  - URL
---

# File Upload 文件上传技能

将本地任意文件上传到项目管理平台，返回一个无需登录、无需 Token 的公共访问 URL。

## 能力与限制

- 支持任意文件类型（图片、文档、表格、压缩包、日志、音视频等）。
- 单文件最大 **50 MB**，每次请求只上传一个文件。
- 上传需要 Agent 访问令牌；上传成功后的公共 URL 不鉴权，任何拿到链接的人都能访问。
- 文件长期保存，当前不提供自动过期或删除接口。
- 响应为 `text/markdown`，公共地址同时出现在 frontmatter 的 `url` 和正文的「公开地址」中。

## 基础地址

- 测试环境：`http://project.cinta.team`
- 生产环境按实际域名替换。
- 下文以 `{BASE}` 表示基础地址（不含 `/api`）。

## 鉴权

上传接口 `/api/files/upload.md` 使用个人 Agent 访问令牌或公共 Agent 令牌。公共下载地址不需要鉴权。

令牌获取顺序：

1. 环境变量 `LITA_PROJECT_TOKEN`
2. `~/.env` 中的 `LITA_PROJECT_TOKEN`
3. 以上都没有时，请用户登录平台「个人中心 → Agent 访问令牌」复制

```bash
# 优先读取进程环境变量，其次读取 ~/.env
TOKEN="${LITA_PROJECT_TOKEN:-$(grep '^LITA_PROJECT_TOKEN=' ~/.env 2>/dev/null | cut -d= -f2-)}"
```

## 上传文件

```http
POST /api/files/upload.md
Content-Type: multipart/form-data
```

multipart 字段名固定为 `file`。

```bash
curl -fsS \
  -H "X-Agent-Token: $TOKEN" \
  -F "file=@/path/to/report.pdf" \
  "{BASE}/api/files/upload.md"
```

需要自定义上传后的原始文件名时：

```bash
curl -fsS \
  -H "X-Agent-Token: $TOKEN" \
  -F "file=@/tmp/result;filename=测试报告.pdf" \
  "{BASE}/api/files/upload.md"
```

## 成功响应

```markdown
---
update: "2026-10-27 15:30:00"
title: "文件上传成功"
filename: "report.pdf"
url: "http://project.cinta.team/files/20261027/7f7c0f5e-7d9b-4fc3-b4b8-8c780bc8f80c.pdf"
---

# 文件上传成功

- 文件名：report.pdf
- 大小：1.2 MB
- 类型：application/pdf
- 公开地址：http://project.cinta.team/files/20261027/7f7c0f5e-7d9b-4fc3-b4b8-8c780bc8f80c.pdf

该地址无需登录或 Token 即可公开访问。
```

Agent 应提取 frontmatter 的 `url`（或正文中的「公开地址」）返回给用户。

## 验证公开地址

```bash
curl -I "http://project.cinta.team/files/20261027/7f7c0f5e-7d9b-4fc3-b4b8-8c780bc8f80c.pdf"
```

预期返回 `200`，且不需要携带 `X-Agent-Token` 或 Cookie。

## 常见错误

| 状态码 | 原因 | 处理方式 |
|:---|:---|:---|
| `400` | 缺少 multipart 字段 `file` | 确认使用 `-F "file=@..."` |
| `401` | Token 缺失或无效 | 按「鉴权」重新获取并设置 `LITA_PROJECT_TOKEN` |
| `413` | 文件超过 50 MB | 压缩或拆分文件后重试 |
| `5xx` | 服务不可用或存储写入失败 | 稍后重试；持续失败时反馈服务端日志 |

## 安全说明

- 公共链接一旦泄露，任何人均可访问；不要上传密钥、凭据等敏感文件。
- 下载响应带 `Content-Security-Policy: sandbox` 与 `X-Content-Type-Options: nosniff`，上传的 HTML/SVG 不会在平台域名下执行脚本。
- 图片如需嵌入 Markdown 正文，继续使用平台的 `POST /api/images` 接口；本技能用于通用文件分享。
