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

const usageCards: InfoCard[] = [
  {
    title: '搜索项目 → 项目详情',
    description:
      '典型流程：先按名称搜索拿到项目 id，再读项目详情（含文档/检查/用例/任务清单与可执行命令），最后决定运行什么。',
    points: [
      'GET /api/projects/search.md?q={名称关键词}（模糊匹配，前 5 条，含详情链接）',
      'GET /api/projects/{id}.md（项目信息 + 文档/检查/用例/任务清单 + 最近运行结果 + 末尾 AI 操作小节）',
      'GET /api/documents/{docId}.md（文档元信息 + Markdown 正文全文）',
      '原则：用户没给 id 时先搜索，不要猜 id',
    ],
  },
  {
    title: '运行检查 / 用例 / 任务（流式）',
    description:
      'POST 启动一次运行并以 text/markdown 流式返回：先头部信息，运行中逐行追加脚本原始输出，终态附「结果」小节后结束。客户端断开自动退订。',
    points: [
      'curl -N -X POST {BASE}/api/checks/{checkId}/run.md',
      'curl -N -X POST {BASE}/api/tests/{testId}/run.md',
      'curl -N -X POST {BASE}/api/tasks/{taskId}/run.md（手动触发，不受 enabled 限制）',
      '必须带 -N 禁用缓冲逐行读取，无需轮询；长耗时操作直接等流结束',
    ],
  },
  {
    title: '查看运行结果',
    description:
      '判断「上次运行是否正常」时，优先读项目详情中已汇总的最近结果；需要完整过程再取单次运行详情。',
    points: [
      'GET /api/checks/runs/{runId}.md（检查 / 任务的运行详情：元信息 + 结果 + 输出全文）',
      'GET /api/tests/runs/{runId}.md（用例的运行详情）',
      'JSON 兜底 GET .../runs/{runId}；SSE 实时流 GET .../runs/{runId}/stream',
    ],
  },
  {
    title: '全局列表 / 设置 / 脚本更新',
    description:
      '跨项目列举数据走常规 JSON 接口（projectId 可选，不传返回全部）；设置与脚本仓库更新走 .md 视图。',
    points: [
      'GET /api/{checks,tests,documents,tasks,defects}[?projectId=]',
      'GET /api/settings.md（环境 / 脚本目录 / 访问域名 / agent 在线状态）',
      'curl -N -X POST {BASE}/api/settings/scripts/pull.md（脚本仓库 git pull，流式返回）',
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

/** 命令行片段块（可复制） */
function CommandBlock({ command }: { command: string }) {
  return (
    <pre className="overflow-x-auto rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm whitespace-pre-wrap">
      <code>{command}</code>
    </pre>
  )
}

function SkillInstallSection() {
  const origin = window.location.origin
  const skillUrl = `${origin}/SKILL.md`
  const installCmd = `mkdir -p ~/.opencode/skills/project-manage && curl -fsSL ${skillUrl} -o ~/.opencode/skills/project-manage/SKILL.md`

  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold">安装 SKILL（让 Agent 学会操作本平台）</h2>
      <Card>
        <CardHeader>
          <CardTitle>project-manage 技能</CardTitle>
          <CardDescription>
            技能说明随平台代码维护，涵盖：搜索项目、读取项目详情与文档正文、运行检查/用例/任务并流式获取结果、查看设置与更新脚本仓库。安装后 Agent 会话可直接按技能说明操作本平台。
          </CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-4 px-6 pb-6 group-data-inset/card:px-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">1. 在线地址（SKILL 文件本体）</p>
            <a
              href={skillUrl}
              target="_blank"
              rel="noreferrer"
              className="w-fit text-sm text-foreground-intense underline"
            >
              {skillUrl}
            </a>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">2. 安装到 opencode（推荐）</p>
            <CommandBlock command={installCmd} />
            <p className="text-sm text-foreground-muted">
              安装后重启会话即可生效；SKILL 随平台迭代，需要更新时重新执行上面的命令覆盖即可。
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">3. 免安装直接使用</p>
            <p className="text-sm text-foreground-muted">
              也可以不安装，直接告诉 Agent：「读取 {skillUrl}，按说明操作项目管理平台」。
            </p>
          </div>
        </div>
      </Card>
    </section>
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
  const displayed = inProgress.slice(0, 10)

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-2xl font-semibold">概览</h1>
        <p className="mb-4 text-sm text-foreground-muted">
          以 AI 为中心的项目管理平台：AI（agent 会话）是核心参与者而非附属功能，所有能力都通过 HTTP API 暴露，agent 可直接读写并流式获取运行结果。
        </p>
      </section>

      <SkillInstallSection />

      <section>
        <h2 className="mb-4 text-xl font-semibold">常用使用方法</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {usageCards.map((card) => (
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
          {displayed.map((p) => (
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
