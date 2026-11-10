import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 新增任务类型：
 * - tasks.type：普通（默认）/ 审批；
 * - 审批类型由工单审批节点产生，创建后自动接受，不生成交付文档；
 * - 回填存量工作流审批节点的节点任务为「审批」，其余任务保持「普通」。
 *
 * 旧的 tasks.type 列（任务类型字典）已在 RemoveTaskTypes 迁移中删除，
 * 本次按新的二元类型语义重新添加，与历史字典无关。
 */
export class AddTaskApprovalType1798000000000 implements MigrationInterface {
  name = 'AddTaskApprovalType1798000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('tasks'))) return;
    if (!(await queryRunner.hasColumn('tasks', 'type'))) {
      await queryRunner.query(
        `ALTER TABLE "tasks" ADD COLUMN "type" varchar(20) NOT NULL DEFAULT '普通'`,
      );
    }
    if (await queryRunner.hasTable('ticket_workflow_runs')) {
      await queryRunner.query(`
        UPDATE "tasks" SET "type" = '审批'
        WHERE "id" IN (
          SELECT "taskId" FROM "ticket_workflow_runs"
          WHERE "nodeKind" = 'approval' AND "taskId" IS NOT NULL
        )
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('tasks'))) return;
    if (await queryRunner.hasColumn('tasks', 'type')) {
      await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "type"`);
    }
  }
}
