import { FeishuBotApprovalService } from './feishu-bot-approval.service';
import type { FeishuBotConfig } from './feishu-bot-config.entity';

describe('FeishuBotApprovalService 审批卡片动作', () => {
  let cards: { findOne: jest.Mock };
  let identities: { resolve: jest.Mock };
  let tickets: { approveTaskApproval: jest.Mock };
  let service: FeishuBotApprovalService;

  const config = { id: 9, kind: 'official' } as FeishuBotConfig;
  const operator = { openId: 'ou_approver', unionId: null };

  beforeEach(() => {
    cards = {
      findOne: jest.fn().mockResolvedValue({
        id: 3,
        configId: 9,
        ticketId: 11,
        taskId: 42,
        messageId: 'om_card_1',
        state: 'pending',
      }),
    };
    identities = {
      resolve: jest.fn().mockResolvedValue({ id: 7, name: '审批人' }),
    };
    tickets = {
      approveTaskApproval: jest.fn().mockResolvedValue({
        id: 11,
        code: 'WO-0011',
        title: '发布申请',
        workflowStatus: '已完成',
      }),
    };
    service = new FeishuBotApprovalService(
      cards as never,
      identities as never,
      tickets as never,
    );
  });

  it('通过卡片一键完成审批（卡片回写由工单运行时统一处理）', async () => {
    const result = await service.handleCardAction(
      config,
      { k: 'approval', a: 'approve', t: 42 },
      operator,
    );

    expect(tickets.approveTaskApproval).toHaveBeenCalledWith(42, {
      id: 7,
      name: '审批人',
    });
    expect(result).toEqual({ toast: { type: 'success', content: '已通过' } });
  });

  it('非审批卡片动作返回 null 交由其它处理器处理', async () => {
    await expect(
      service.handleCardAction(config, { k: 'qa', c: 1, a: ['A'] }, operator),
    ).resolves.toBeNull();
    expect(tickets.approveTaskApproval).not.toHaveBeenCalled();
  });

  it('未识别平台账号时不审批', async () => {
    identities.resolve.mockResolvedValueOnce(null);

    const result = await service.handleCardAction(
      config,
      { k: 'approval', a: 'approve', t: 42 },
      operator,
    );

    expect(tickets.approveTaskApproval).not.toHaveBeenCalled();
    expect(result?.toast.type).toBe('error');
  });

  it('重复点击已处理的审批返回提示且不重复审批', async () => {
    cards.findOne.mockResolvedValueOnce({
      id: 3,
      taskId: 42,
      messageId: 'om_card_1',
      state: 'approved',
    });

    const result = await service.handleCardAction(
      config,
      { k: 'approval', a: 'approve', t: 42 },
      operator,
    );

    expect(tickets.approveTaskApproval).not.toHaveBeenCalled();
    expect(result?.toast.type).toBe('info');
  });

  it('审批失败时返回具体错误提示', async () => {
    tickets.approveTaskApproval.mockRejectedValueOnce(
      new Error('仅工单发起人、当前审批处理人或管理员可以审批'),
    );

    const result = await service.handleCardAction(
      config,
      { k: 'approval', a: 'approve', t: 42 },
      operator,
    );

    expect(result?.toast).toEqual({
      type: 'error',
      content: '仅工单发起人、当前审批处理人或管理员可以审批',
    });
  });

  it('驳回按钮引导到工单页填写反馈意见', async () => {
    const result = await service.handleCardAction(
      config,
      { k: 'approval', a: 'reject', t: 42 },
      operator,
    );

    expect(tickets.approveTaskApproval).not.toHaveBeenCalled();
    expect(result?.toast.type).toBe('info');
  });
});
