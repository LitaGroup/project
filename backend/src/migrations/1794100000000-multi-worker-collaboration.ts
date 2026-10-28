import { MigrationInterface, QueryRunner } from 'typeorm';

/** 多机器人协同：显式需求方、两阶段接受、待继续上下文、终态记录与父机器人收件箱。 */
export class MultiWorkerCollaboration1794100000000 implements MigrationInterface {
  name = 'MultiWorkerCollaboration1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('tasks'))) return;
    const columns: Array<[string, string]> = [
      ['requesterType', 'varchar(20)'],
      ['requesterId', 'integer'],
      ['resumePrompt', 'text'],
      ['offerAttemptAt', 'timestamptz'],
      ['refusedAt', 'timestamptz'],
      ['refusedBy', 'varchar(100)'],
      ['refusalReason', 'text'],
      ['dispatchSuggestion', 'text'],
      ['failedAt', 'timestamptz'],
      ['failedBy', 'varchar(100)'],
      ['failureReason', 'text'],
    ];
    for (const [column, definition] of columns) {
      if (!(await queryRunner.hasColumn('tasks', column))) {
        await queryRunner.query(
          `ALTER TABLE "tasks" ADD COLUMN "${column}" ${definition}`,
        );
      }
    }

    // 旧识别状态退出主流程；历史执行/等待语义保持不变。
    await queryRunner.query(
      `ALTER TABLE "tasks" ALTER COLUMN "subStatus" SET DEFAULT '待分配'`,
    );
    await queryRunner.query(
      `UPDATE "tasks" SET "status"='等待中', "subStatus"='待分配' WHERE "subStatus" IN ('待识别','识别中')`,
    );
    // 优先使用父任务机器人作为子任务需求方，其余回退创建人/根任务创建人。
    await queryRunner.query(
      `UPDATE "tasks" child
       SET "requesterType"='worker', "requesterId"=parent."agentId"
       FROM "tasks" parent
       WHERE child."parentId"=parent.id AND parent."agentId" IS NOT NULL
         AND child."requesterType" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "tasks" SET "requesterType"='user', "requesterId"="createdById"
       WHERE "requesterType" IS NULL AND "createdById" IS NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "tasks" child
       SET "requesterType"='user', "requesterId"=root."createdById"
       FROM "tasks" root
       WHERE child."rootId"=root.id AND child."requesterType" IS NULL
         AND root."createdById" IS NOT NULL`,
    );

    if (!(await queryRunner.hasTable('task_worker_inbox'))) {
      await queryRunner.query(
        `CREATE TABLE "task_worker_inbox" (
          "id" SERIAL PRIMARY KEY,
          "parentTaskId" integer NOT NULL,
          "workerId" integer NOT NULL,
          "childTaskId" integer NOT NULL,
          "kind" varchar(20) NOT NULL,
          "referenceId" varchar(200),
          "payload" text,
          "status" varchar(20) NOT NULL DEFAULT 'pending',
          "deliveredAt" timestamptz,
          "processedAt" timestamptz,
          "createdAt" timestamptz NOT NULL DEFAULT now(),
          "updatedAt" timestamptz NOT NULL DEFAULT now()
        )`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_task_worker_inbox_worker_status" ON "task_worker_inbox" ("workerId","status")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_task_worker_inbox_parent_status" ON "task_worker_inbox" ("parentTaskId","status")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_task_worker_inbox_child_status" ON "task_worker_inbox" ("childTaskId","status")`,
      );
    }

    // 极端历史数据若已有一对多执行中，保留最新一条，其余转待继续后再建唯一约束。
    await queryRunner.query(
      `UPDATE "tasks" t SET "status"='等待中', "subStatus"='待继续',
        "resumePrompt"=COALESCE(t."resumePrompt",'历史并发任务迁移：等待机器人空闲后继续')
       WHERE t."status"='进行中' AND t."agentId" IS NOT NULL AND t.id NOT IN (
         SELECT DISTINCT ON ("agentId") id FROM "tasks"
         WHERE "status"='进行中' AND "agentId" IS NOT NULL
         ORDER BY "agentId", "updatedAt" DESC, id DESC
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tasks_one_running_per_worker" ON "tasks" ("agentId") WHERE "status"='进行中'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('tasks')) {
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_tasks_one_running_per_worker"`,
      );
      for (const [column] of [
        ['requesterType'],
        ['requesterId'],
        ['resumePrompt'],
        ['offerAttemptAt'],
        ['refusedAt'],
        ['refusedBy'],
        ['refusalReason'],
        ['dispatchSuggestion'],
        ['failedAt'],
        ['failedBy'],
        ['failureReason'],
      ]) {
        if (await queryRunner.hasColumn('tasks', column)) {
          await queryRunner.query(
            `ALTER TABLE "tasks" DROP COLUMN "${column}"`,
          );
        }
      }
      await queryRunner.query(
        `UPDATE "tasks" SET "subStatus"='待识别' WHERE "subStatus" IN ('待分配','待接受','待继续')`,
      );
      await queryRunner.query(
        `ALTER TABLE "tasks" ALTER COLUMN "subStatus" SET DEFAULT '待识别'`,
      );
    }
    if (await queryRunner.hasTable('task_worker_inbox')) {
      await queryRunner.query(`DROP TABLE "task_worker_inbox"`);
    }
  }
}
