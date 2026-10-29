import { MigrationInterface, QueryRunner } from 'typeorm';

/** 开放技术工单创建（方案工单、技术工单）。 */
export class EnableTechTicket1794310000000 implements MigrationInterface {
  name = 'EnableTechTicket1794310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('ticket_configs'))) return;
    await queryRunner.query(
      `UPDATE "ticket_configs" SET "enabled" = true WHERE "category" = '技术工单'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('ticket_configs'))) return;
    await queryRunner.query(
      `UPDATE "ticket_configs" SET "enabled" = false WHERE "category" = '技术工单'`,
    );
  }
}
