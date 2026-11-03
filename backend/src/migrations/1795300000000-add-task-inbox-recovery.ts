import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * 子任务收件箱恢复状态：
 * - attempts/lastAttemptAt 记录主动唤醒次数，达到阈值后转人工
 * - nextRetryAt 支持退避，避免每秒重复唤醒
 * - lastError 保留最近一次恢复失败原因，便于排查卡住链路
 */
export class AddTaskInboxRecovery1795300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('task_worker_inbox'))) return;
    const columns: TableColumn[] = [
      new TableColumn({
        name: 'attempts',
        type: 'int',
        default: 0,
        isNullable: false,
      }),
      new TableColumn({
        name: 'lastAttemptAt',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'nextRetryAt',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'lastError',
        type: 'text',
        isNullable: true,
      }),
    ];
    for (const column of columns) {
      if (!(await queryRunner.hasColumn('task_worker_inbox', column.name))) {
        await queryRunner.addColumn('task_worker_inbox', column);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('task_worker_inbox'))) return;
    for (const name of [
      'lastError',
      'nextRetryAt',
      'lastAttemptAt',
      'attempts',
    ]) {
      if (await queryRunner.hasColumn('task_worker_inbox', name)) {
        await queryRunner.dropColumn('task_worker_inbox', name);
      }
    }
  }
}
