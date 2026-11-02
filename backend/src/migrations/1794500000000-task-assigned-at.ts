import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** 任务增加当前机器人分配时间：操作台按“分配到自己机器人”的时间倒序分组。 */
export class TaskAssignedAt1794500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('tasks', 'assignedAt'))) {
      await queryRunner.addColumn(
        'tasks',
        new TableColumn({
          name: 'assignedAt',
          type: 'timestamptz',
          isNullable: true,
        }),
      );
    }
    // 存量任务没有精确分配事件可回放，用最后更新时间近似当前机器人分配时间。
    await queryRunner.query(`
      UPDATE "tasks"
      SET "assignedAt" = "updatedAt"
      WHERE "agentId" IS NOT NULL AND "assignedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('tasks', 'assignedAt')) {
      await queryRunner.dropColumn('tasks', 'assignedAt');
    }
  }
}
