import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * 交付文档（HANDOFF）改为任务全生命周期文档：
 * - 任务创建时初始化，路径固定在任务创建日期下
 * - 正文由执行机器人/需求方持续维护
 * - 平台维护版本号，申请验收时锁定提交版本
 */
export class AddTaskHandoffTracking1795200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const columns: TableColumn[] = [
      new TableColumn({
        name: 'handoffPath',
        type: 'varchar',
        length: '300',
        isNullable: true,
      }),
      new TableColumn({
        name: 'handoffVersion',
        type: 'int',
        default: 0,
        isNullable: false,
      }),
      new TableColumn({
        name: 'handoffSubmittedVersion',
        type: 'int',
        isNullable: true,
      }),
      new TableColumn({
        name: 'handoffUpdatedAt',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'handoffUpdatedBy',
        type: 'varchar',
        length: '100',
        isNullable: true,
      }),
    ];
    for (const column of columns) {
      if (!(await queryRunner.hasColumn('tasks', column.name))) {
        await queryRunner.addColumn('tasks', column);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of [
      'handoffUpdatedBy',
      'handoffUpdatedAt',
      'handoffSubmittedVersion',
      'handoffVersion',
      'handoffPath',
    ]) {
      if (await queryRunner.hasColumn('tasks', name)) {
        await queryRunner.dropColumn('tasks', name);
      }
    }
  }
}
