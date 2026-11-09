import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 下线任务类型：
 * - 删除任务类型字典表 task_types；
 * - 删除 tasks.type 与 task_templates.type 列。
 *
 * 存量任务按任务定义及其处理机器人分配，不再按类型分类；
 * 历史调度方案（dispatch_plans.plan JSON）中的类型字段仅作历史数据保留。
 */
export class RemoveTaskTypes1797400000000 implements MigrationInterface {
  name = 'RemoveTaskTypes1797400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('tasks')) {
      if (await queryRunner.hasColumn('tasks', 'type')) {
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "type"`);
      }
    }
    if (await queryRunner.hasTable('task_templates')) {
      if (await queryRunner.hasColumn('task_templates', 'type')) {
        await queryRunner.query(
          `ALTER TABLE "task_templates" DROP COLUMN "type"`,
        );
      }
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "task_types"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 恢复列与字典结构；历史类型无法还原，统一落默认「其它」
    if (await queryRunner.hasTable('tasks')) {
      if (!(await queryRunner.hasColumn('tasks', 'type'))) {
        await queryRunner.query(
          `ALTER TABLE "tasks" ADD COLUMN "type" varchar(64) NOT NULL DEFAULT '其它'`,
        );
      }
    }
    if (await queryRunner.hasTable('task_templates')) {
      if (!(await queryRunner.hasColumn('task_templates', 'type'))) {
        await queryRunner.query(
          `ALTER TABLE "task_templates" ADD COLUMN "type" varchar(64) NOT NULL DEFAULT '其它'`,
        );
      }
    }
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_types (
        id SERIAL PRIMARY KEY,
        name varchar(64) NOT NULL UNIQUE,
        description text NOT NULL DEFAULT '',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    for (const type of [
      {
        name: '其它',
        description: '未归类的通用任务（默认类型，不可改名与删除）',
      },
      {
        name: '未知任务',
        description: '平台无法匹配任务定义对应机器人时自动归入',
      },
      {
        name: '工单',
        description: '工单任务使用的系统类型（历史工单节点任务）',
      },
    ]) {
      await queryRunner.query(
        `INSERT INTO task_types (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
        [type.name, type.description],
      );
    }
  }
}
