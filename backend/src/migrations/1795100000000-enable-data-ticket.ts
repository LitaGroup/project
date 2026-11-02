import { MigrationInterface, QueryRunner } from 'typeorm';

/** 开放数据工单创建（技术工单、数据工单）。 */
export class EnableDataTicket1795100000000 implements MigrationInterface {
  name = 'EnableDataTicket1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('ticket_configs'))) return;
    await queryRunner.query(
      `UPDATE "ticket_configs" SET "enabled" = true WHERE "category" = '数据工单'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('ticket_configs'))) return;
    await queryRunner.query(
      `UPDATE "ticket_configs" SET "enabled" = false WHERE "category" = '数据工单'`,
    );
  }
}
