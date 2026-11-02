import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * 我的 AI 会话隔离 + Build/Plan 模式：
 * - contextKey 区分机器人调试（debug）、我的 AI 通用会话（agent:global）
 *   与每个任务独立会话（agent:task:{taskId}）；
 * - activeAgent 记录会话选择的主 Agent 模式（build / plan）。
 * 存量个人 AGENT 的会话迁移为 agent:global，保留此前的「我的 AI」对话。
 */
export class WorkerDebugTaskSessions1794800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('worker_debug_sessions');
    if (!table) return;

    if (!(await queryRunner.hasColumn('worker_debug_sessions', 'contextKey'))) {
      await queryRunner.addColumn(
        'worker_debug_sessions',
        new TableColumn({
          name: 'contextKey',
          type: 'varchar',
          length: '120',
          isNullable: false,
          default: 'debug',
        }),
      );
    }
    if (
      !(await queryRunner.hasColumn('worker_debug_sessions', 'activeAgent'))
    ) {
      await queryRunner.addColumn(
        'worker_debug_sessions',
        new TableColumn({
          name: 'activeAgent',
          type: 'varchar',
          length: '20',
          isNullable: false,
          default: 'build',
        }),
      );
    }

    // 存量个人 AGENT 会话来自工作台「我的 AI」，归入通用会话，避免变成调试会话。
    await queryRunner.query(
      `UPDATE worker_debug_sessions AS d
         SET "contextKey" = 'agent:global'
        FROM workers AS w
       WHERE d."workerId" = w.id
         AND w."personalAgentUserId" IS NOT NULL
         AND d."contextKey" = 'debug'`,
    );

    const oldIndex = table.indices.find(
      (index) =>
        index.isUnique &&
        index.columnNames.length === 2 &&
        index.columnNames.includes('userId') &&
        index.columnNames.includes('workerId'),
    );
    if (oldIndex?.name) {
      await queryRunner.dropIndex('worker_debug_sessions', oldIndex.name);
    }

    const indexName = 'IDX_worker_debug_sessions_scope';
    const refreshed = await queryRunner.getTable('worker_debug_sessions');
    if (!refreshed?.indices.some((index) => index.name === indexName)) {
      await queryRunner.createIndex(
        'worker_debug_sessions',
        new TableIndex({
          name: indexName,
          columnNames: ['userId', 'workerId', 'contextKey'],
          isUnique: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const indexName = 'IDX_worker_debug_sessions_scope';
    const table = await queryRunner.getTable('worker_debug_sessions');
    if (table?.indices.some((index) => index.name === indexName)) {
      await queryRunner.dropIndex('worker_debug_sessions', indexName);
    }
    if (await queryRunner.hasColumn('worker_debug_sessions', 'activeAgent')) {
      await queryRunner.dropColumn('worker_debug_sessions', 'activeAgent');
    }
    if (await queryRunner.hasColumn('worker_debug_sessions', 'contextKey')) {
      await queryRunner.dropColumn('worker_debug_sessions', 'contextKey');
    }
    // 回滚到「用户 + 机器人」唯一：同一机器人可能残留多任务会话，先清理重复行。
    await queryRunner.query(
      `DELETE FROM worker_debug_sessions AS d
        USING worker_debug_sessions AS keep
        WHERE d.id > keep.id
          AND d."userId" = keep."userId"
          AND d."workerId" = keep."workerId"`,
    );
    await queryRunner.createIndex(
      'worker_debug_sessions',
      new TableIndex({
        name: 'IDX_worker_debug_sessions_user_worker',
        columnNames: ['userId', 'workerId'],
        isUnique: true,
      }),
    );
  }
}
