# Lita 工作中心

默认访问地址：<http://work.cinta.team>

以 AI 为中心的项目管理平台。技术栈与约定见 [AGENTS.md](./AGENTS.md)。

## 快速开始

```bash
pnpm install
cp backend/.env.example backend/.env   # 填 PostgreSQL 与飞书凭据
pnpm dev:backend    # http://localhost:3100/api
pnpm dev:frontend   # http://localhost:5273
```

## 环境

- 生产：<http://work.cinta.team>
- 开发验收：<http://work-test.agent.cinta.team>（跟踪 `test` 分支，部署说明见 [docs/features/10 - 开发验收环境.md](docs/features/10%20-%20开发验收环境.md)）

## 部署待办

- [ ] **生产 nginx 补充 `/images` 转发规则**：图片上传目录（生产 `DIR_IMAGE_WEBROOT=/home/ecs-user/work/webroot-images`）由后端静态挂载在 `/images` 下，但生产经 nginx（`work.cinta.team`）转发，若 nginx 只代理了 `/api`，需在服务器 nginx 配置中补充 `/images` 的转发（代理到后端 3000，或直接指向该目录），否则 `http://work.cinta.team/images/...` 会 404。
