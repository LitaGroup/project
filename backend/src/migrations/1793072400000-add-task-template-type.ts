import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE = 'task_templates';

/** 任务定义增加任务类型（task_types.name，默认「其它」）。 */
export class AddTaskTemplateType1793072400000 implements MigrationInterface {
  name = 'AddTaskTemplateType1793072400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;
    if (await queryRunner.hasColumn(TABLE, 'type')) return;
    await queryRunner.query(
      `ALTER TABLE "${TABLE}" ADD COLUMN "type" varchar(64) NOT NULL DEFAULT '其它'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;
    if (!(await queryRunner.hasColumn(TABLE, 'type'))) return;
    await queryRunner.query(`ALTER TABLE "${TABLE}" DROP COLUMN "type"`);
  }
}
