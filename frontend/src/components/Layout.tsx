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
  Activity,
  Briefcase,
  Bug,
  CalendarClock,
  ChartPie,
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
  Label,
  LayoutDashboard,
  ListCheck,
  Book,
  Package,
  Robot,
  Search,
  Settings,
  TimelineEvent,
  Users,
} from '@appica/icons-react'
import type { IconComponent } from '@appica/icons-react'
import { LayoutGroup, m } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { PageTransition } from './PageTransition'
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
      !p.startsWith('/docs'),
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
    to: '/tasks',
    match: (p) => p.startsWith('/tasks'),
    items: [
      { to: '/tasks/list', label: '任务', icon: ClipboardList, ready: true },
      { to: '/tasks', label: '任务概览', icon: ChartPie, ready: true },
      { to: '/tasks/live', label: '工作概览', icon: Activity, ready: true },
      { to: '/tasks/types', label: '任务类型', icon: Label, ready: true },
      { to: '/tasks/templates', label: '任务定义', icon: Package, ready: true },
      { to: '/tasks/workers', label: '机器人', icon: Robot, ready: true },
      { to: '/tasks/executors', label: '执行器', icon: Cpu, ready: true },
    ],
  },
  {
    key: 'tickets',
    label: '工单',
    to: '/tickets/tech',
    match: (p) => p.startsWith('/tickets'),
    items: [
      {
        to: '/tickets/solution',
        label: '方案工单',
        icon: FileText,
        ready: false,
        badge: '已关闭',
      },
      { to: '/tickets/tech', label: '技术工单', icon: Settings, ready: true },
      { to: '/tickets/data', label: '数据工单', icon: ChartPie, ready: false },
      { to: '/tickets/ops', label: '运维工单', icon: Cpu, ready: false },
      { to: '/tickets/requirement', label: '需求工单', icon: ClipboardList, ready: false },
      { to: '/tickets/bug', label: 'BUG反馈', icon: Bug, ready: false },
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
    match: (p) => p.startsWith('/admin'),
    items: [
      { to: '/admin/users', label: '用户列表', icon: Users, ready: true },
      { to: '/admin/ticket-config', label: '工单配置', icon: ClipboardList, ready: true },
      { to: '/admin/repos', label: '代码仓库', icon: GitFork, ready: true },
    ],
  },
]

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
        <DropdownMenuItem onClick={() => void logout()}>退出登录</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Layout() {
  const { pathname } = useLocation()
  const [searchOpen, setSearchOpen] = useState(false)
  const activeSection =
    NAV_SECTIONS.find((s) => s.match(pathname)) ?? NAV_SECTIONS[0]

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-background-muted">
      {/* 顶部导航 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-strong bg-background px-6">
        <div className="flex items-center gap-8">
          <Link
            to="/"
            className="text-base font-semibold text-foreground-intense"
          >
            AI 项目管理平台
          </Link>
          <LayoutGroup id="top-navigation">
            <nav className="flex items-center gap-1">
              {NAV_SECTIONS.map((section) => {
                const active = section.key === activeSection.key
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
        <div className="flex items-center gap-2">
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
          <UserArea />
        </div>
      </header>
      <KnowledgeSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />

      <div className="flex flex-1">
        {/* 左侧导航 */}
        <aside className="w-52 shrink-0 border-r border-border-strong bg-background p-3">
          <Navigation orientation="vertical" activeLink={pathname}>
            <NavigationList className="gap-1">
              {activeSection.items.map((item) => (
                <NavigationItem key={item.to}>
                  <NavigationLink
                    value={item.to}
                    disabled={!item.ready}
                    render={<NavLink to={item.to} end={item.to === '/'} />}
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
          </Navigation>
        </aside>

        {/* 内容区（min-w-0：允许内容收缩，宽内容才能在面板内出现横向滚动；
            高度限定为视口减顶栏，页面可用 h-full 撑满剩余空间） */}
        <main className="h-[calc(100vh-3.5rem)] min-w-0 flex-1 overflow-auto p-6 text-foreground-intense">
          <PageTransition pageKey={pathname}>
            <Outlet />
          </PageTransition>
        </main>
      </div>
    </div>
  )
}
