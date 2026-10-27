import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import * as fs from 'fs';
import { AgentGateway } from './agent/agent.gateway';
import { AppModule } from './app.module';
import { imageWebroot, exportWebroot, fileWebroot } from './common/paths';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, credentials: true }); // 开发期放开，前端 Vite dev server 直连；credentials 供登录 Cookie 跨端携带

  // 图片静态资源：http://{host}/images/{image-path} → DIR_IMAGE_WEBROOT（不走 /api 前缀）
  const webroot = imageWebroot();
  fs.mkdirSync(webroot, { recursive: true });
  app.use('/images', express.static(webroot, { index: false }));

  // 导出产物静态资源：http://{host}/export-files/{exportId}/{runId}/{file} → DIR_EXPORT_WEBROOT（不走 /api 前缀）
  const exportsRoot = exportWebroot();
  fs.mkdirSync(exportsRoot, { recursive: true });
  app.use('/export-files', express.static(exportsRoot, { index: false }));

  // 通用文件静态资源：http://{host}/files/{file-path} → DIR_FILE_WEBROOT（公开访问）
  const filesRoot = fileWebroot();
  fs.mkdirSync(filesRoot, { recursive: true });
  app.use(
    '/files',
    express.static(filesRoot, {
      index: false,
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // 上传内容与平台同域：禁止上传的 HTML/SVG 等主动内容执行脚本或访问平台 Cookie
        res.setHeader(
          'Content-Security-Policy',
          "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
        );
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3100);

  // WebSocket server（appium-agent 连接）：ws://host:port/api/ws?token=...
  // 放在 /api 前缀下，生产反代一条 /api 规则即可覆盖（仍需支持 Upgrade 头）
  const agentGateway = app.get(AgentGateway);
  agentGateway.attachToServer(app.getHttpServer());
}
void bootstrap();
