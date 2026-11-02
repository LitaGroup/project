import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * 机器人默认思考等级：机器人配置从「供应商 + 模型」合并为「默认模型 + 思考等级」，
 * variant 持久化默认思考等级（为空时使用模型默认值）。
 */
export class WorkerDefaultVariant1794900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('workers', 'variant'))) {
      await queryRunner.addColumn(
        'workers',
        new TableColumn({
          name: 'variant',
          type: 'varchar',
          length: '50',
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('workers', 'variant')) {
      await queryRunner.dropColumn('workers', 'variant');
    }
  }
}
