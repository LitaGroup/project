import { Outlet, Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Navigation,
  NavigationList,
  NavigationItem,
} from '@appica/ui-react/navigation'
import { NavigationLink } from '@appica/ui-react/navigation'
import { Badge } from '@appica/ui-react/badge'
import { Button, buttonVariants } from '@appica/ui-react/button'
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
import { useAuth } from '../context/AuthContext'

/** 导航项 */
const navItems = [
  { to: '/', label: '概览', ready: true },
  { to: '/projects', label: '项目', ready: true },
  { to: '/tests', label: '用例', ready: true },
  { to: '/checks', label: '检查', ready: true },
  { to: '/exports', label: '导出', ready: true },
  { to: '/defects', label: '缺陷', ready: true },
  { to: '/documents', label: '文档', ready: true },
  { to: '/resources', label: '资源', ready: true },
  { to: '/milestones', label: '节点', ready: true },
  { to: '/commits', label: '提交', ready: true },
  { to: '/scripts', label: '脚本', ready: true },
  { to: '/tasks', label: '任务', ready: true },
  { to: '/apps', label: 'APP', ready: true },
  { to: '/settings', label: '设置', ready: true },
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
  return (
    <div className="flex min-h-screen flex-col bg-background-muted">
      {/* 顶部导航 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-strong bg-background px-6">
        <Link to="/" className="text-base font-semibold text-foreground-intense">
          AI 项目管理平台
        </Link>
        <UserArea />
      </header>

      <div className="flex flex-1">
        {/* 左侧导航 */}
        <aside className="w-52 shrink-0 border-r border-border-strong bg-background p-3">
          <Navigation orientation="vertical" activeLink={pathname}>
            <NavigationList className="gap-1">
              {navItems.map((item) => (
                <NavigationItem key={item.to}>
                  <NavigationLink
                    value={item.to}
                    disabled={!item.ready}
                    render={<NavLink to={item.to} end={item.to === '/'} />}
                  >
                    <span className="flex w-full items-center justify-between">
                      {item.label}
                      {!item.ready && <Badge variant="soft">待补充</Badge>}
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
          <Outlet />
        </main>
      </div>
    </div>
  )
}
