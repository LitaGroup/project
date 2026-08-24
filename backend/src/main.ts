import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import * as fs from 'fs';
import { AppModule } from './app.module';
import { imageWebroot } from './common/paths';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true }); // 开发期放开，前端 Vite dev server 直连

  // 图片静态资源：http://{host}/images/{image-path} → DIR_IMAGE_WEBROOT（不走 /api 前缀）
  const webroot = imageWebroot();
  fs.mkdirSync(webroot, { recursive: true });
  app.use('/images', express.static(webroot, { index: false }));

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
