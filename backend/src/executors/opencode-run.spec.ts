import type { OpencodeClient } from './opencode-client';
import { runOpencodePrompt } from './opencode-run';

describe('runOpencodePrompt 主模型限额切换备用模型', () => {
  const buildClient = () => {
    const client = {
      shell: jest.fn().mockResolvedValue(undefined),
      createSession: jest.fn().mockResolvedValue({ id: 'oc-1' }),
      prompt: jest
        .fn()
        .mockResolvedValueOnce({ time: { created: 100 } })
        .mockResolvedValueOnce({ time: { created: 200 } }),
      session: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'failed', time: { idle: 150 } })
        .mockResolvedValueOnce({ outcome: 'succeeded', time: { idle: 250 } }),
      lastAssistantError: jest
        .fn()
        .mockResolvedValue({ message: '429 Too Many Requests' }),
      switchModel: jest.fn().mockResolvedValue(undefined),
      lastAssistantText: jest.fn().mockResolvedValue('已继续完成'),
      interrupt: jest.fn().mockResolvedValue(undefined),
    };
    return {
      client: client as unknown as OpencodeClient,
      prompt: client.prompt,
      session: client.session,
      switchModel: client.switchModel,
      lastAssistantText: client.lastAssistantText,
      lastAssistantError: client.lastAssistantError,
    };
  };

  it('限额失败后切换备用模型并在原会话续跑一次', async () => {
    const mocks = buildClient();
    const onQuotaError = jest.fn();

    const text = await runOpencodePrompt(mocks.client, {
      title: '一次性会话',
      model: { id: 'gpt-5', providerID: 'openai' },
      prompt: '开始',
      timeoutMs: 5_000,
      pollMs: 1,
      fallback: {
        model: { id: 'deepseek-chat', providerID: 'deepseek' },
      },
      onQuotaError,
    });

    expect(text).toBe('已继续完成');
    expect(mocks.switchModel).toHaveBeenCalledWith('oc-1', {
      id: 'deepseek-chat',
      providerID: 'deepseek',
    });
    expect(onQuotaError).toHaveBeenCalledWith({
      message: '429 Too Many Requests',
    });
    // 首轮提示词 + 切换后的续跑提示词
    expect(mocks.prompt).toHaveBeenCalledTimes(2);
    expect(mocks.lastAssistantText).toHaveBeenCalledWith('oc-1', 200);
  });

  it('非限额错误保持原有失败流程，不切换模型', async () => {
    const mocks = buildClient();
    mocks.lastAssistantError.mockResolvedValue({
      message: 'tool crashed unexpectedly',
    });

    await expect(
      runOpencodePrompt(mocks.client, {
        title: '一次性会话',
        model: { id: 'gpt-5', providerID: 'openai' },
        prompt: '开始',
        timeoutMs: 5_000,
        pollMs: 1,
        fallback: {
          model: { id: 'deepseek-chat', providerID: 'deepseek' },
        },
      }),
    ).rejects.toThrow('执行器会话 oc-1 执行失败');
    expect(mocks.switchModel).not.toHaveBeenCalled();
    expect(mocks.prompt).toHaveBeenCalledTimes(1);
  });

  it('未配置备用模型时只标记冷却，不切换模型', async () => {
    const mocks = buildClient();
    const onQuotaError = jest.fn();

    await expect(
      runOpencodePrompt(mocks.client, {
        title: '一次性会话',
        model: { id: 'gpt-5', providerID: 'openai' },
        prompt: '开始',
        timeoutMs: 5_000,
        pollMs: 1,
        onQuotaError,
      }),
    ).rejects.toThrow('执行器会话 oc-1 执行失败');
    expect(onQuotaError).toHaveBeenCalledWith({
      message: '429 Too Many Requests',
    });
    expect(mocks.switchModel).not.toHaveBeenCalled();
  });
});
