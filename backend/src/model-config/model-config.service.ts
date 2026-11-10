import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModelThinkingLevel } from '../common/enums';
import {
  FetchModelsInput,
  ModelScenario,
  ModelScenarioView,
  ResolvedModelScenario,
  SaveModelScenarioInput,
} from './model-scenario.entity';
import { findModelScenario, MODEL_SCENARIOS } from './model-scenarios';

/** 拉取模型列表超时（毫秒） */
const FETCH_MODELS_TIMEOUT_MS = 15_000;

/** 归一 OpenAI 兼容地址：去空白、去末尾 /，仅允许 http(s) 绝对地址 */
export function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed || null;
}

/** 校验并归一地址；非法时抛 400 */
function assertBaseUrl(value: unknown): string | null {
  const baseUrl = normalizeBaseUrl(value);
  if (!baseUrl) return null;
  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
    throw new BadRequestException('Base URL 必须是 http(s) 绝对地址');
  }
  if (baseUrl.length > 500) {
    throw new BadRequestException('Base URL 不能超过 500 个字符');
  }
  return baseUrl;
}

/** 思考等级归一；未传保持原值，非法值拒绝 */
function parseThinking(
  value: unknown,
  fallback: ModelThinkingLevel,
): ModelThinkingLevel {
  if (value === null || value === undefined || value === '') return fallback;
  const values = Object.values(ModelThinkingLevel) as string[];
  if (typeof value === 'string' && values.includes(value)) {
    return value as ModelThinkingLevel;
  }
  throw new BadRequestException('思考等级仅支持 off / low / medium / high');
}

/**
 * 解析模型列表响应：兼容 OpenAI `/models`（data[].id）与直接返回字符串数组。
 * 去重后按名称排序；格式不认识时返回空数组（由调用方决定是否报错）。
 */
export function parseModelIds(payload: unknown): string[] {
  const body = payload as { data?: unknown } | unknown[] | null;
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(body?.data)
      ? ((body as { data: unknown[] }).data ?? [])
      : [];
  const ids = rows
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const id = (item as { id?: unknown }).id;
        return typeof id === 'string' ? id.trim() : '';
      }
      return '';
    })
    .filter(Boolean);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/**
 * 管理区「模型配置」：按固定场景维护 OpenAI 兼容模型连接
 * （baseUrl / apiKey / model / 思考等级），并提供运行时解析与模型列表代理。
 * apiKey 明文落库但只写不回显；列表仅返回 hasApiKey。
 */
@Injectable()
export class ModelConfigService {
  constructor(
    @InjectRepository(ModelScenario)
    private readonly scenarios: Repository<ModelScenario>,
  ) {}

  /** 固定场景注册表 × 已保存配置（无配置的场景返回未配置视图） */
  async list(): Promise<ModelScenarioView[]> {
    // apiKey select:false，需显式带出后才能判断 hasApiKey；返回值只映射布尔值
    const rows = await this.scenarios
      .createQueryBuilder('scenario')
      .addSelect('scenario.apiKey')
      .getMany();
    const byKey = new Map(rows.map((row) => [row.scenario, row]));
    return MODEL_SCENARIOS.map((definition) => {
      const row = byKey.get(definition.scenario);
      return {
        scenario: definition.scenario,
        name: definition.name,
        description: definition.description,
        configured: Boolean(row?.baseUrl && row?.model),
        baseUrl: row?.baseUrl ?? null,
        model: row?.model ?? null,
        thinking: row?.thinking ?? ModelThinkingLevel.LOW,
        hasApiKey: Boolean(row?.apiKey),
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  /**
   * 保存场景配置（upsert）：
   * - apiKey 未传保持原值，空串清除，非空覆盖（只写不回显）；
   * - baseUrl / model 传空串表示清空（清空后该场景不再调用模型）。
   */
  async save(
    scenario: string,
    input: SaveModelScenarioInput,
  ): Promise<ModelScenarioView> {
    const definition = findModelScenario(scenario);
    if (!definition) throw new NotFoundException('模型场景不存在');
    const row = await this.findWithSecret(scenario);
    const target = row ?? this.scenarios.create({ scenario });
    if (input.baseUrl !== undefined) {
      target.baseUrl = assertBaseUrl(input.baseUrl);
    }
    if (input.model !== undefined) {
      const model = typeof input.model === 'string' ? input.model.trim() : '';
      if (model.length > 200) {
        throw new BadRequestException('模型 ID 不能超过 200 个字符');
      }
      target.model = model || null;
    }
    if (input.apiKey !== undefined) {
      const apiKey =
        typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
      if (apiKey.length > 512) {
        throw new BadRequestException('API Key 不能超过 512 个字符');
      }
      target.apiKey = apiKey || null;
    }
    target.thinking = parseThinking(
      input.thinking,
      target.thinking ?? ModelThinkingLevel.LOW,
    );
    await this.scenarios.save(target);
    const views = await this.list();
    const view = views.find((item) => item.scenario === scenario);
    if (!view) throw new NotFoundException('模型场景不存在');
    return view;
  }

  /**
   * 运行时解析场景配置：baseUrl + model 缺一不可，apiKey 可空（本地端点）。
   * 未配置返回 null，由调用方降级跳过，不抛错。
   */
  async resolve(scenario: string): Promise<ResolvedModelScenario | null> {
    const row = await this.findWithSecret(scenario);
    if (!row?.baseUrl || !row.model) return null;
    return {
      baseUrl: row.baseUrl,
      apiKey: row.apiKey ?? null,
      model: row.model,
      thinking: row.thinking ?? ModelThinkingLevel.LOW,
    };
  }

  /**
   * 拉取模型列表（后端代理，避免浏览器 CORS 与 apiKey 外泄）：
   * baseUrl / apiKey 可传未保存的临时值（保存前测试），未传用已保存配置。
   */
  async fetchModels(
    scenario: string,
    input: FetchModelsInput = {},
  ): Promise<string[]> {
    if (!findModelScenario(scenario)) {
      throw new NotFoundException('模型场景不存在');
    }
    const row = await this.findWithSecret(scenario);
    const baseUrl =
      assertBaseUrl(input.baseUrl) ?? normalizeBaseUrl(row?.baseUrl);
    if (!baseUrl) {
      throw new BadRequestException('请先填写 Base URL');
    }
    const apiKey =
      (typeof input.apiKey === 'string' ? input.apiKey.trim() : '') ||
      row?.apiKey ||
      '';
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(FETCH_MODELS_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`拉取模型列表失败：${message}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new BadRequestException(
        `拉取模型列表失败（HTTP ${response.status}）${text ? `：${text.slice(0, 300)}` : ''}`,
      );
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    const models = parseModelIds(payload);
    if (!models.length) {
      throw new BadRequestException(
        '模型列表响应格式不正确（期望 OpenAI /models 的 data[].id）',
      );
    }
    return models;
  }

  /** 读取含 apiKey 的场景行（apiKey 列 select:false，需显式 addSelect） */
  private async findWithSecret(
    scenario: string,
  ): Promise<ModelScenario | null> {
    return this.scenarios
      .createQueryBuilder('scenario')
      .addSelect('scenario.apiKey')
      .where('scenario.scenario = :scenario', { scenario })
      .getOne();
  }
}
