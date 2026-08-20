import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true }); // 开发期放开，前端 Vite dev server 直连
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
