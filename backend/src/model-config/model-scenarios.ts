/**
 * 固定模型场景注册表：管理区「模型配置」列表按此定义展示，后续新增场景在此追加。
 * 场景标识一经上线不得改名（配置按标识落库）；新增场景无需迁移，列表自动出现「未配置」。
 */
export interface ModelScenarioDefinition {
  /** 场景标识（落库键，禁止改名） */
  scenario: string;
  /** 展示名称 */
  name: string;
  /** 用途说明 */
  description: string;
}

/** 工单与任务标题命名场景（「T-{id}」标题异步生成） */
export const MODEL_SCENARIO_TITLE_NAMING = 'title-naming';

export const MODEL_SCENARIOS: ModelScenarioDefinition[] = [
  {
    scenario: MODEL_SCENARIO_TITLE_NAMING,
    name: '工单和任务标题命名',
    description:
      '创建工单或根任务后，异步调用模型生成简洁标题，统一为「T-{id}」+ 生成内容；失败不影响创建与流程流转。',
  },
];

/** 按标识查找固定场景定义 */
export function findModelScenario(
  scenario: string,
): ModelScenarioDefinition | null {
  return MODEL_SCENARIOS.find((item) => item.scenario === scenario) ?? null;
}
