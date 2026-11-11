import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 待接受卡住提醒计数：tasks 增加 offerStallRemindCount。
 * 待接受超过阈值仍未接受时提醒机器人本身（AI 重发邀约 / 真人工作台卡片），
 * 每任务最多 3 次，北京时间 22:00~08:00 静默；离开待接受（接受/拒绝/撤销/改派）时清零。
 */
export class AddTaskOfferStallRemindCount1798700000000 implements MigrationInterface {
  name = 'AddTaskOfferStallRemindCount1798700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "offerStallRemindCount"
      integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks" DROP COLUMN IF EXISTS "offerStallRemindCount"
    `);
  }
}
