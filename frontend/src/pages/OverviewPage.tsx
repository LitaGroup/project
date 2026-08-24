import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@appica/ui-react/card'
import { Badge } from '@appica/ui-react/badge'
import { api, type Project } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'

interface InfoCard {
  title: string
  description: string
  points: string[]
}

const aiCards: InfoCard[] = [
  {
    title: 'REST API 全量暴露',
    description:
      '所有能力都通过 /api 暴露，AI 可直接读写项目、文档、检查、测试、任务、缺陷。接口约定见根目录 AGENTS.md。',
    points: [
      '项目 / 文档 / 检查 / 测试 / 任务 / 缺陷 全量增删改查',
      '飞书预览（不落库）：GET /api/feishu/read?url=',
      '全局列表 GET /api/{checks,tests,documents,tasks,defects}（projectId 可选）',
    ],
  },
  {
    title: '.md Markdown 视图',
    description:
      '给资源加 .md 后缀即返回 text/markdown，agent 可直接读取结构化内容，末尾附带可执行的 curl。',
    points: [
      'GET /api/projects/:id.md（项目 + 文档/检查/测试/任务/缺陷清单 + AI 操作）',
      'GET /api/documents/:id.md（文档元信息 + 正文）',
      '路由声明在 :id 之前避免参数匹配冲突',
    ],
  },
  {
    title: '一步式运行（流式 Markdown）',
    description:
      'POST 启动一次脚本运行，并以 text/markdown 流式返回：先头部，运行中逐行输出脚本原始输出，终态附「结果」小节。客户端断开自动退订。',
    points: [
      'POST /api/checks/:id/run.md',
      'POST /api/tests/:id/run.md',
      '实现见 backend/src/common/run-markdown.ts',
    ],
  },
  {
    title: 'SSE 实时进度',
    description:
      '前端订阅实时进度，agent 也可用。先推当前快照，进度变化逐条推送，终态推送后自动完成；终态快照保留 5min 供晚订阅。',
    points: [
      'GET /api/checks/runs/:runId/stream',
      'GET /api/tests/runs/:runId/stream',
      'REST 兜底：GET /api/{checks,tests}/runs/:runId（无 live 句柄读库，running 则 2s 轮询）',
    ],
  },
]

const ruleCards: InfoCard[] = [
  {
    title: '检查 / 测试',
    description:
      '本质是脚本的登记信息（编号 + 描述 + 脚本路径）。检查用 .check.ts，测试用 .test.ts，结构与接口一一对应。',
    points: [
      '自动导入：POST /api/{checks,tests}/import 扫描项目脚本目录，按 scriptPath 过滤已登记',
      '运行：node 直跑脚本（以脚本根目录为 cwd，超时 120s SIGTERM），解析 stdout 行协议 [{type}] {json}',
      '运行状态：running / success / fail / error',
      '删除检查/项目时应用层级联删运行记录',
    ],
  },
  {
    title: '任务（定时调度）',
    description:
      '按 crontab 表达式定时运行一个已登记的检查脚本，结果落 check_runs（taskId 标记触发来源）。',
    points: [
      'cron 5 段（分时日月周）或 6 段（前置秒），不支持年；用 cron 包校验，非法 400',
      'checkId 须为本项目已登记检查；enabled 停用不参与调度',
      '手动触发 POST /api/tasks/:id/run 不受 enabled 限制',
      '运行开始 / 终态向项目飞书群推送通知卡片（webhook 取项目 feishuWebhook）',
      '删除任务保留已产生的运行记录',
    ],
  },
  {
    title: '缺陷（与飞书双向绑定）',
    description:
      '与项目设置的飞书多维表格双向绑定。这是飞书同步中唯一的回写场景，其余模块均为单向导入。',
    points: [
      '飞书 → 平台：POST /api/defects/sync 全量覆盖（按 feishuRecordId upsert，本地 testScript 保留）',
      '平台 → 飞书：PATCH /api/defects/:id 状态 / 端变更异步回写（失败仅记日志不阻断）',
      '状态：open / reopen / fixed / closed / invalid（飞书 new→open、close→closed，乱填→open）',
      '端：前端 / 后端 / APP端 / 未知（其余归「未知」，回写只写真实端）',
      'fixed 前置：有 testScript 须已登记且最近一次运行 success；POST /api/defects/:id/verify 验证',
    ],
  },
  {
    title: '文档 / 飞书同步',
    description:
      '文档单向导入（飞书 → 平台），统一转 Markdown。飞书 token 统一从 Lita 平台 API 获取，每 30 分钟刷新。',
    points: [
      '类型：需求 / 功能 / 测试 / 技术 / 接口 / 配置；来源：飞书 / -',
      '飞书导入的文档不允许本地改正文（403），只能「更新同步」覆盖；备注 remark 任何来源都可编辑',
      '支持 docx / sheets / bitable / wiki；判重 key 含子标识（同一表格不同 sheet 互不覆盖）',
      '项目同步：POST /api/projects/sync-feishu 增量同步（首次取近 15 天，后续取近 7 天）',
    ],
  },
]

function InfoCardItem({ card }: { card: InfoCard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{card.title}</CardTitle>
        <CardDescription>{card.description}</CardDescription>
      </CardHeader>
      <ul className="flex flex-col gap-2 px-6 pb-6 group-data-inset/card:px-4">
        {card.points.map((p) => (
          <li
            key={p}
            className="flex gap-2 text-sm text-foreground-muted"
          >
            <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-foreground-muted" />
            <span className="min-w-0">{p}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function OverviewPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e: Error) => setError(e.message))
  }, [])

  const inProgress = projects.filter((p) => p.status === '进行中')

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-2xl font-semibold">概览</h1>
        <p className="mb-4 text-sm text-foreground-muted">
          以 AI 为中心的项目管理平台：AI（agent 会话）是核心参与者而非附属功能，所有能力都通过 HTTP API 暴露，agent 可直接读写并流式获取运行结果。
        </p>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">AI Agent 用法</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {aiCards.map((card) => (
            <InfoCardItem key={card.title} card={card} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">核心逻辑与规则</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {ruleCards.map((card) => (
            <InfoCardItem key={card.title} card={card} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-xl font-semibold">进行中的项目</h2>
          <Badge variant="primary">{inProgress.length}</Badge>
        </div>
        {error && <p className="text-sm">加载失败：{error}</p>}
        {!error && inProgress.length === 0 && (
          <p className="text-sm">暂无进行中的项目</p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {inProgress.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle>
                  <Link to={`/projects/${p.id}`}>{p.name}</Link>
                </CardTitle>
                <CardDescription>
                  {p.type} · 预期发布 {p.expectedReleaseAt ?? '未定'}
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <StatusBadge status={p.status} />
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
