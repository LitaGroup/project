import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 个人 AGENT 收敛为「我的 AI」对话通道：
 * - 不再作为任务执行方：存量未结束任务改由主人的真人机器人接管
 *   （进行中-执行中 → 等待中-待继续，清空 opencode 会话，由真人工作台继续）；
 * - 任务定义的处理机器人清单剔除个人 AGENT；
 * - 需求方历史数据保留（代码层按真人身份兼容展示与操作）。
 */
export class ConvergePersonalAgents1795400000000 implements MigrationInterface {
  name = 'ConvergePersonalAgents1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('workers'))) return;

    // 1. 未结束任务从个人 AGENT 转交主人的真人机器人
    if (await queryRunner.hasTable('tasks')) {
      await queryRunner.query(`
        WITH personal_agents AS (
          SELECT p.id AS agent_id, h.id AS human_id
          FROM workers p
          JOIN workers h ON h."humanUserId" = p."personalAgentUserId"
          WHERE p."personalAgentUserId" IS NOT NULL
        )
        UPDATE tasks t
        SET "agentId" = pa.human_id,
            "opencodeSessionId" = NULL,
            "offerAttemptAt" = NULL,
            "assignedAt" = NULL,
            status = CASE WHEN t.status = '进行中' THEN '等待中' ELSE t.status END,
            "subStatus" = CASE WHEN t.status = '进行中' THEN '待继续' ELSE t."subStatus" END
        FROM personal_agents pa
        WHERE t."agentId" = pa.agent_id
          AND t.status <> '已结束'
      `);
    }

    // 2. 任务定义的处理机器人清单剔除个人 AGENT
    if (await queryRunner.hasTable('task_templates')) {
      await queryRunner.query(`
        UPDATE task_templates
        SET "agentIds" = COALESCE(
          (
            SELECT jsonb_agg(elem.value::int)
            FROM jsonb_array_elements_text("agentIds"::jsonb) AS elem
            WHERE elem.value::int NOT IN (
              SELECT id FROM workers WHERE "personalAgentUserId" IS NOT NULL
            )
          ),
          '[]'::jsonb
        )::text
        WHERE "agentIds" IS NOT NULL
          AND "agentIds" <> ''
          AND jsonb_typeof("agentIds"::jsonb) = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text("agentIds"::jsonb) AS elem
            WHERE elem.value::int IN (
              SELECT id FROM workers WHERE "personalAgentUserId" IS NOT NULL
            )
          )
      `);
    }
  }

  public async down(): Promise<void> {
    // 数据收敛不可逆：个人 AGENT 不再承接任务，历史引用无法还原
  }
}
