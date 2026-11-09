import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 机器人 MCP 配置：
 * - mcp_servers：管理区「MCP 配置」维护的外部 MCP 服务（remote/local + 鉴权方式）；
 * - workers.mcps：机器人勾选的服务 id 列表（simple-json，无物理外键）。
 */
export class AddMcpServers1797800000000 implements MigrationInterface {
  name = 'AddMcpServers1797800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'mcp_servers_type_enum'
        ) THEN
          CREATE TYPE "mcp_servers_type_enum" AS ENUM ('remote', 'local');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'mcp_servers_authMode_enum'
        ) THEN
          CREATE TYPE "mcp_servers_authMode_enum" AS ENUM ('none', 'fixed', 'env', 'work-token');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "mcp_servers" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar(100) NOT NULL,
        "type" "mcp_servers_type_enum" NOT NULL DEFAULT 'remote',
        "url" varchar(500),
        "command" text,
        "authMode" "mcp_servers_authMode_enum" NOT NULL DEFAULT 'none',
        "authHeader" varchar(64) NOT NULL DEFAULT 'Authorization',
        "authPrefix" varchar(64),
        "authSecret" varchar(512),
        "enabled" boolean NOT NULL DEFAULT true,
        "remark" varchar(500),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_mcp_servers_name"
      ON "mcp_servers" ("name")
    `);
    await queryRunner.query(`
      ALTER TABLE "workers"
      ADD COLUMN IF NOT EXISTS "mcps" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN IF EXISTS "mcps"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "mcp_servers"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "mcp_servers_authMode_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "mcp_servers_type_enum"`);
  }
}
