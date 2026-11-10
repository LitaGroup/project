import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 审批任务飞书卡片登记表：
 * - 工单审批任务发送飞书卡片时落库 messageId；
 * - 卡片「通过」回调按任务定位并回写状态，同时更新卡片内容。
 */
export class AddFeishuBotApprovalCards1798000000001 implements MigrationInterface {
  name = 'AddFeishuBotApprovalCards1798000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "feishu_bot_approval_cards" (
        "id" SERIAL PRIMARY KEY,
        "configId" integer NOT NULL,
        "ticketId" integer NOT NULL,
        "taskId" integer NOT NULL,
        "messageId" varchar(100),
        "state" varchar(20) NOT NULL DEFAULT 'pending',
        "actedById" integer,
        "actedByName" varchar(100),
        "actedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_feishu_bot_approval_cards_task" ON "feishu_bot_approval_cards" ("taskId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "feishu_bot_approval_cards"`);
  }
}
