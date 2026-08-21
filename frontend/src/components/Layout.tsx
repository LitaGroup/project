import { Outlet, Link, NavLink, useLocation } from 'react-router-dom'
import {
  Navigation,
  NavigationList,
  NavigationItem,
} from '@appica/ui-react/navigation'
import { NavigationLink } from '@appica/ui-react/navigation'
import { Badge } from '@appica/ui-react/badge'

/** 导航项；"待补充"模块仅占位（缺陷后续实现），不实现 */
const navItems = [
  { to: '/', label: '概览', ready: true },
  { to: '/projects', label: '项目', ready: true },
  { to: '/tests', label: '用例', ready: true },
  { to: '/checks', label: '检查', ready: true },
  { to: '/defects', label: '缺陷', ready: false },
  { to: '/documents', label: '文档', ready: true },
  { to: '/scripts', label: '脚本', ready: true },
  { to: '/tasks', label: '任务', ready: true },
  { to: '/settings', label: '设置', ready: true },
]

export function Layout() {
  const { pathname } = useLocation()
  return (
    <div className="flex min-h-screen flex-col bg-background-muted">
      {/* 顶部导航 */}
      <header className="flex h-14 shrink-0 items-center border-b border-border-strong bg-background px-6">
        <Link to="/" className="text-base font-semibold text-foreground-intense">
          AI 项目管理平台
        </Link>
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
                      {!item.ready && <Badge variant="light">待补充</Badge>}
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
