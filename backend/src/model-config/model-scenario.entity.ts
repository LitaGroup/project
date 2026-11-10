import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ModelThinkingLevel } from '../common/enums';

/**
 * 模型场景（管理区「模型配置」）：一个固定场景对应一条配置。
 * 场景标识来自代码内注册表（见 model-scenarios.ts），不随数据新建或删除；
 * apiKey 只写不回显，列表接口仅返回 hasApiKey。
 */
@Entity('model_scenarios')
export class ModelScenario {
  @PrimaryGeneratedColumn()
  id: number;

  /** 场景标识（如 title-naming），唯一 */
  @Index('IDX_model_scenarios_scenario', { unique: true })
  @Column({ length: 100 })
  scenario: string;

  /** OpenAI 兼容服务地址（不含末尾 /，请求 `${baseUrl}/chat/completions`） */
  @Column({ type: 'varchar', length: 500, nullable: true })
  baseUrl: string | null;

  /** API Key：明文落库、select:false，只写不回显 */
  @Column({ type: 'varchar', length: 512, nullable: true, select: false })
  apiKey: string | null;

  /** 模型 ID（如 glm-4.6 / gpt-5-mini） */
  @Column({ type: 'varchar', length: 200, nullable: true })
  model: string | null;

  /** 思考等级；标题命名场景默认最低档 low（关闭思考用 off） */
  @Column({
    type: 'enum',
    enum: ModelThinkingLevel,
    default: ModelThinkingLevel.LOW,
  })
  thinking: ModelThinkingLevel;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** 场景配置视图：固定场景与已保存配置的合并结果（不含 apiKey 原文） */
export interface ModelScenarioView {
  scenario: string;
  name: string;
  description: string;
  /** baseUrl 与 model 均已配置，可供调用 */
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  thinking: ModelThinkingLevel;
  /** 是否已保存 apiKey（不回显原文） */
  hasApiKey: boolean;
  updatedAt: Date | null;
}

/** 保存场景配置入参：apiKey 未传保持原值，传空串清除 */
export interface SaveModelScenarioInput {
  baseUrl?: string | null;
  apiKey?: string | null;
  model?: string | null;
  thinking?: ModelThinkingLevel | string | null;
}

/** 运行时解析出的场景模型配置（仅供服务端调用，不对外返回） */
export interface ResolvedModelScenario {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  thinking: ModelThinkingLevel;
}

/** 拉取模型列表的临时覆盖参数（保存前测试连接用） */
export interface FetchModelsInput {
  baseUrl?: string | null;
  apiKey?: string | null;
}
