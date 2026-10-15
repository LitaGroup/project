import { useSearchParams } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import { buttonVariants } from '@appica/ui-react/button'
import { useAuth } from '../context/AuthContext'

/**
 * 登录页：飞书 OAuth 入口（/api/auth/feishu 302 到飞书授权页，回调后端落 Cookie 后跳回首页）。
 * 回调失败经 /login?error=... 落到此页展示。
 */
export function LoginPage() {
  const [params] = useSearchParams()
  const error = params.get('error')
  const { user } = useAuth()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-muted">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登录</CardTitle>
          <CardDescription>使用飞书账号登录 AI 项目管理平台</CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-3 px-6 pb-6 group-data-inset/card:px-4">
          {error && (
            <p className="text-sm text-error-emphasis" title={error}>
              登录失败：{error}
            </p>
          )}
          {user ? (
            <p className="text-sm">
              已登录：<span className="text-foreground-intense">{user.name}</span>
              （{user.role}），可直接访问左侧导航。
            </p>
          ) : (
            <a
              href="/api/auth/feishu"
              className={buttonVariants({ variant: 'primary' })}
            >
              飞书登录
            </a>
          )}
        </div>
      </Card>
    </div>
  )
}
