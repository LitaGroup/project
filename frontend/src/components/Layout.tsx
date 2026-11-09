import { useEffect, useState } from 'react'
import { Outlet, Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Navigation,
  NavigationList,
  NavigationItem,
} from '@appica/ui-react/navigation'
import { NavigationLink } from '@appica/ui-react/navigation'
import { Badge } from '@appica/ui-react/badge'
import { Button, buttonVariants } from '@appica/ui-react/button'
import { Kbd, KbdGroup } from '@appica/ui-react/kbd'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@appica/ui-react/tooltip'
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from '@appica/ui-react/avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@appica/ui-react/dropdown-menu'
import {
  Briefcase,
  Bug,
  CalendarClock,
  CircleCheck,
  ClipboardList,
  Cpu,
  DeviceMobile,
  FileCode,
  FileExport,
  FileText,
  Folder,
  GitCommit,
  GitFork,
  LayoutDashboard,
  ListCheck,
  Book,
  Package,
  PlugConnected,
  Plus,
  Robot,
  Search,
  Settings,
  TimelineEvent,
  Users,
} from '@appica/icons-react'
import type { IconComponent } from '@appica/icons-react'
import { LayoutGroup, m } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { api, type TicketWorkflowDefinitionSummary } from '../lib/api'
import { PageTransition } from './PageTransition'
import {
  DetailAISlotHost,
  DetailAISlotProvider,
} from './detail/DetailAISlotContext'
import { KnowledgeSearchDialog } from './KnowledgeSearchDialog'
import { navIndicatorTransition } from '../lib/motion'

/** 左侧导航项 */
interface NavItem {
  to: string
  label: string
  icon: IconComponent
  ready: boolean
  /** 未启用项展示的徽标文案（缺省「待补充」） */
  badge?: string
  /** 仅精确匹配该路径时高亮（个人中心 /profile 与 /profile/robot 共用一个分区） */
  end?: boolean
}

/** 左侧导航分组：组标题 + 组内导航项 */
interface NavGroup {
  label?: string
  items: NavItem[]
}

/** 顶级导航分区：顶部 Tab 切换，各分区有独立的左侧导航 */
interface NavSection {
  key: string
  label: string
  /** 点击顶部 Tab 跳转的默认页 */
  to: string
  /** 路径归属判定（决定顶部 Tab / 左侧导航高亮） */
  match: (pathname: string) => boolean
  items: NavItem[]
  /** 需要分组展示时使用；存在时优先于 items */
  groups?: NavGroup[]
  /** 仅管理员可见（管理区） */
  adminOnly?: boolean
}

const NAV_SECTIONS: NavSection[] = [
  {
    key: 'projects',
    label: '项目',
    to: '/',
    match: (p) =>
      !p.startsWith('/admin') &&
      !p.startsWith('/tasks') &&
      !p.startsWith('/tickets') &&
      !p.startsWith('/docs') &&
      !p.startsWith('/robots') &&
      !p.startsWith('/workbench'),
    items: [
      { to: '/', label: '概览', icon: LayoutDashboard, ready: true },
      { to: '/projects', label: '项目', icon: Briefcase, ready: true },
      { to: '/tests', label: '用例', icon: ListCheck, ready: true },
      { to: '/checks', label: '检查', icon: CircleCheck, ready: true },
      { to: '/exports', label: '导出', icon: FileExport, ready: true },
      { to: '/defects', label: '缺陷', icon: Bug, ready: true },
      { to: '/documents', label: '文档', icon: FileText, ready: true },
      { to: '/resources', label: '资源', icon: Folder, ready: true },
      { to: '/milestones', label: '节点', icon: TimelineEvent, ready: true },
      { to: '/commits', label: '提交', icon: GitCommit, ready: true },
      { to: '/schedules', label: '定时任务', icon: CalendarClock, ready: true },
      { to: '/apps', label: 'APP', icon: DeviceMobile, ready: true },
      { to: '/settings', label: '设置', icon: Settings, ready: true },
    ],
  },
  {
    key: 'tasks',
    label: '任务',
    to: '/tasks/list',
    match: (p) => p.startsWith('/tasks'),
    items: [
      { to: '/tasks/list', label: '任务', icon: ClipboardList, ready: true },
      { to: '/tasks/definitions', label: '定义', icon: Package, ready: true },
    ],
  },
  {
    key: 'tickets',
    label: '工单',
    to: '/tickets',
    match: (p) => p.startsWith('/tickets'),
    items: [],
    groups: [
      {
        label: '我的',
        items: [
          { to: '/tickets/mine', label: '我的工单', icon: ClipboardList, ready: true },
        ],
      },
      {
        label: '全部',
        items: [],
      },
    ],
  },
  {
    key: 'knowledge',
    label: '知识',
    to: '/docs/detail/',
    match: (p) => p.startsWith('/docs'),
    items: [
      { to: '/docs/detail/', label: '知识库', icon: Book, ready: true },
      { to: '/docs/scripts', label: '脚本库', icon: FileCode, ready: true },
    ],
  },
  {
    key: 'admin',
    label: '管理',
    to: '/admin/users',
    adminOnly: true,
    match: (p) => p.startsWith('/admin'),
    items: [
      { to: '/admin/users', label: '用户列表', icon: Users, ready: true },
      { to: '/admin/ticket-config', label: '工单配置', icon: ClipboardList, ready: true },
      { to: '/admin/repos', label: '代码仓库', icon: GitFork, ready: true },
      { to: '/admin/github-access', label: 'GitHub 权限', icon: Settings, ready: true },
      { to: '/admin/feishu-config', label: '飞书配置', icon: PlugConnected, ready: true },
      { to: '/admin/task-templates', label: '任务定义', icon: Package, ready: true },
      { to: '/admin/workers', label: '机器人', icon: Robot, ready: true },
      { to: '/admin/executors', label: '执行器', icon: Cpu, ready: true },
      { to: '/admin/mcp-logs', label: 'MCP 调用', icon: PlugConnected, ready: true },
    ],
  },
]

/** 个人中心分区：不占顶部 Tab，从右上角用户菜单进入，使用独立左侧导航 */
const PROFILE_SECTION: NavSection = {
  key: 'profile',
  label: '个人中心',
  to: '/profile',
  match: (p) => p.startsWith('/profile'),
  items: [
    {
      to: '/profile',
      label: '个人中心',
      icon: Users,
      ready: true,
      end: true,
    },
    { to: '/profile/robot', label: '助理配置', icon: Robot, ready: true },
    {
      to: '/profile/task-definitions',
      label: '任务定义',
      icon: Package,
      ready: true,
    },
  ],
}

/** 顶栏右侧用户区：未登录显示飞书登录入口，已登录显示头像下拉（身份信息 + 个人中心 + 退出登录） */
function UserArea() {
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()
  if (loading) return null
  if (!user) {
    return (
      <a
        href="/api/auth/feishu"
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        飞书登录
      </a>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-2">
            <Avatar size="2xs">
              {user.avatarUrl && (
                <AvatarImage src={user.avatarUrl} alt={user.name} />
              )}
              <AvatarFallback>{user.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <span className="max-w-24 truncate">{user.name}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-56">
        <div className="flex items-center gap-3 px-2.5 pt-2.5 pb-1.5">
          <Avatar size="sm">
            {user.avatarUrl && (
              <AvatarImage src={user.avatarUrl} alt={user.name} />
            )}
            <AvatarFallback>{user.name.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground-intense">
              {user.name}
            </p>
            <p className="truncate text-xs text-foreground-muted">
              {user.department ?? '未获取部门'}
            </p>
          </div>
          <Badge variant="secondary" size="sm">
            {user.role}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/profile')}>
          个人中心
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/profile/robot')}>
          助理配置
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/profile/task-definitions')}>
          任务定义
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void logout()}>退出登录</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 左侧导航链接列表（普通分区与分组分区共用） */
function SidebarNavList({ items }: { items: NavItem[] }) {
  return (
    <NavigationList className="gap-1">
      {items.map((item) => (
        <NavigationItem key={item.to}>
          <NavigationLink
            value={item.to}
            disabled={!item.ready}
            render={
              <NavLink
                to={item.to}
                end={item.end ?? item.to === '/'}
              />
            }
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2.5">
                <item.icon size={18} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
              {!item.ready && (
                <Badge variant="soft">{item.badge ?? '待补充'}</Badge>
              )}
            </span>
          </NavigationLink>
        </NavigationItem>
      ))}
    </NavigationList>
  )
}

export function Layout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchOpen, setSearchOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [ticketWorkflows, setTicketWorkflows] = useState<
    TicketWorkflowDefinitionSummary[]
  >([])
  const isWorkbench = pathname.startsWith('/workbench')
  const isRobotChat = pathname.startsWith('/robots')
  const isProfile = pathname.startsWith('/profile')
  const isAdmin = user?.role === '管理员'
  // 管理区仅管理员可见：非管理员过滤掉管理 Tab（路由层另有 RequireAdmin 兜底）
  const visibleSections = isAdmin
    ? NAV_SECTIONS
    : NAV_SECTIONS.filter((section) => !section.adminOnly)
  // 只有启用且已发布的工单配置进入顶部「+」新建入口
  const availableTicketWorkflows = ticketWorkflows.filter(
    (item) => item.enabled && item.latestPublishedVersion > 0,
  )

  useEffect(() => {
    if (!user) return
    let alive = true
    api
      .listTicketWorkflowDefinitions()
      .then((rows) => {
        if (alive) setTicketWorkflows(rows)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [user])

  // 工作台/机器人/个人中心不归属任何顶级分区（避免高亮「项目」），个人中心使用独立左侧导航
  const activeSection = isWorkbench || isRobotChat
    ? undefined
    : isProfile
      ? PROFILE_SECTION
      : (visibleSections.find((s) => s.match(pathname)) ?? visibleSections[0])
  // 工单分区「全部」分组下追加所有启用且已发布的工单定义，点击进入对应工单列表
  const sidebarSection: NavSection | undefined =
    activeSection?.key === 'tickets' && activeSection.groups
      ? {
          ...activeSection,
          groups: activeSection.groups
            .map((group) =>
              group.label === '全部'
                ? {
                    ...group,
                    items: availableTicketWorkflows.map((workflow) => ({
                      to: `/tickets/wf/${workflow.id}`,
                      label: workflow.name,
                      icon: ClipboardList,
                      ready: true,
                    })),
                  }
                : group,
            )
            .filter((group) => group.items.length > 0),
        }
      : activeSection

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      // Option/Alt+N：macOS 上 Option+N 是死键（event.key 为 Dead），必须用物理键位 code 判断
      if (event.altKey && event.code === 'KeyN') {
        event.preventDefault()
        setCreateOpen(true)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* 顶部导航：保持 20% 起始，与工作台正文左侧对齐 */}
      <header className="grid h-14 shrink-0 grid-cols-[20%_minmax(0,1fr)_auto] items-center bg-background">
        <div className="flex h-full items-center px-6">
          <Link
            to="/"
            className="text-base font-semibold text-foreground-intense"
          >
            Lita 工作中心
          </Link>
        </div>
        <div className="flex h-full min-w-0 items-center pl-3">
          <LayoutGroup id="top-navigation">
            <nav className="flex items-center gap-1">
              {visibleSections.map((section) => {
                const active = section.key === activeSection?.key
                return (
                  <Link
                    key={section.key}
                    to={section.to}
                    aria-current={active ? 'page' : undefined}
                    className={`relative isolate rounded-[var(--radius-md)] px-3 py-1.5 text-sm ${
                      active
                        ? 'font-medium text-foreground-intense'
                        : 'text-foreground-muted hover:text-foreground-intense'
                    }`}
                  >
                    {active && (
                      <m.span
                        aria-hidden
                        layoutId="top-navigation-active"
                        className="absolute inset-0 rounded-[var(--radius-md)] bg-background-muted"
                        transition={navIndicatorTransition}
                      />
                    )}
                    <span className="relative">{section.label}</span>
                  </Link>
                )
              })}
            </nav>
          </LayoutGroup>
        </div>
        <div className="flex items-center gap-2 px-6">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setSearchOpen(true)}
                    aria-label="搜索文档和脚本"
                    aria-keyshortcuts="Meta+K Control+K"
                  >
                    <Search size={16} />
                  </Button>
                }
              />
              <TooltipContent className="flex items-center gap-2">
                搜索文档和脚本
                <KbdGroup size="sm">
                  <Kbd>⌘</Kbd>
                  <Kbd>K</Kbd>
                </KbdGroup>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenu
            open={createOpen}
            onOpenChange={(open) => setCreateOpen(open)}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="新建任务、工单"
                        aria-keyshortcuts="Alt+N"
                      >
                        <Plus size={16} />
                      </Button>
                    }
                  />
                }
              />
              <TooltipContent className="flex items-center gap-2">
                新建任务、工单
                <KbdGroup size="sm">
                  <Kbd>⌥</Kbd>
                  <Kbd>N</Kbd>
                </KbdGroup>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem onClick={() => navigate('/tasks/new')}>
                <ClipboardList size={16} />
                新建任务
              </DropdownMenuItem>
              {availableTicketWorkflows.length > 0 ? (
                availableTicketWorkflows.slice(0, 5).map((workflow) => (
                  <DropdownMenuItem
                    key={workflow.id}
                    onClick={() =>
                      navigate(`/tickets/wf/${workflow.id}/new`)
                    }
                  >
                    <ClipboardList size={16} />
                    新建{workflow.name}
                  </DropdownMenuItem>
                ))
              ) : isAdmin ? (
                <DropdownMenuItem
                  onClick={() => navigate('/admin/ticket-config')}
                >
                  <ClipboardList size={16} />
                  暂无工单配置，去配置
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <Link
            to="/robots"
            aria-current={isRobotChat ? 'page' : undefined}
            className={`rounded-[var(--radius-md)] px-3 py-1.5 text-sm ${
              isRobotChat
                ? 'bg-background-muted font-medium text-foreground-intense'
                : 'text-foreground-muted hover:text-foreground-intense'
            }`}
          >
            机器人
          </Link>
          <Link
            to="/workbench"
            aria-current={isWorkbench ? 'page' : undefined}
            className={`rounded-[var(--radius-md)] px-3 py-1.5 text-sm ${
              isWorkbench
                ? 'bg-background-muted font-medium text-foreground-intense'
                : 'text-foreground-muted hover:text-foreground-intense'
            }`}
          >
            工作台
          </Link>
          <UserArea />
        </div>
      </header>
      <KnowledgeSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />

      <div className="flex h-[calc(100vh-3.5rem)]">
        {/* 普通页面：左侧导航缩短至原 20% 的 1/2（10%），右侧内容画布自适应 */}
        {!isWorkbench && !isRobotChat && sidebarSection && (
          <>
            <aside className="w-[10%] shrink-0 overflow-y-auto bg-background p-3">
              <Navigation orientation="vertical" activeLink={pathname}>
                {sidebarSection.groups ? (
                  <div className="flex flex-col gap-4">
                    {sidebarSection.groups.map((group, index) => (
                      <div key={group.label ?? index}>
                        {group.label && (
                          <p className="px-3 pb-1 text-xs font-medium text-foreground-muted">
                            {group.label}
                          </p>
                        )}
                        <SidebarNavList items={group.items} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <SidebarNavList items={sidebarSection.items} />
                )}
              </Navigation>
            </aside>

            <main className="h-full min-w-0 flex-1 p-3">
              <DetailAISlotProvider>
                <div className="flex h-full min-h-0 gap-3">
                  <div className="h-full min-w-0 flex-1 overflow-auto rounded-[var(--radius-lg)] bg-background-muted p-4 text-foreground-intense">
                    <PageTransition pageKey={pathname}>
                      <Outlet />
                    </PageTransition>
                  </div>
                  <DetailAISlotHost />
                </div>
              </DetailAISlotProvider>
            </main>
          </>
        )}

        {/* 工作台：页面自身渲染 20% 宽度任务列表 + 自适应内容画布 */}
        {isWorkbench && (
          <main className="h-full w-full min-w-0 text-foreground-intense">
            <Outlet />
          </main>
        )}

        {/* 机器人：页面自身渲染 20% 会话/全部导航 + 80% 聊天画布 */}
        {isRobotChat && (
          <main className="h-full w-full min-w-0 text-foreground-intense">
            <Outlet />
          </main>
        )}
      </div>
    </div>
  )
}
