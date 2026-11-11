import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FeedbackSource, FeedbackStatus, FeedbackType } from '../common/enums';
import { Feedback } from './feedback.entity';
import { FeedbacksService, FeedbackActor } from './feedbacks.service';

function actor(overrides?: Partial<FeedbackActor>): FeedbackActor {
  return { userId: 7, userName: '小明', isAdmin: false, ...overrides };
}

function feedbackRow(overrides?: Partial<Feedback>): Feedback {
  return {
    id: 1,
    title: '登录页白屏',
    type: FeedbackType.BUG,
    source: FeedbackSource.PLATFORM,
    sourceChatId: null,
    sourceThreadId: null,
    sourceMessageId: null,
    status: FeedbackStatus.PENDING,
    content: '打开登录页偶现白屏',
    images: null,
    reporterId: 7,
    reporterName: '小明',
    handlerName: null,
    handleNote: null,
    resolvedAt: null,
    createdAt: new Date('2026-11-11T02:00:00Z'),
    updatedAt: new Date('2026-11-11T02:00:00Z'),
    ...overrides,
  };
}

/** 跟帖仓库桩：删除反馈时清理跟帖，详情读取跟帖列表 */
function replyRepository() {
  return {
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    find: jest.fn().mockResolvedValue([]),
  };
}

function makeService(row: Feedback) {
  const findOne = jest.fn().mockResolvedValue(row);
  const save = jest
    .fn()
    .mockImplementation((v: Feedback) => Promise.resolve(v));
  const remove = jest.fn().mockResolvedValue(undefined);
  const repository = { findOne, save, remove } as never;
  const replies = replyRepository();
  const service = new FeedbacksService(repository, replies as never);
  return { service, row, findOne, save, remove, replies };
}

describe('FeedbacksService.create', () => {
  it('标题必填且拒绝非法类型与图片地址', async () => {
    const create = jest.fn().mockImplementation((v: Feedback): Feedback => v);
    const save = jest
      .fn()
      .mockImplementation((v: Feedback) => Promise.resolve(v));
    const service = new FeedbacksService(
      { create, save } as never,
      replyRepository() as never,
    );
    await expect(
      service.create({ title: '  ', content: 'x' }, actor()),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create({ title: 'ok', content: '  ' }, actor()),
    ).rejects.toThrow('问题描述不能为空');
    await expect(
      service.create(
        { title: 'ok', content: 'x', images: ['http://evil/x.png'] },
        actor(),
      ),
    ).rejects.toThrow('/images/');
    await expect(
      service.create(
        { title: 'ok', content: 'x', type: '灌水' as FeedbackType },
        actor(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('缺省类型 BUG、状态待处理并记录提交人', async () => {
    const create = jest.fn().mockImplementation((v: Feedback): Feedback => v);
    const save = jest
      .fn()
      .mockImplementation((v: Feedback) => Promise.resolve(v));
    const service = new FeedbacksService(
      { create, save } as never,
      replyRepository() as never,
    );
    const result = await service.create(
      { title: ' 页面错别字 ', content: 'xx' },
      actor(),
    );
    expect(result.title).toBe('页面错别字');
    expect(result.type).toBe(FeedbackType.BUG);
    expect(result.status).toBe(FeedbackStatus.PENDING);
    expect(result.reporterId).toBe(7);
    expect(result.reporterName).toBe('小明');
  });
});

describe('FeedbacksService.update 权限', () => {
  it('提交人可在待处理时改正文', async () => {
    const { service, save } = makeService(feedbackRow());
    await service.update(1, { content: '补充了截图' }, actor());
    expect(save).toHaveBeenCalled();
  });

  it('进入处理后仅管理员可改正文；处理备注始终仅管理员', async () => {
    const { service } = makeService(
      feedbackRow({ status: FeedbackStatus.PROCESSING }),
    );
    await expect(service.update(1, { content: 'x' }, actor())).rejects.toThrow(
      ForbiddenException,
    );

    const pending = makeService(feedbackRow());
    await expect(
      pending.service.update(1, { handleNote: '已排期' }, actor()),
    ).rejects.toThrow('仅管理员可填写处理备注');
  });

  it('非提交人成员不可改，反馈不存在时 404', async () => {
    const { service } = makeService(feedbackRow());
    await expect(
      service.update(1, { title: 'x' }, actor({ userId: 9, userName: '小红' })),
    ).rejects.toThrow(ForbiddenException);

    const missing = new FeedbacksService(
      {
        findOne: jest.fn().mockResolvedValue(null),
      } as never,
      replyRepository() as never,
    );
    await expect(missing.findOne(404)).rejects.toThrow(NotFoundException);
  });
});

describe('FeedbacksService.changeStatus', () => {
  it('仅管理员；已解决补记 resolvedAt，退回清空', async () => {
    const { service, save, row } = makeService(feedbackRow());
    await expect(
      service.changeStatus(1, { status: FeedbackStatus.PROCESSING }, actor()),
    ).rejects.toThrow('仅管理员可处理反馈');

    await service.changeStatus(
      1,
      { status: FeedbackStatus.RESOLVED, handleNote: '已修复' },
      actor({ isAdmin: true }),
    );
    expect(row.status).toBe(FeedbackStatus.RESOLVED);
    expect(row.resolvedAt).toBeInstanceOf(Date);
    expect(row.handleNote).toBe('已修复');
    expect(row.handlerName).toBe('小明');

    await service.changeStatus(
      1,
      { status: FeedbackStatus.PROCESSING },
      actor({ isAdmin: true }),
    );
    expect(row.resolvedAt).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('拒绝非法状态值', async () => {
    const { service } = makeService(feedbackRow());
    await expect(
      service.changeStatus(
        1,
        { status: '已完成' as FeedbackStatus },
        actor({ isAdmin: true }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('FeedbacksService.remove', () => {
  it('提交人仅可撤销待处理；管理员任意', async () => {
    const processing = makeService(
      feedbackRow({ status: FeedbackStatus.PROCESSING }),
    );
    await expect(processing.service.remove(1, actor())).rejects.toThrow(
      ForbiddenException,
    );

    const pending = makeService(feedbackRow());
    await pending.service.remove(1, actor());
    expect(pending.remove).toHaveBeenCalled();
    // 删除反馈时应用层清理飞书话题跟帖
    expect(pending.replies.delete).toHaveBeenCalledWith({ feedbackId: 1 });

    const admin = makeService(
      feedbackRow({
        reporterId: 42,
        reporterName: '别人',
        status: FeedbackStatus.RESOLVED,
      }),
    );
    await admin.service.remove(1, actor({ isAdmin: true }));
    expect(admin.remove).toHaveBeenCalled();
  });
});
