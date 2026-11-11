import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 群记录补充话题维度：
 * - feishu_bot_group_records.threadId：话题群/话题回复消息与机器人回执记录带上 thread_id，
 *   便于管理页按话题排查时间线，也为话题会话隔离提供排查依据。
 */
export class AddFeishuBotGroupRecordThread1798300000000 implements MigrationInterface {
  name = 'AddFeishuBotGroupRecordThread1798300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('feishu_bot_group_records'))) return;
    if (
      !(await queryRunner.hasColumn('feishu_bot_group_records', 'threadId'))
    ) {
      await queryRunner.query(
        `ALTER TABLE "feishu_bot_group_records" ADD COLUMN "threadId" varchar(100)`,
      );
    }
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_feishu_bot_group_records_thread" ON "feishu_bot_group_records" ("groupId", "threadId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('feishu_bot_group_records'))) return;
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_feishu_bot_group_records_thread"`,
    );
    if (await queryRunner.hasColumn('feishu_bot_group_records', 'threadId')) {
      await queryRunner.query(
        `ALTER TABLE "feishu_bot_group_records" DROP COLUMN "threadId"`,
      );
    }
  }
}
