import { swaggerToMarkdown, type SwaggerSpec } from './apipost-markdown';

const spec: SwaggerSpec = {
  openapi: '3.0.0',
  info: { title: '活动V3/active-v3', description: '活动接口文档' },
  servers: [{ url: 'https://api.example.com' }],
  tags: [{ name: '滴滴巴士 didibus/调试' }, { name: '滴滴巴士 didibus/接口' }],
  components: {
    schemas: {
      Player: {
        type: 'object',
        required: ['player'],
        properties: {
          player: {
            type: 'integer',
            example: 123456789,
            description: '玩家ID',
          },
          nickname: { type: 'string', example: '玩家昵称' },
        },
      },
      RankResponse: {
        type: 'object',
        properties: {
          my: { $ref: '#/components/schemas/Player' },
          players: {
            type: 'array',
            items: { $ref: '#/components/schemas/Player' },
            description: '上榜玩家',
          },
          locale: {
            type: 'string',
            enum: ['in', 'vi'],
            description: '大区枚举',
          },
          deep: {
            type: 'object',
            properties: {
              a: {
                type: 'object',
                properties: {
                  b: {
                    type: 'object',
                    properties: { c: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  paths: {
    '/didibus/config': {
      post: {
        'x-target-id': '152291597e5079',
        summary: '基础配置',
        description: '拉取活动基础配置',
        tags: ['滴滴巴士 didibus/调试'],
        parameters: [
          {
            name: 'l-debug-timestamp',
            in: 'header',
            description: 'LitaDateTime格式',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': { description: '成功' },
          '404': { description: '失败' },
        },
      },
    },
    '/rank': {
      get: {
        summary: '排行榜',
        tags: ['滴滴巴士 didibus/接口'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Player' },
              example: { player: 123456789 },
            },
          },
        },
        responses: {
          '200': {
            description: '成功',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RankResponse' },
              },
            },
          },
        },
      },
    },
  },
};

describe('swaggerToMarkdown', () => {
  const md = swaggerToMarkdown(spec);

  it('输出不含文档级 H1（标题由调用方组合），按首个 tag 分组', () => {
    expect(md).not.toMatch(/^# /);
    expect(md).toContain('## 滴滴巴士 didibus/调试');
    expect(md).toContain('## 滴滴巴士 didibus/接口');
    expect(md).toContain('活动接口文档');
    expect(md).toContain('Base URL：https://api.example.com');
  });

  it('接口标题含方法、路径与摘要', () => {
    expect(md).toContain('### POST /didibus/config — 基础配置');
    expect(md).toContain('### GET /rank — 排行榜');
  });

  it('参数表：位置/必填/说明', () => {
    expect(md).toContain('| 参数 | 位置 | 类型 | 必填 | 示例 | 说明 |');
    expect(md).toContain(
      '| l-debug-timestamp | header | string | 是 |  | LitaDateTime格式 |',
    );
  });

  it('$ref 展开与嵌套拍平（players[].player）', () => {
    expect(md).toContain('| my | Player |');
    expect(md).toContain('| my.player | integer | 是 | 123456789 | 玩家ID |');
    expect(md).toContain(
      '| players[].player | integer | 是 | 123456789 | 玩家ID |',
    );
    // enum 值中的竖线在表格内转义
    expect(md).toContain('| locale | enum：in \\| vi |  |  | 大区枚举 |');
  });

  it('嵌套超过 3 层不再下钻', () => {
    expect(md).toContain('| deep.a | object |');
    expect(md).not.toContain('| deep.a.b.c');
  });

  it('请求体与响应示例', () => {
    expect(md).toContain('**请求体**');
    expect(md).toContain('`application/json`');
    expect(md).toContain('**响应**');
    expect(md).toContain('**200 成功**');
    expect(md).toContain('"player": 123456789');
  });
});
