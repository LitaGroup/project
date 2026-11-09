import { MigrationInterface, QueryRunner } from 'typeorm';

const PROJECT_DELIVERY_TEMPLATE_ID = 7;
const PROJECT_DELIVERY_TEMPLATE_NAME = '技术-项目开发交付';
const PROJECT_DELIVERY_TEMPLATE_DESCRIPTION = [
  '承接项目详情页发起的项目实施与开发交付。',
  '',
  '## 任务范围',
  '',
  '- 读取项目 Markdown 上下文（`GET /api/projects/{projectId}.md`），确认项目目标、范围、资料和代码分支。',
  '- 梳理实施计划，完成开发、配置和必要的技术文档交付。',
  '- 按任务流程更新 HANDOFF，并在完成后申请验收。',
  '',
  '## 默认处理机器人',
  '',
  '由系统机器人「技术-项目经理」作为首位处理机器人，负责读取项目上下文、拆分并分派子任务、验收交付和整合结果；管理员可追加其它机器人作为兜底。',
].join('\n');

/** 项目详情「交给项目机器人」使用的系统任务定义（固定 ID=7）。 */
export class AddProjectDeliveryTaskTemplate1797200000000 implements MigrationInterface {
  name = 'AddProjectDeliveryTaskTemplate1797200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('task_templates'))) return;
    await queryRunner.query(
      `INSERT INTO task_templates ("id", "name", "type", "description", "agentIds")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [
        PROJECT_DELIVERY_TEMPLATE_ID,
        PROJECT_DELIVERY_TEMPLATE_NAME,
        '其它',
        PROJECT_DELIVERY_TEMPLATE_DESCRIPTION,
        '[2]',
      ],
    );
    await queryRunner.query(
      `SELECT setval(
         pg_get_serial_sequence('task_templates', 'id'),
         GREATEST((SELECT COALESCE(MAX(id), 0) FROM task_templates), 999)
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('task_templates'))) return;
    if (await queryRunner.hasTable('task_template_follows')) {
      await queryRunner.query(
        `DELETE FROM task_template_follows WHERE "templateId" = $1`,
        [PROJECT_DELIVERY_TEMPLATE_ID],
      );
    }
    await queryRunner.query(
      `DELETE FROM task_templates WHERE "id" = $1 AND "name" = $2`,
      [PROJECT_DELIVERY_TEMPLATE_ID, PROJECT_DELIVERY_TEMPLATE_NAME],
    );
  }
}
