#!/usr/bin/env bash
# LitaWork 开发验收环境部署脚本（在目标服务器执行）
# 用法：bash deploy/dev/deploy.sh
# 前置：{APP_DIR}/backend/.env 已按 deploy/dev/env.example 配置。
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ecs-user/work/litawork}"
BRANCH="${BRANCH:-test}"
SERVICE="${SERVICE:-litawork-backend}"
export PATH="$HOME/.npm-global/bin:$PATH"

cd "$APP_DIR"

if [ ! -f backend/.env ]; then
  echo "缺少 $APP_DIR/backend/.env，请先按 deploy/dev/env.example 配置" >&2
  exit 1
fi

echo "==> 拉取 origin/$BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> 安装依赖"
pnpm install --frozen-lockfile

echo "==> 构建后端"
pnpm -C backend build

echo "==> 构建前端"
pnpm -C frontend build

echo "==> 发布前端静态文件"
sudo rsync -a --delete "$APP_DIR/frontend/dist/" /var/www/work-test.agent.cinta.team/

mkdir -p "$APP_DIR/logs" "$APP_DIR/scripts" "$APP_DIR/webroot-images" "$APP_DIR/export-files" "$APP_DIR/files"

echo "==> 重启后端服务"
sudo systemctl restart "$SERVICE"
sudo systemctl --no-pager --lines=20 status "$SERVICE"

echo "==> 健康检查"
sleep 2
curl -fsS -o /dev/null "http://127.0.0.1:3100/api/auth/feishu"
echo
echo "部署完成：http://work-test.agent.cinta.team"
