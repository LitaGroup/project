import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 迭代与迭代项（Backlog）：
 * - iterations：T0 常驻快速通道 / W1 周迭代（唯一标识 + 起止日期）；
 * - backlogs：迭代组成单元，只从需求转入，记录原始需求 ID（应用层软引用，不建物理外键）；
 * - feishu_bot_backlog_chats：每个 backlog 创建后绑定一个飞书沟通群。
 * 枚举类型命名遵循 {table}_{column}_enum，与 TypeORM 实体 `type: 'enum'` 推导一致。
 */
export class AddIterations1798900000000 implements MigrationInterface {
  name = 'AddIterations1798900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'iterations_type_enum'
        ) THEN
          CREATE TYPE "iterations_type_enum" AS ENUM ('T0', 'W1');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'iterations_status_enum'
        ) THEN
          CREATE TYPE "iterations_status_enum" AS ENUM ('进行中', '已结束');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'backlogs_status_enum'
        ) THEN
          CREATE TYPE "backlogs_status_enum"
            AS ENUM ('等待', '执行', '测试', '发布', '完成', '取消');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "iterations" (
        "id" SERIAL PRIMARY KEY,
        "code" varchar(50) NOT NULL UNIQUE,
        "type" "iterations_type_enum" NOT NULL DEFAULT 'W1',
        "name" varchar(200) NOT NULL,
        "startAt" date,
        "endAt" date,
        "status" "iterations_status_enum" NOT NULL DEFAULT '进行中',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_iterations_type"
      ON "iterations" ("type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_iterations_status"
      ON "iterations" ("status")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "backlogs" (
        "id" SERIAL PRIMARY KEY,
        "code" varchar(30) NOT NULL UNIQUE,
        "iterationId" integer NOT NULL,
        "projectId" integer NOT NULL,
        "title" varchar(200) NOT NULL,
        "status" "backlogs_status_enum" NOT NULL DEFAULT '等待',
        "ownerWorkerId" integer,
        "ownerName" varchar(100),
        "members" json,
        "taskId" integer,
        "statusBy" varchar(100),
        "startedAt" timestamptz,
        "testingAt" timestamptz,
        "releasingAt" timestamptz,
        "completedAt" timestamptz,
        "canceledAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_backlogs_iterationId"
      ON "backlogs" ("iterationId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_backlogs_projectId"
      ON "backlogs" ("projectId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_backlogs_status"
      ON "backlogs" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_backlogs_ownerWorkerId"
      ON "backlogs" ("ownerWorkerId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "feishu_bot_backlog_chats" (
        "id" SERIAL PRIMARY KEY,
        "backlogId" integer NOT NULL UNIQUE,
        "officialConfigId" integer NOT NULL,
        "chatId" varchar(100),
        "state" varchar(20) NOT NULL DEFAULT 'creating',
        "name" varchar(120) NOT NULL,
        "backlogTitle" varchar(200) NOT NULL,
        "memberUserIds" json NOT NULL DEFAULT '[]',
        "memberNames" json NOT NULL DEFAULT '[]',
        "botIds" json NOT NULL DEFAULT '[]',
        "lastStatus" varchar(40),
        "finishedAt" timestamptz,
        "finishedNotified" boolean NOT NULL DEFAULT false,
        "destroyAfter" timestamptz,
        "attempts" integer NOT NULL DEFAULT 0,
        "lastError" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_feishu_bot_backlog_chats_backlogId"
      ON "feishu_bot_backlog_chats" ("backlogId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_feishu_bot_backlog_chats_chatId"
      ON "feishu_bot_backlog_chats" ("chatId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_feishu_bot_backlog_chats_state"
      ON "feishu_bot_backlog_chats" ("state")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "feishu_bot_backlog_chats"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "backlogs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "iterations"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "backlogs_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "iterations_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "iterations_type_enum"`);
  }
}
