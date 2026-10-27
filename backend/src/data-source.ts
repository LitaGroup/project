import 'reflect-metadata';
import { config } from 'dotenv';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { DataSource } from 'typeorm';

// 配置来源与 app.module 一致：进程环境变量 > backend/.env > ~/.env
config({ path: resolve(process.cwd(), '.env'), quiet: true });
config({ path: resolve(homedir(), '.env'), quiet: true, override: false });

/**
 * TypeORM CLI 数据源（生产迁移用）。
 * 运行时业务连接仍由 AppModule 的 TypeOrmModule.forRootAsync 提供；
 * 生产环境 synchronize 关闭，结构变更必须通过 src/migrations 执行。
 * 用法：pnpm -C backend db:migration:run / db:migration:revert
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || process.env.PROJECT_PG_PASSWORD || '',
  database: process.env.DB_NAME || 'project',
  ssl:
    process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  // 与 AppModule 的 TypeORM 配置保持一致：连接级固定会话时区
  extra: { options: '-c timezone=Asia/Shanghai' },
  entities: [join(__dirname, '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
  synchronize: false,
});
