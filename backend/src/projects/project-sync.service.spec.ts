import { ProjectStatus } from '../common/enums';
import {
  extractDocLinks,
  extractLinkedNames,
  toIterationCycle,
  toProjectStatus,
} from './project-sync.service';

describe('toProjectStatus（需求池状态 → 平台项目状态）', () => {
  const devs = { frontend: '张三' };
  const noDevs = {};

  it('关闭 / 暂停 / ✅ 已上线 直接同步，不看人员', () => {
    expect(toProjectStatus('关闭', noDevs)).toBe(ProjectStatus.FINISHED);
    expect(toProjectStatus('已关闭', devs)).toBe(ProjectStatus.FINISHED);
    expect(toProjectStatus('暂停', devs)).toBe(ProjectStatus.PAUSED);
    expect(toProjectStatus('✅ 已上线', noDevs)).toBe(ProjectStatus.PUBLISHED);
  });

  it('其余状态按开发人员推导：前端/后端/客户端 任一已分配 → 开发中', () => {
    expect(toProjectStatus('正常', devs)).toBe(ProjectStatus.IN_PROGRESS);
    expect(toProjectStatus('有风险', { backend: '李四' })).toBe(
      ProjectStatus.IN_PROGRESS,
    );
    expect(toProjectStatus('Delay', { client: '王五' })).toBe(
      ProjectStatus.IN_PROGRESS,
    );
  });

  it('其余状态且开发人员全未分配（含仅测试/空值/非字符串）→ 待分配', () => {
    expect(toProjectStatus('正常', noDevs)).toBe(ProjectStatus.PLANNED);
    expect(toProjectStatus('有风险', { qa: '赵六' })).toBe(
      ProjectStatus.PLANNED,
    );
    expect(toProjectStatus('', noDevs)).toBe(ProjectStatus.PLANNED);
    expect(toProjectStatus(null, noDevs)).toBe(ProjectStatus.PLANNED);
    expect(toProjectStatus(undefined, noDevs)).toBe(ProjectStatus.PLANNED);
    expect(toProjectStatus(42, noDevs)).toBe(ProjectStatus.PLANNED);
  });
});

describe('toIterationCycle（飞书 w 字段 → 迭代周期归一化）', () => {
  it('已是目标结构的保持不变', () => {
    expect(toIterationCycle('w241: 10/22-10/28')).toBe('w241: 10/22-10/28');
  });

  it('全角冒号 / 大写 W / 缺空格 / 横杠两侧空格等变体归一化', () => {
    expect(toIterationCycle('w281：08/19 - 08/25')).toBe('w281: 08/19-08/25');
    expect(toIterationCycle('W158:01/16-01/22')).toBe('w158: 01/16-01/22');
    expect(toIterationCycle('w129:06/27-07/03')).toBe('w129: 06/27-07/03');
    expect(toIterationCycle('w82: 07/12 - 07/18  ')).toBe('w82: 07/12-07/18');
  });

  it('单位数月/日补零', () => {
    expect(toIterationCycle('w247:12/3-12/9')).toBe('w247: 12/03-12/09');
  });

  it('日期区间后的后缀直接过滤', () => {
    expect(toIterationCycle('w155:01/03-01/08 (少一天)')).toBe(
      'w155: 01/03-01/08',
    );
    expect(toIterationCycle('w142: 09/26-09/28 & 10/06-10/09')).toBe(
      'w142: 09/26-09/28',
    );
    expect(toIterationCycle('w94: 09/27-10/08 (10/10提测 | 10/13发版)')).toBe(
      'w94: 09/27-10/08',
    );
  });

  it('需求池/待排期/Archive/纯 w 编号/空值一律归 -', () => {
    expect(toIterationCycle('📌 需求池')).toBe('-');
    expect(toIterationCycle('待排期')).toBe('-');
    expect(toIterationCycle('Archive')).toBe('-');
    expect(toIterationCycle('w72')).toBe('-');
    expect(toIterationCycle('')).toBe('-');
    expect(toIterationCycle(null)).toBe('-');
    expect(toIterationCycle(undefined)).toBe('-');
  });
});

describe('extractDocLinks（需求字段 → 文档链接）', () => {
  it('url 段的 link 提取为文档链接', () => {
    expect(
      extractDocLinks([
        { type: 'text', text: '需求看这个文档：' },
        {
          type: 'url',
          text: '点此查看',
          link: 'https://lita-group.feishu.cn/docx/abc123',
        },
      ]),
    ).toEqual(['https://lita-group.feishu.cn/docx/abc123']);
  });

  it('正文中的裸飞书文档链接也会提取（wiki/sheets/base + query 参数）', () => {
    expect(
      extractDocLinks(
        '前置阅读 https://lita-group.feishu.cn/wiki/wikcn9hxHvxX55gXXH6g35AFknd?table=tblmfWA2DvqQ76Ri&view=vewrCaS2Ym 完成',
      ),
    ).toEqual([
      'https://lita-group.feishu.cn/wiki/wikcn9hxHvxX55gXXH6g35AFknd?table=tblmfWA2DvqQ76Ri&view=vewrCaS2Ym',
    ]);
    expect(
      extractDocLinks('表格 https://lita-group.feishu.cn/sheets/shipS1ABC'),
    ).toEqual(['https://lita-group.feishu.cn/sheets/shipS1ABC']);
  });

  it('多链接去重保序（link 段与正文重复算一条）', () => {
    const docUrl = 'https://lita-group.feishu.cn/docx/docTOKEN01';
    expect(
      extractDocLinks([
        { type: 'url', text: 'A', link: docUrl },
        { type: 'text', text: `说明 ${docUrl}` },
        {
          type: 'url',
          text: 'B',
          link: 'https://lita-group.feishu.cn/docs/oldTOKEN9',
        },
      ]),
    ).toEqual([docUrl, 'https://lita-group.feishu.cn/docs/oldTOKEN9']);
  });

  it('非飞书链接 / 旧版 docs 链接后缀不误伤普通域名 / 空值返回空', () => {
    expect(
      extractDocLinks([
        { type: 'url', text: '外链', link: 'https://github.com/a/b' },
      ]),
    ).toEqual([]);
    expect(extractDocLinks('纯文本需求，没有任何链接')).toEqual([]);
    expect(extractDocLinks(null)).toEqual([]);
    expect(extractDocLinks(undefined)).toEqual([]);
    expect(extractDocLinks([])).toEqual([]);
  });
});

describe('extractLinkedNames（SingleLink 字段 → 关联记录姓名）', () => {
  const nameById = new Map([
    ['recA', '赵胜峰'],
    ['recB', '徐雪梅'],
  ]);

  it('按 link_record_ids 解析为姓名，多值顿号连接', () => {
    expect(
      extractLinkedNames({ link_record_ids: ['recA', 'recB'] }, nameById),
    ).toBe('赵胜峰、徐雪梅');
  });

  it('无法解析的 id 忽略；全空返回 undefined', () => {
    expect(
      extractLinkedNames({ link_record_ids: ['recA', 'recX'] }, nameById),
    ).toBe('赵胜峰');
    expect(extractLinkedNames({ link_record_ids: ['recX'] }, nameById)).toBe(
      undefined,
    );
  });

  it('字段为空 / null link_record_ids 返回 undefined', () => {
    expect(extractLinkedNames(null, nameById)).toBe(undefined);
    expect(extractLinkedNames(undefined, nameById)).toBe(undefined);
    expect(extractLinkedNames({ link_record_ids: null }, nameById)).toBe(
      undefined,
    );
    expect(extractLinkedNames({ link_record_ids: [] }, nameById)).toBe(
      undefined,
    );
  });
});
