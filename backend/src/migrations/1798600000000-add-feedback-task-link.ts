import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 反馈自动处理任务关联：feedbacks 增加可空 taskId（tasks.id 应用层软引用，不建物理外键）。
 * 「系统-反馈处理」机器人收录飞书话题新反馈后，平台自动创建「用户反馈处理」
 * （系统任务定义 ID=8）任务并回写该列；历史反馈保持为空。
 */
export class AddFeedbackTaskLink1798600000000 implements MigrationInterface {
  name = 'AddFeedbackTaskLink1798600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "feedbacks" ADD COLUMN IF NOT EXISTS "taskId" integer
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_feedbacks_taskId" ON "feedbacks" ("taskId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_feedbacks_taskId"`);
    await queryRunner.query(`
      ALTER TABLE "feedbacks" DROP COLUMN IF EXISTS "taskId"
    `);
  }
}
