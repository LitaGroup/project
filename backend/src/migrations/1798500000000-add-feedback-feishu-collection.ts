import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 反馈群话题采集（「系统-反馈处理」机器人）：
 * - feedbacks 增加来源字段：source（平台/飞书群）、sourceChatId、sourceThreadId、sourceMessageId，
 *   并按 (sourceChatId, sourceThreadId) 建部分唯一索引，防止同一飞书话题重复建反馈；
 * - feedback_replies：话题内后续成员消息的跟帖记录（append-only），
 *   (feedbackId, sourceMessageId) 唯一用于消息事件去重。
 * 枚举类型命名遵循 {table}_{column}_enum，与 TypeORM 实体 `type: 'enum'` 推导一致。
 */
export class AddFeedbackFeishuCollection1798500000000 implements MigrationInterface {
  name = 'AddFeedbackFeishuCollection1798500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'feedbacks_source_enum'
        ) THEN
          CREATE TYPE "feedbacks_source_enum" AS ENUM ('平台', '飞书群');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "feedbacks"
        ADD COLUMN IF NOT EXISTS "source" "feedbacks_source_enum" NOT NULL DEFAULT '平台',
        ADD COLUMN IF NOT EXISTS "sourceChatId" varchar(100),
        ADD COLUMN IF NOT EXISTS "sourceThreadId" varchar(100),
        ADD COLUMN IF NOT EXISTS "sourceMessageId" varchar(100)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_feedbacks_feishu_thread"
      ON "feedbacks" ("sourceChatId", "sourceThreadId")
      WHERE "source" = '飞书群' AND "sourceThreadId" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "feedback_replies" (
        "id" SERIAL PRIMARY KEY,
        "feedbackId" integer NOT NULL,
        "senderName" varchar(120),
        "senderUserId" integer,
        "senderOpenId" varchar(100),
        "content" text NOT NULL,
        "images" json,
        "sourceMessageId" varchar(100),
        "sourceThreadId" varchar(100),
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_feedback_replies_feedback"
      ON "feedback_replies" ("feedbackId", "id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_feedback_replies_feedback_message"
      ON "feedback_replies" ("feedbackId", "sourceMessageId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_feedback_replies_feedback_message"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_feedback_replies_feedback"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "feedback_replies"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_feedbacks_feishu_thread"`,
    );
    await queryRunner.query(`
      ALTER TABLE "feedbacks"
        DROP COLUMN IF EXISTS "sourceMessageId",
        DROP COLUMN IF EXISTS "sourceThreadId",
        DROP COLUMN IF EXISTS "sourceChatId",
        DROP COLUMN IF EXISTS "source"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "feedbacks_source_enum"`);
  }
}
