import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * 我的 AGENT 模型/思考等级选择：调试会话记录用户当前选择的
 * 供应商、模型与 variant（思考等级），重启/重进页面后保持。
 * 为空时回退机器人自身配置。
 */
export class WorkerDebugActiveModel1794700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const columns: TableColumn[] = [
      new TableColumn({
        name: 'activeProviderId',
        type: 'varchar',
        length: '100',
        isNullable: true,
      }),
      new TableColumn({
        name: 'activeModelId',
        type: 'varchar',
        length: '200',
        isNullable: true,
      }),
      new TableColumn({
        name: 'activeVariant',
        type: 'varchar',
        length: '50',
        isNullable: true,
      }),
    ];
    for (const column of columns) {
      if (
        !(await queryRunner.hasColumn('worker_debug_sessions', column.name))
      ) {
        await queryRunner.addColumn('worker_debug_sessions', column);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ['activeProviderId', 'activeModelId', 'activeVariant']) {
      if (await queryRunner.hasColumn('worker_debug_sessions', name)) {
        await queryRunner.dropColumn('worker_debug_sessions', name);
      }
    }
  }
}
