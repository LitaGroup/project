import {
  MODEL_COOLDOWN_MS,
  isModelExhausted,
  isModelQuotaError,
  markModelExhausted,
  resetModelAvailability,
  resolveWorkerModel,
  toModelError,
  workerBackupModel,
  type ModelErrorLike,
} from './model-availability';

describe('model-availability', () => {
  beforeEach(() => resetModelAvailability());
  afterEach(() => resetModelAvailability());

  describe('isModelQuotaError', () => {
    const quotaCases: ModelErrorLike[] = [
      { type: 'APIError', message: '429 Too Many Requests' },
      { message: 'Rate limit exceeded, please retry later' },
      { message: 'insufficient_quota: You exceeded your current quota' },
      { message: 'You have run out of credits' },
      { message: '账户余额不足，请充值' },
      { message: '当前模型已达到每日调用限额' },
      { message: '接口限流，请稍后再试' },
    ];

    it.each(quotaCases)('识别限额错误：$message', (error) => {
      expect(isModelQuotaError(error)).toBe(true);
    });

    it('不把上下文超长等参数错误当作限额', () => {
      expect(
        isModelQuotaError({
          message: 'This model maximum context length is 128000 tokens',
        }),
      ).toBe(false);
      expect(
        isModelQuotaError({ message: 'prompt is too long: too many tokens' }),
      ).toBe(false);
      expect(isModelQuotaError({ message: '上下文长度超出限制' })).toBe(false);
    });

    it('普通错误与空值不触发切换', () => {
      expect(isModelQuotaError({ message: 'tool crashed unexpectedly' })).toBe(
        false,
      );
      expect(isModelQuotaError(null)).toBe(false);
      expect(isModelQuotaError(undefined)).toBe(false);
    });
  });

  it('识别嵌套的供应商错误结构', () => {
    expect(
      toModelError({
        name: 'APIError',
        data: { message: 'insufficient quota' },
      }),
    ).toEqual({ type: 'APIError', message: 'insufficient quota' });
    expect(toModelError('rate limited')).toEqual({
      message: 'rate limited',
    });
    expect(toModelError({})).toBeNull();
  });

  it('冷却按执行器+模型共享，30 分钟后自动恢复', () => {
    jest.useFakeTimers();
    try {
      markModelExhausted(9, 'openai', 'gpt-5');
      expect(isModelExhausted(9, 'openai', 'gpt-5')).toBe(true);
      // 其它执行器上的同名模型不受影响
      expect(isModelExhausted(10, 'openai', 'gpt-5')).toBe(false);
      jest.advanceTimersByTime(MODEL_COOLDOWN_MS + 1);
      expect(isModelExhausted(9, 'openai', 'gpt-5')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('备用模型与主模型相同视为未配置', () => {
    expect(
      workerBackupModel({
        providerId: 'openai',
        modelId: 'gpt-5',
        backupProviderId: 'openai',
        backupModelId: 'gpt-5',
        backupVariant: null,
      }),
    ).toBeNull();
    expect(
      workerBackupModel({
        providerId: 'openai',
        modelId: 'gpt-5',
        backupProviderId: null,
        backupModelId: 'deepseek-chat',
        backupVariant: null,
      }),
    ).toBeNull();
  });

  it('主模型正常时提供备用兜底，冷却中直接使用备用', () => {
    const worker = {
      executorId: 9,
      providerId: 'openai',
      modelId: 'gpt-5',
      variant: 'high',
      backupProviderId: 'deepseek',
      backupModelId: 'deepseek-chat',
      backupVariant: null,
    };
    expect(resolveWorkerModel(worker)).toEqual({
      model: { providerId: 'openai', modelId: 'gpt-5', variant: 'high' },
      fallback: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        variant: null,
      },
      usingBackup: false,
    });

    markModelExhausted(9, 'openai', 'gpt-5');
    expect(resolveWorkerModel(worker)).toEqual({
      model: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        variant: null,
      },
      fallback: null,
      usingBackup: true,
    });
  });

  it('备用模型同样冷却时不再作为兜底', () => {
    markModelExhausted(9, 'deepseek', 'deepseek-chat');
    const selection = resolveWorkerModel({
      executorId: 9,
      providerId: 'openai',
      modelId: 'gpt-5',
      variant: null,
      backupProviderId: 'deepseek',
      backupModelId: 'deepseek-chat',
      backupVariant: null,
    });
    expect(selection?.fallback).toBeNull();
    expect(selection?.usingBackup).toBe(false);
  });
});
