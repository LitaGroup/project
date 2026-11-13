import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 平台名义飞书消息审计表：任何以平台官方机器人发出的消息落一条，
 * 记录发送方、收件人、正文摘要与飞书返回的 messageId，便于追溯。
 */
export class AddFeishuBotOfficialMessages1799400000000 implements MigrationInterface {
  name = 'AddFeishuBotOfficialMessages1799400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "feishu_bot_official_messages" (
        "id" SERIAL PRIMARY KEY,
        "senderType" varchar(10) NOT NULL,
        "senderId" integer NOT NULL,
        "senderName" varchar(120) NOT NULL,
        "targetType" varchar(10) NOT NULL,
        "targetId" varchar(100) NOT NULL,
        "targetUserId" integer,
        "targetName" varchar(120),
        "title" varchar(120),
        "content" text NOT NULL,
        "contentLength" integer NOT NULL DEFAULT 0,
        "replyToMessageId" varchar(100),
        "messageIds" jsonb,
        "status" varchar(10) NOT NULL DEFAULT 'success',
        "error" text,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_feishu_bot_official_messages_createdAt"
      ON "feishu_bot_official_messages" ("createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_feishu_bot_official_messages_sender"
      ON "feishu_bot_official_messages" ("senderType", "senderId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "feishu_bot_official_messages"`,
    );
  }
}
