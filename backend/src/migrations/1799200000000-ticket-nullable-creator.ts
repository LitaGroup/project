import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 工单创建人可空：AI 机器人可直接发起工单（发起机器人记 initiatorWorkerId），
 * 此时没有对应的真人用户；真人机器人发起仍记录 createdById。
 */
export class TicketNullableCreator1799200000000 implements MigrationInterface {
  name = 'TicketNullableCreator1799200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tickets" ALTER COLUMN "createdById" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回退不保留「AI 机器人发起」语义：无创建人的工单统一记为 0（未知用户）
    await queryRunner.query(
      `UPDATE "tickets" SET "createdById" = 0 WHERE "createdById" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tickets" ALTER COLUMN "createdById" SET NOT NULL`,
    );
  }
}
