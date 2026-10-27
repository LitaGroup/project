/**
 * Fictional example data used only by capture.mjs in an isolated test browser.
 * No requests reach the application's backend, and no business data is written.
 * Names, tokens, hostnames, identifiers, and outputs below are examples.
 */
export const FIXED_NOW = '2026-10-27T07:30:00.000Z';
const recent = '2026-10-27T07:18:00.000Z';
const yesterday = '2026-10-26T09:20:00.000Z';
const created = '2026-10-20T02:00:00.000Z';
const dates = { createdAt: created, updatedAt: recent };
export const user = { id: 1, name: '林舟', department: '产品研发 · 示例团队', avatarUrl: null, email: 'linzhou@example.test', role: '管理员', lastLoginAt: recent };
export const users = [user, ...['陈念', '许言', '周宁', '苏禾', '陆川'].map((name, i) => ({ ...user, id: i + 2, name, department: ['产品设计', '前端研发', '质量保障'][i % 3], role: '成员', email: `member${i + 2}@example.test` }))];
export const markdown = '# 智能任务协作规范\n\n本文为界面验证使用的**示例文档**，说明团队如何通过机器人协作完成项目。\n\n## 工作目标\n\n让需求、执行过程与验收结果保持清晰可追溯。每个任务保留完整的输入、工作计划及交付物。\n\n## 执行流程\n\n1. 提交任务描述与背景资料。\n2. 由调度机器人识别目标并分配负责人。\n3. 持续同步执行日志，完成后进入人工验收。\n\n## 验收清单\n\n- [x] 需求与验收条件已明确\n- [x] 文档与代码已建立关联\n- [ ] 负责人完成最终验收\n\n| 阶段 | 负责人 | 交付物 |\n| --- | --- | --- |\n| 需求识别 | 调度机器人 | 工作计划 |\n| 开发验证 | 研发机器人 | 代码与测试结果 |\n| 人工验收 | 项目责任人 | 验收记录 |\n\n> 本文中的内容与地址均为示例，仅用于视觉验证。\n\n接口示例：`GET /api/tasks/:id/chat`。\n';
/** Fictional OpenAPI example for the existing APIPOST document preview. */
export const apipostSwagger = {
  "openapi": "3.0.3",
  "info": {
    "title": "项目协作接口文档",
    "version": "1.0.0",
    "description": "独立浏览器中的虚构接口示例。"
  },
  "servers": [
    {
      "url": "https://example.test/api"
    }
  ],
  "tags": [
    {
      "name": "项目文档"
    },
    {
      "name": "项目成员"
    },
    {
      "name": "质量验证"
    }
  ],
  "paths": {
    "/api/projects/{projectId}/documents/search": {
      "get": {
        "tags": [
          "项目文档"
        ],
        "summary": "搜索项目文档",
        "description": "根据项目、关键词与类型检索文档。此接口与数据仅用于布局验证，不会访问业务服务。",
        "x-target-id": "example-document-search",
        "parameters": [
          {
            "name": "projectId",
            "in": "path",
            "required": true,
            "description": "项目编号",
            "schema": {
              "type": "integer",
              "format": "int64",
              "example": 1024
            }
          },
          {
            "name": "query",
            "in": "query",
            "required": true,
            "description": "需要匹配标题与正文的检索词",
            "schema": {
              "type": "string",
              "example": "发布验收"
            }
          },
          {
            "name": "documentType",
            "in": "query",
            "description": "限定文档类型",
            "schema": {
              "type": "string",
              "enum": [
                "设计文档",
                "接口文档",
                "测试记录"
              ],
              "example": "接口文档"
            }
          },
          {
            "name": "page",
            "in": "query",
            "description": "结果页码",
            "schema": {
              "type": "integer",
              "default": 1
            }
          }
        ],
        "responses": {
          "200": {
            "description": "检索成功",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DocumentSearchResponse"
                },
                "example": {
                  "total": 1,
                  "page": 1,
                  "items": [
                    {
                      "id": 42,
                      "title": "项目接口与发布验收",
                      "path": "/project/1024/document/42",
                      "metadata": {
                        "owner": "示例成员",
                        "status": "已发布"
                      }
                    }
                  ]
                }
              }
            }
          }
        }
      }
    },
    "/api/projects/{projectId}/documents": {
      "post": {
        "tags": [
          "项目文档"
        ],
        "summary": "创建项目文档",
        "description": "用于检查现有接口选择、请求体 Schema 与 JSON 示例的排版。",
        "x-target-id": "example-document-create",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateDocument"
              },
              "example": {
                "title": "发布验收说明",
                "content": "记录本次交付与验证结果。",
                "metadata": {
                  "owner": "示例成员",
                  "labels": [
                    "验收",
                    "交付"
                  ]
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "文档已创建",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Document"
                },
                "example": {
                  "id": 42,
                  "title": "发布验收说明"
                }
              }
            }
          }
        }
      }
    },
    "/api/projects/{projectId}/members/1": {
      "get": {
        "tags": [
          "项目成员"
        ],
        "summary": "项目成员示例 1",
        "responses": {
          "200": {
            "description": "示例结果"
          }
        }
      }
    },
    "/api/projects/{projectId}/members/2": {
      "get": {
        "tags": [
          "项目成员"
        ],
        "summary": "项目成员示例 2",
        "responses": {
          "200": {
            "description": "示例结果"
          }
        }
      }
    },
    "/api/projects/{projectId}/members/3": {
      "get": {
        "tags": [
          "项目成员"
        ],
        "summary": "项目成员示例 3",
        "responses": {
          "200": {
            "description": "示例结果"
          }
        }
      }
    },
    "/api/projects/{projectId}/members/4": {
      "get": {
        "tags": [
          "项目成员"
        ],
        "summary": "项目成员示例 4",
        "responses": {
          "200": {
            "description": "示例结果"
          }
        }
      }
    },
    "/api/projects/{projectId}/members/5": {
      "get": {
        "tags": [
          "项目成员"
        ],
        "summary": "项目成员示例 5",
        "responses": {
          "200": {
            "description": "示例结果"
          }
        }
      }
    },
    "/api/projects/{projectId}/members/6": {
      "get": {
        "tags": [
          "项目成员"
        ],
        "summary": "项目成员示例 6",
        "responses": {
          "200": {
            "description": "示例结果"
          }
        }
      }
    },
    "/api/projects/{projectId}/checks/7": {
      "get": {
        "tags": [
          "质量验证"
        ],
        "summary": "质量验证示例 1",
        "responses": {
          "200": {
            "description": "示例结果"
          }
        }
      }
    },
    "/api/projects/{projectId}/checks/8": {
      "get": {
        "tags": [
          "质量验证"
        ],
        "summary": "质量验证示例 2",
        "responses": {
          "200": {
            "description": "示例结果"
          }
        }
      }
    },
    "/api/projects/{projectId}/checks/9": {
      "get": {
        "tags": [
          "质量验证"
        ],
        "summary": "质量验证示例 3",
        "responses": {
          "200": {
            "description": "示例结果"
          }
        }
      }
    },
    "/api/projects/{projectId}/checks/10": {
      "get": {
        "tags": [
          "质量验证"
        ],
        "summary": "质量验证示例 4",
        "responses": {
          "200": {
            "description": "示例结果"
          }
        }
      }
    },
    "/api/projects/{projectId}/checks/11": {
      "get": {
        "tags": [
          "质量验证"
        ],
        "summary": "质量验证示例 5",
        "responses": {
          "200": {
            "description": "示例结果"
          }
        }
      }
    },
    "/api/projects/{projectId}/checks/12": {
      "get": {
        "tags": [
          "质量验证"
        ],
        "summary": "质量验证示例 6",
        "responses": {
          "200": {
            "description": "示例结果"
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "DocumentSearchResponse": {
        "type": "object",
        "required": [
          "total",
          "items"
        ],
        "properties": {
          "total": {
            "type": "integer",
            "example": 1,
            "description": "匹配结果总数"
          },
          "page": {
            "type": "integer",
            "example": 1,
            "description": "当前页码"
          },
          "items": {
            "type": "array",
            "description": "当前页文档清单",
            "items": {
              "$ref": "#/components/schemas/Document"
            }
          }
        }
      },
      "Document": {
        "type": "object",
        "required": [
          "id",
          "title"
        ],
        "properties": {
          "id": {
            "type": "integer",
            "format": "int64",
            "example": 42,
            "description": "文档编号"
          },
          "title": {
            "type": "string",
            "example": "项目接口与发布验收",
            "description": "文档标题"
          },
          "path": {
            "type": "string",
            "example": "/project/1024/document/42",
            "description": "知识库中的文档路径"
          },
          "metadata": {
            "type": "object",
            "description": "文档属性",
            "properties": {
              "owner": {
                "type": "string",
                "example": "示例成员",
                "description": "文档负责人"
              },
              "status": {
                "type": "string",
                "example": "已发布",
                "description": "文档状态"
              }
            }
          }
        }
      },
      "CreateDocument": {
        "type": "object",
        "required": [
          "title",
          "content"
        ],
        "properties": {
          "title": {
            "type": "string",
            "example": "发布验收说明",
            "description": "文档标题"
          },
          "content": {
            "type": "string",
            "example": "记录本次交付与验证结果。",
            "description": "Markdown 正文"
          },
          "metadata": {
            "type": "object",
            "description": "文档属性",
            "properties": {
              "owner": {
                "type": "string",
                "example": "示例成员",
                "description": "文档负责人"
              },
              "labels": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "example": [
                  "验收",
                  "交付"
                ],
                "description": "文档标签"
              }
            }
          }
        }
      }
    }
  }
};
export const documents = [
  ['智能任务协作规范', '需求', '-'], ['搜索体验优化方案', '技术', '飞书'], ['用户界面验收清单', '测试', '-'], ['任务中心接口说明', '接口', 'apipost'], ['开发环境配置', '配置', '-'],
].map(([title, type, source], i) => ({ id: i + 1, projectId: 1, title, type, source, fileName: `example-${i + 1}.md`, feishuUrl: source === '飞书' ? 'https://example.test/docs/search' : null, apipostUrl: source === 'apipost' ? 'https://example.test/apipost/project-api' : null, description: '界面验证使用的示例文档', remark: '评审材料已更新', content: source === 'apipost' ? JSON.stringify(apipostSwagger) : markdown, updatedAt: recent }));
export const checks = ['核心接口健康检查', '搜索服务响应检查', '知识库索引完整性'].map((description, i) => ({ id: i + 1, projectId: 1, code: `CHK-00${i + 1}`, description, scriptPath: `workspace/core/health-${i + 1}.check.ts`, device: 'server', updatedAt: recent }));
export const tests = ['任务创建与状态流转', '知识搜索与结果高亮', '项目详情与文档关联'].map((description, i) => ({ id: i + 1, projectId: 1, code: `TC-00${i + 1}`, description, scriptPath: `workspace/core/flow-${i + 1}.test.ts`, device: 'h5', updatedAt: recent }));
export const exports = ['项目交付清单', '任务执行周报'].map((description, i) => ({ id: i + 1, projectId: 1, code: `EXP-00${i + 1}`, description, scriptPath: `workspace/exports/report-${i + 1}.export.ts`, updatedAt: recent }));
export const run = { id: 1, checkId: 1, testId: 1, exportId: 1, scheduleId: null, status: 'success', total: 5, current: 5, success: 5, fail: 0, skip: 0, message: '所有检查通过 · 示例运行', durationMs: 12340, items: ['连接执行环境', '校验接口响应', '检查关键字段', '验证状态流转', '汇总验证结果'].map((title, i) => ({ kind: i === 0 ? 'act' : 'check', no: i + 1, title, status: 'success', expect: '符合预期', real: '验证通过', message: '完成', time: 1200 + i * 120 })), logs: ['[示例] 连接执行环境完成', '[示例] 5 项检查全部通过'], output: ['[start] {"total":5}', '[act] 初始化执行环境', '[check] 核心接口返回 HTTP 200', '[check] 状态流转符合预期', '[end] {"success":5,"fail":0,"skip":0}'], files: [{ title: '项目交付清单', file: 'example-delivery.csv' }], startedAt: '2026-10-27T07:10:00.000Z', finishedAt: '2026-10-27T07:10:12.340Z', queuedAt: null, appVersionId: null, agentName: '示例执行器' };
export const schedules = ['每日核心服务巡检', '知识库索引检查', '发布前自动验证'].map((title, i) => ({ id: i + 1, projectId: 1, title, cron: ['0 9 * * *', '0 */4 * * *', '30 17 * * 1-5'][i], checkId: (i % checks.length) + 1, enabled: i !== 2, lastRunAt: recent, runCount: 24 - i * 5, nextRunAt: '2026-10-28T01:00:00.000Z', nextRuns: ['2026-10-28T01:00:00.000Z', '2026-10-29T01:00:00.000Z', '2026-10-30T01:00:00.000Z'], runStats: { success: 22 - i * 5, fail: 2, total: 24 - i * 5 }, updatedAt: recent }));
export const defects = ['任务处理完成后，状态应及时更新', '搜索结果应保留用户输入的关键词', '项目文档应显示正确的来源'].map((expected, i) => ({ id: i + 1, projectId: 1, platform: ['前端', '后端', 'APP端'][i], priority: ['高', '中', '低'][i], expected, actual: ['状态更新存在短暂延迟，刷新后可恢复', '切换筛选条件后关键词被清空', '来源标签显示为空'][i], images: i === 0 ? ['/images/preview-example.svg'] : [], status: ['修复', '开放', '关闭'][i], testScript: tests[i].scriptPath, fixedAt: recent, verifiedAt: i === 2 ? recent : null, ...dates }));
export const records = [
  { id: 2, defectId: 1, projectId: 1, content: '已修复状态订阅逻辑，等待回归验证。', remark: '示例变更记录', status: '修复', source: 'AI', operator: '研发机器人', createdAt: recent },
  { id: 1, defectId: 1, projectId: 1, content: '回归时发现任务状态存在延迟，已补充复现步骤。', remark: '示例问题', status: '开放', source: '录入', operator: '周宁', createdAt: yesterday },
];
export const resources = [
  ['搜索交互设计稿', 'UI', '确认'], ['任务中心多语言文案', '多语言', '草稿'], ['服务环境与接口配置', '配置', '确认'], ['发布验收资料', '文件资源', '缺失'],
].map(([title, type, status], i) => ({ id: i + 1, projectId: 1, title, type, status, description: '项目所需的示例素材与信息', url: 'https://example.test/resources/preview', documentId: type === '配置' ? 5 : null, prefix: type === '多语言' ? 'Frontend$workspace' : null, remark: null, content: markdown, updatedAt: recent }));
export const milestones = [
  ['2026-10-23', '需求方案评审完成', '达成'], ['2026-10-27', '核心流程开发与联调', '准备中'], ['2026-10-30', '回归测试与发布验收', '准备中'],
].map(([date, content, status], i) => ({ id: i + 1, projectId: 1, date, content, status, achieved: i === 0 ? 'yes' : 'no', achievedAt: i === 0 ? date : null, deliverer: '许言', acceptor: '周宁', remark: '示例节点', updatedAt: recent }));
export const repos = ['workspace-web', 'workspace-server', 'workspace-ios', 'workspace-android'].map((name, i) => ({ id: i + 1, name, fullName: `example/${name}`, description: ['项目管理平台前端', '任务调度与知识服务', '移动客户端', 'Android 客户端'][i], htmlUrl: `https://example.test/code/${name}`, defaultBranch: 'main', language: ['TypeScript', 'TypeScript', 'Swift', 'Kotlin'][i], platform: ['前端', '后端', '苹果', '安卓'][i], status: '有效', lastUpdatedAt: recent, remark: null, ...dates }));
export const branches = repos.slice(0, 2).map((repo, i) => ({ id: i + 1, projectId: 1, repo: repo.fullName, branch: i === 0 ? 'test' : 'main', category: i === 0 ? 'H5' : '后端', remark: null, ...dates }));
export const commits = ['feat: 完善知识搜索与结果摘要', 'fix: 修复任务状态实时同步', 'Merge pull request #42 from example/task-details', 'docs: 更新任务协作与验收规范'].map((message, i) => ({ id: i + 1, repo: repos[i % 2].fullName, branch: i === 2 ? 'main' : 'test', sha: `${i + 1}a74c05a`.padEnd(40, '0'), message, author: ['许言', '陆川', '林舟', '陈念'][i], isMerge: i === 2, url: 'https://example.test/commit/example', committedAt: recent, createdAt: recent, projects: [{ id: 1, name: '智能协作工作台' }] }));
export const releases = [{ id: 1, projectId: 1, content: '## 本次提测\n\n- 完成任务协作与知识搜索流程\n- 修复状态同步与文档展示问题\n\n以上为示例发布记录。', urls: ['https://example.test/preview'], branches: branches.map(({ repo, branch }) => ({ repo, branch })), testers: ['周宁'], operator: '许言', status: '待冒烟', verifier: null, verifiedAt: null, createdAt: recent }];
export const projects = ['智能协作工作台', '知识搜索体验优化', '移动端发布流程', '自动化质量保障', '设计系统与组件库', '团队数据周报'].map((name, i) => ({ id: i + 1, name, type: ['功能', '技术', '活动', '技术', '其它', '数据'][i], status: ['开发中', '测试中', '已发布', '开发中', '待分配', '已关闭'][i], expectedReleaseAt: '2026-10-30', iterationCycle: '2026 · 第 22 迭代', priority: ['P0', 'P1', 'P1', 'P2', 'P2', 'P3'][i], description: '## 项目目标\n\n这是用于界面验证的示例项目。统一管理项目资料、任务执行和验收交付，支持团队与机器人持续协作。\n\n### 本期范围\n\n- 任务执行与过程可追溯\n- 知识文档与项目关联\n- 自动化检查与质量验证', resources: { frontend: '许言', backend: '陆川', qa: '周宁', client: '陈念' }, feishuRecordId: null, scriptsPath: 'workspace/core', feishuWebhook: null, documents, checks, tests, exports, tasks: schedules, defects, projectResources: resources, milestones, projectBranches: branches, projectReleases: releases, ...dates }));
export const executors = [
  { id: 1, name: '研发执行器', ip: '192.0.2.10', port: 4096, type: 'opencode', description: '示例研发任务执行环境', token: null, enabled: true, online: true, version: '1.2.0', defaultLocation: '/workspace/agents', providersCache: [{ id: 'example', name: 'Example AI', models: [{ id: 'example-model', name: 'Example Model' }, { id: 'example-fast', name: 'Example Fast' }] }], providersSyncedAt: recent, lastCheckedAt: recent, ...dates },
  { id: 2, name: '测试执行器', ip: '192.0.2.20', port: 4096, type: 'opencode', description: '示例自动化验证环境', token: null, enabled: true, online: false, version: '1.2.0', defaultLocation: '/workspace/quality', providersCache: [], providersSyncedAt: yesterday, lastCheckedAt: recent, ...dates },
];
export const skillCatalog = ['frontend-design', 'systematic-debugging', 'verification-before-completion'].map((name, i) => ({ name, description: ['构建清晰一致的前端界面', '定位问题根因并验证修复', '按验收条件完成验证'][i], version: '1.0.0', path: `${name}/SKILL.md`, url: `https://example.test/skills/${name}/SKILL.md`, sourceUrl: 'https://example.test/skills' }));
export const workers = ['系统调度机器人', '前端研发机器人', '测试验证机器人', '知识整理机器人', '后端研发机器人', '文档评审机器人'].map((name, i) => ({ id: i === 0 ? 1 : 1000 + i, name, intro: ['识别任务目标，整理工作计划与执行分工', '处理界面开发、交互实现与样式维护', '执行回归验证与验收清单', '沉淀项目知识，整理文档与检索资料', '完成业务接口与任务调度逻辑', '审阅交付文档，校验表述与完整性'][i], avatarUrl: null, kind: '智能体', role: i === 0 ? '调度器' : '工作者', runtime: 'opencode', executorId: 1, providerId: 'example', modelId: 'example-model', prompt: `# 角色定义\n\n你是${name}，服务于示例项目团队。\n\n## 角色职责\n\n- 理解任务目标并检查相关上下文\n- 按照工作计划执行并记录验证结果\n- 提交清晰、可验收的交付物\n\n## 背景知识\n\n项目以 AI 会话为核心参与者，重视可操作性与可追溯性。\n\n## 需要技能\n\n按任务范围使用已安装的技能。\n\n## 接受任务\n\n明确输入、输出与验收条件后开始执行。`, skills: skillCatalog.slice(0, 2), taskDefs: [], ownerUserId: 1 + (i % users.length), ownerName: users[i % users.length].name, materials: '示例调度材料', enabled: i !== 5, system: i === 0, workdir: `/workspace/worker/${i === 0 ? 1 : 1000 + i}`, liveStatus: ['工作中', '工作中', '验收中', '空闲中', '等待中', '空闲中'][i], activeTask: i < 3 ? { id: i + 1, code: `T-20261027-00${i + 1}`, title: ['完善知识搜索体验与结果摘要', '验证任务状态实时更新', '整理本周项目交付清单'][i], status: '进行中' } : null, ...dates }));
const taskSpecs = [
  ['完善知识搜索体验与结果摘要', '前端开发', '执行中', 1001], ['识别移动端发布验收需求', '需求分析', '识别中', 1], ['验证任务状态实时更新', '测试', '待验收', 1002], ['整理本周项目交付清单', '其它', '待反馈', 1003], ['补充自动化回归检查脚本', '测试', '待识别', null], ['完成协作工作台接口联调', '后端开发', '完成', 1004], ['更新项目文档目录与说明', '其它', '待验收', 1003], ['分析搜索结果展示与检索链路', '技术设计', '完成', 1001],
];
export const tasks = taskSpecs.map(([title, type, subStatus, agentId], i) => ({ id: i + 1, code: `T-20261027-00${i + 1}`, title, type, parentId: i === 7 ? 1 : null, rootId: i === 7 ? 1 : i + 1, sortOrder: i, description: `## 任务描述\n\n${title}。这是视觉验证使用的示例任务，请按既定验收标准完成处理。`, input: '基于当前需求文档与项目资料，完成目标并记录验证过程。', content: '## 需求内容\n\n明确任务范围、保留现有流程，完成相关实现与检查。', outputSpec: '提交实现说明、验证结果与可验收的交付物。', missingItems: subStatus === '待反馈' ? [{ item: '请补充交付清单的统计时间范围', reason: '用于确定本次汇总的数据范围' }] : [], status: ['执行中', '识别中'].includes(subStatus) ? '进行中' : subStatus === '完成' ? '已结束' : '等待中', subStatus, workPlan: '1. 阅读项目资料与需求背景\n2. 完成方案与实现\n3. 运行验证并整理交付结果', remindCount: 0, lastRemindedAt: null, agentId, schedulerId: 1, executorId: 1, opencodeSessionId: `example-session-${i + 1}`, result: subStatus === '完成' || subStatus === '待验收' ? '## 交付结果\n\n已完成相关实现与检查。\n\n- 核心流程验证通过\n- 文档与验收材料已整理\n\n示例交付物，等待项目负责人验收。' : null, acceptedAt: subStatus === '完成' ? recent : null, acceptedBy: subStatus === '完成' ? '林舟' : null, deliveredAt: recent, archivedAt: null, canceledAt: null, events: [{ id: 1, taskId: i + 1, type: 'dispatch', content: '调度机器人已识别任务并分配执行', meta: null, operator: '系统调度机器人', createdAt: recent }], liveLines: ['正在检查相关页面与调用关系', '已完成上下文分析，开始处理实现', '运行类型检查与关键流程验证', '整理验证结果与交付说明'], ...dates }));
tasks[0].children = [tasks[7]];
const sender = { id: 'worker-1001', name: '前端研发机器人', kind: 'worker', workerId: 1001, roleLabel: '工作者', avatarUrl: null };
export const chat = { task: tasks[0], rootTask: tasks[0], pipeline: [tasks[0], tasks[7]].map((task) => ({ task, agent: sender, scheduler: { id: 'worker-1', name: '系统调度机器人', kind: 'scheduler', workerId: 1, avatarUrl: null } })), messages: [
  { id: 'msg-user', taskId: 1, role: 'user', sender: { id: 'user-1', name: user.name, kind: 'user', avatarUrl: null }, content: '请完善知识搜索体验，保留目录筛选和分页，并为搜索结果提供清晰的摘要与高亮。', createdAt: '2026-10-27T06:30:00.000Z', status: 'complete', kind: 'message' },
  { id: 'msg-event', taskId: 1, role: 'system', sender: { id: 'system', name: '系统', kind: 'system' }, content: '任务已识别，交由前端研发机器人执行', createdAt: '2026-10-27T06:31:00.000Z', status: 'complete', kind: 'event' },
  { id: 'msg-assistant', taskId: 1, role: 'assistant', sender, content: '已完成当前检索链路分析，开始整理搜索结果的展示。\n\n### 实施进度\n\n- 已核对全文与向量检索的返回结构\n- 已检查目录筛选与分页行为\n- 正在验证摘要长度与关键词高亮\n\n| 检查项 | 结果 |\n| --- | --- |\n| 目录限定 | 通过 |\n| 分页切换 | 通过 |\n| 摘要展示 | 验证中 |\n\n以上为界面验证使用的示例对话。', createdAt: recent, status: 'complete', kind: 'message', tools: [{ id: 'tool-1', name: 'read', status: 'success', detail: '读取 KnowledgeSearchPage.tsx 与搜索接口定义' }] },
  { id: 'msg-question', taskId: 1, role: 'assistant', sender, content: '', createdAt: recent, status: 'complete', kind: 'question', question: { id: 'example-question', sessionId: 'example-session-1', state: 'pending', askedAt: recent, questions: [{ header: '摘要长度', question: '示例搜索结果的摘要长度采用哪种方式？', options: [{ label: '保持当前长度', description: '沿用现有展示范围' }, { label: '更紧凑', description: '缩短为两行摘要' }], custom: true }] } },
] };
export const debug = { worker: { id: 1001, name: workers[1].name, intro: workers[1].intro, avatarUrl: null, executorName: executors[0].name, providerId: 'example', modelId: 'example-model' }, sessionId: 'example-debug-session', status: 'idle', messages: [
  { id: 'debug-user', role: 'user', content: '请检查任务协作流程，并给出验证步骤。', status: 'complete', createdAt: yesterday },
  { id: 'debug-assistant', role: 'assistant', content: '任务流程已梳理，建议按以下步骤验证。\n\n1. 新建任务并确认描述保存完整。\n2. 检查调度与机器人分配。\n3. 查看执行日志与最终交付物。\n4. 由负责人完成验收。\n\n> 这是独立测试浏览器中的示例回复。', reasoning: '先检查任务状态与事件流，再核对交付内容和验收动作。', status: 'complete', createdAt: recent },
], todos: [{ content: '核对任务状态与执行阶段', status: 'completed', priority: 'high' }, { content: '检查实时日志与交付物展示', status: 'completed', priority: 'high' }, { content: '完成验收流程检查', status: 'in_progress', priority: 'medium' }], error: null, updatedAt: recent };
export const templates = ['前端需求实现', '回归测试验证', '项目文档整理'].map((name, i) => ({ id: i + 1, name, description: markdown, input: '需求说明、项目资料与验收条件', outputSpec: '实现说明、验证结果与交付文档', agentId: workers[i + 1].id, ...dates }));
export const settings = { environment: 'development', port: 3100, scriptsDir: '/workspace/scripts', imageWebroot: '/workspace/images', appUrl: 'https://example.test', apiUrl: 'https://example.test/api', litaApiHost: 'https://example.test/platform', feishuProjectSourceUrl: 'https://example.test/projects/source', feishuTokenSource: 'app-credential', feishuWebhookConfigured: true, github: { tokenConfigured: true, org: 'example-team' }, publicAgentTokenConfigured: true, agent: { online: true, name: '示例测试代理', appiumUrl: 'http://192.0.2.30:4723' } };
export const apps = ['workspace.test.2.8.0.apk', 'workspace.stable.2.7.2.apk', 'workspace.test.2.8.0.ipa'].map((file, i) => ({ file, platform: i === 2 ? 'ios' : 'android', size: 64321678 + i * 2048, updatedAt: recent, packageId: 'test.example.workspace', version: i === 1 ? '2.7.2' : '2.8.0', installedVersion: '2.8.0', simulator: i === 2 ? '示例 iPhone' : '示例 Android' }));
export const simulators = ['示例 Android', '示例 iPhone'].map((name, i) => ({ name, platform: i === 0 ? 'android' : 'ios', product: 'workspace', packageId: 'test.example.workspace', online: true, model: i === 0 ? 'Android 16' : 'iPhone', installedVersion: '2.8.0', env: 'test' }));
const node = (id, name, title, kind = 'article') => ({ id, name, title, path: `/guides/${name}`, parentPath: '/guides', kind, content: markdown, source: 'native', sourceDocumentId: null, contentHash: 'example-hash', indexStatus: 'ready', indexError: null, indexAttempts: 1, ...dates });
export const article = node('node-1', 'agent-workflow', '智能任务协作规范');
const knowledgeArticles = [article, node('node-2', 'quality-checklist', '质量验证与验收清单'), node('node-3', 'project-delivery', '项目交付文档规范')];
export const knowledgeDirectory = { path: '/', title: '知识库', parentPath: null, directories: [node('directory-1', 'guides', '团队协作指南', 'directory'), node('directory-2', 'engineering', '工程实践', 'directory'), node('directory-3', 'projects', '项目资料', 'directory')], articles: knowledgeArticles };
export const searchResults = knowledgeArticles.map((node, i) => ({ nodeId: node.id, title: node.title, path: node.path, headingPath: i === 0 ? '工作目标 / 执行流程' : '验收清单', content: '任务协作需要明确输入、执行计划与验收标准。调度机器人识别目标后分配负责人，执行过程通过实时日志同步，最终交付物由项目负责人验收。此内容为搜索展示的示例数据。', score: 0.94 - i * 0.06, matchedBy: ['hybrid', 'fulltext', 'vector'][i], updatedAt: recent }));
export const exampleImage = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="430" viewBox="0 0 800 430"><rect width="800" height="430" rx="16" fill="#f2f4f7"/><rect x="28" y="28" width="744" height="374" rx="14" fill="white" stroke="#e4e7ec"/><rect x="52" y="56" width="150" height="17" rx="4" fill="#253044"/><rect x="52" y="91" width="340" height="10" rx="3" fill="#d1d7df"/><rect x="52" y="132" width="206" height="226" rx="10" fill="#f7f8fa"/><rect x="281" y="132" width="206" height="226" rx="10" fill="#f7f8fa"/><rect x="510" y="132" width="206" height="226" rx="10" fill="#f7f8fa"/><rect x="296" y="178" width="176" height="94" rx="8" fill="white" stroke="#9cadd2"/><rect x="311" y="193" width="132" height="8" rx="3" fill="#c4ccd8"/><rect x="311" y="215" width="100" height="8" rx="3" fill="#dde2ea"/><rect x="311" y="239" width="66" height="16" rx="8" fill="#e0e9ff"/><text x="52" y="385" fill="#667085" font-family="sans-serif" font-size="12">EXAMPLE · UI verification fixture</text></svg>';

const find = (rows, id) => rows.find((row) => String(row.id) === String(id)) ?? rows[0];
const scope = (rows, url) => { const id = url.searchParams.get('projectId'); return id ? rows.filter((row) => row.projectId === Number(id)) : rows; };
export function apiFixture(input, { loggedIn = true } = {}) {
  const url = new URL(input, 'http://localhost:5273');
  const path = decodeURI(url.pathname).replace(/^\/api/, '');
  if (path === '/auth/me') return { user: loggedIn ? user : null };
  if (path === '/auth/users') return { users };
  if (path === '/auth/agent-token') return { token: 'pmp_example_only_not_a_real_token' };
  if (path === '/settings') return settings;
  if (path === '/projects/page') return { items: projects, total: projects.length, iterations: ['2026 · 第 22 迭代', '2026 · 第 21 迭代'], priorities: ['P0', 'P1', 'P2', 'P3'] };
  if (path === '/projects') return projects;
  if (/^\/projects\/\d+\/releases$/.test(path)) return releases;
  if (/^\/projects\/\d+$/.test(path)) return find(projects, path.split('/')[2]);
  for (const [key, rows] of Object.entries({ documents, resources, defects, milestones, schedules, 'code-branches': branches, 'code-events': commits, repos, executors, 'task-templates': templates })) {
    if (path === `/${key}`) return scope(rows, url);
    if (new RegExp(`^/${key}/\\d+$`).test(path)) return find(rows, path.split('/')[2]);
  }
  if (/^\/defects\/\d+\/records$/.test(path)) return records;
  if (path === '/github/repos') return repos.map((repo) => ({ ...repo, private: true, updatedAt: recent }));
  if (path === '/github/branches') return ['main', 'test', 'stable'];
  if (path === '/checks/script-dirs') return ['workspace', 'workspace/core', 'workspace/exports'];
  for (const [key, rows] of Object.entries({ checks, tests, exports })) {
    if (path === `/${key}`) return scope(rows, url);
    if (path === `/${key}/scripts`) return rows.map((row) => row.scriptPath);
    if (new RegExp(`^/${key}/runs/\\d+$`).test(path)) return run;
    if (new RegExp(`^/${key}/\\d+/runs$`).test(path)) return [run, { ...run, id: 2, status: 'fail', success: 4, fail: 1, startedAt: yesterday, finishedAt: yesterday }];
    if (new RegExp(`^/${key}/\\d+$`).test(path)) return find(rows, path.split('/')[2]);
  }
  if (/^\/schedules\/\d+\/runs$/.test(path)) return [run];
  if (path === '/app-versions') return [{ id: 1, projectId: 1, platform: 'android', appTarget: 'lita', version: '2.8.0', remark: '示例版本', ...dates }];
  if (path === '/agent/apps') return apps;
  if (path === '/agent/apps/simulators') return simulators;
  if (path === '/workers/skill-catalog') return skillCatalog;
  if (path === '/workers/live' || path === '/workers') return workers;
  if (/^\/workers\/\d+\/debug$/.test(path)) return debug;
  if (/^\/workers\/\d+$/.test(path)) return find(workers, path.split('/')[2]);
  if (/^\/executors\/\d+\/providers$/.test(path)) return executors[0].providersCache;
  if (path === '/tasks/overview') return { total: tasks.length, roots: tasks.length - 1, statuses: { 等待中: 4, 进行中: 2, 已结束: 2 }, subStatuses: { 待识别: 1, 待反馈: 1, 待验收: 2, 识别中: 1, 执行中: 1, 完成: 2, 取消: 0 } };
  if (path === '/tasks') return url.searchParams.get('rootOnly') === 'false' ? tasks : tasks.filter((task) => !task.parentId);
  if (/^\/tasks\/\d+\/chat$/.test(path)) return chat;
  if (/^\/tasks\/\d+$/.test(path)) return find(tasks, path.split('/')[2]);
  if (path.startsWith('/docs/detail')) return path.endsWith('/') || path === '/docs/detail' ? knowledgeDirectory : article;
  if (path.startsWith('/docs/nodes/')) return article;
  if (path === '/docs/search') return { query: url.searchParams.get('q') || '任务', source: 'project', path: '/', page: 1, pageSize: 20, mode: 'hybrid', results: searchResults, project: { page: 1, pageSize: 20, hasMore: false, mode: 'hybrid', results: searchResults } };
  return undefined;
}

export function streamFixture(input) {
  const path = new URL(input, 'http://localhost:5273').pathname;
  if (path === '/api/tasks/stream') return { type: 'snapshot', tasks, at: Date.parse(FIXED_NOW) };
  if (/\/tasks\/\d+\/chat\/stream$/.test(path)) return { type: 'ready', at: Date.parse(FIXED_NOW) };
  if (/\/workers\/\d+\/debug\/stream$/.test(path)) return { type: 'snapshot', snapshot: debug };
  if (/\/(checks|tests|exports)\/runs\/\d+\/stream$/.test(path)) return run;
  return { type: 'ping', at: Date.parse(FIXED_NOW) };
}
