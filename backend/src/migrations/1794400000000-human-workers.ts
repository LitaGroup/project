import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * 真人机器人：每个用户绑定一个 workers.humanUserId 唯一的机器人。
 * - runtime 增加 human；
 * - 真人任务允许同一机器人并行处理多个任务，移除 tasks 的单机器人单任务唯一索引；
 * - 存量用户的真人机器人由 WorkersService.ensureHumanWorker 在启动时补齐，
 *   避免 ALTER TYPE ADD VALUE 与同事务 INSERT 混用（PostgreSQL 新枚举值需提交后才可用）。
 */
export class HumanWorkers1794400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "workers_runtime_enum" ADD VALUE IF NOT EXISTS 'human' AFTER 'opencode'`,
    );

    const hasHumanUserId = await queryRunner.hasColumn(
      'workers',
      'humanUserId',
    );
    if (!hasHumanUserId) {
      await queryRunner.addColumn(
        'workers',
        new TableColumn({
          name: 'humanUserId',
          type: 'int',
          isNullable: true,
        }),
      );
    }
    const hasHumanUserName = await queryRunner.hasColumn(
      'workers',
      'humanUserName',
    );
    if (!hasHumanUserName) {
      await queryRunner.addColumn(
        'workers',
        new TableColumn({
          name: 'humanUserName',
          type: 'varchar',
          length: '100',
          isNullable: true,
        }),
      );
    }
    const humanIndexName = 'IDX_workers_humanUserId';
    if (!(await this.hasIndex(queryRunner, 'workers', humanIndexName))) {
      await queryRunner.createIndex(
        'workers',
        new TableIndex({
          name: humanIndexName,
          columnNames: ['humanUserId'],
          isUnique: true,
        }),
      );
    }

    const taskIndexName = 'IDX_tasks_one_running_per_worker';
    if (await this.hasIndex(queryRunner, 'tasks', taskIndexName)) {
      await queryRunner.dropIndex('tasks', taskIndexName);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const taskIndexName = 'IDX_tasks_one_running_per_worker';
    if (!(await this.hasIndex(queryRunner, 'tasks', taskIndexName))) {
      await queryRunner.createIndex(
        'tasks',
        new TableIndex({
          name: taskIndexName,
          columnNames: ['agentId'],
          isUnique: true,
          where: `"status" = '进行中'`,
        }),
      );
    }

    const humanIndex = 'IDX_workers_humanUserId';
    if (await this.hasIndex(queryRunner, 'workers', humanIndex)) {
      await queryRunner.dropIndex('workers', humanIndex);
    }
    if (await queryRunner.hasColumn('workers', 'humanUserName')) {
      await queryRunner.dropColumn('workers', 'humanUserName');
    }
    if (await queryRunner.hasColumn('workers', 'humanUserId')) {
      await queryRunner.dropColumn('workers', 'humanUserId');
    }
    // PostgreSQL 不支持移除枚举值：runtime=human 的枚举值保留为兼容历史。
  }

  /** 当前 Schema 中是否存在指定索引（兼容无 hasIndex 的 QueryRunner 类型） */
  private async hasIndex(
    queryRunner: QueryRunner,
    table: string,
    index: string,
  ): Promise<boolean> {
    const rows: unknown[] = await queryRunner.manager.query(
      'SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 AND indexname = $2 LIMIT 1',
      [table, index],
    );
    return rows.length > 0;
  }
}
