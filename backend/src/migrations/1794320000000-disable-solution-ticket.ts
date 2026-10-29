import { MigrationInterface, QueryRunner } from 'typeorm';

/** 关闭方案工单创建；历史方案工单与内置调度定义保留。 */
export class DisableSolutionTicket1794320000000 implements MigrationInterface {
  name = 'DisableSolutionTicket1794320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('ticket_configs'))) return;
    await queryRunner.query(
      `UPDATE "ticket_configs" SET "enabled" = false WHERE "category" = '方案工单'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('ticket_configs'))) return;
    await queryRunner.query(
      `UPDATE "ticket_configs" SET "enabled" = true WHERE "category" = '方案工单'`,
    );
  }
}
