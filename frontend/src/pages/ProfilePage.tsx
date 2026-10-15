import { useEffect, useState } from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from '@appica/ui-react/avatar'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
} from '@appica/ui-react/alert-dialog'
import { useAuth } from '../context/AuthContext'
import { api, type Settings } from '../lib/api'

export function ProfilePage() {
  const { user } = useAuth()
  const [token, setToken] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [copied, setCopied] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    api
      .getAgentToken()
      .then(setToken)
      .catch((e: Error) => setTokenError(e.message))
    api
      .getSettings()
      .then(setSettings)
      .catch(() => {})
  }, [])

  const handleCopy = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 剪贴板不可用时忽略 */
    }
  }

  const handleReset = () => {
    setResetting(true)
    setTokenError(null)
    api
      .resetAgentToken()
      .then(setToken)
      .catch((e: Error) => setTokenError(e.message))
      .finally(() => setResetting(false))
  }

  if (!user) return null

  const apiUrl = settings?.apiUrl ?? '{接口地址}'

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">个人中心</h1>

      {/* 基本信息：头像 / 名称 / 部门 */}
      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
          <CardDescription>来自飞书登录的账号信息，只读</CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-4 px-6 pb-6 group-data-inset/card:px-4">
          <div className="flex items-center gap-4">
            <Avatar size="2xl">
              {user.avatarUrl && (
                <AvatarImage src={user.avatarUrl} alt={user.name} />
              )}
              <AvatarFallback>{user.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-lg font-semibold text-foreground-intense">
                {user.name}
              </p>
              <p className="text-sm text-foreground-muted">
                {user.department ?? '未获取部门'}
              </p>
            </div>
            <Badge variant="secondary" size="sm" className="ml-auto">
              {user.role}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">邮箱</span>
            <span className="text-sm text-foreground-muted">
              {user.email ?? '—'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">最近登录</span>
            <span className="text-sm text-foreground-muted">
              {user.lastLoginAt
                ? new Date(user.lastLoginAt).toLocaleString()
                : '—'}
            </span>
          </div>
        </div>
      </Card>

      {/* Agent 访问令牌 */}
      <Card>
        <CardHeader>
          <CardTitle>Agent 访问令牌</CardTitle>
          <CardDescription>
            AI agent 调用平台 .md 接口（/api/.../xxx.md）的鉴权令牌：请求头携带
            X-Agent-Token 或 URL 加 ?token= 参数均可；重置后旧令牌立即失效，需同步更新
            agent 侧配置
          </CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-3 px-6 pb-6 group-data-inset/card:px-4">
          {tokenError ? (
            <p className="text-sm">加载失败：{tokenError}</p>
          ) : (
            <code className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm break-all">
              {token ?? '加载中…'}
            </code>
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy} disabled={!token}>
              {copied ? '已复制' : '复制'}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger>
                <Button variant="outline" size="sm" disabled={!token}>
                  重置
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>重置 Agent 访问令牌</AlertDialogTitle>
                  <AlertDialogDescription>
                    确定重置吗？当前令牌会立即失效，所有使用该令牌的 agent
                    需更新为新令牌后才能继续访问。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogClose>
                    <Button variant="outline" size="sm">取消</Button>
                  </AlertDialogClose>
                  <AlertDialogClose>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleReset}
                      disabled={resetting}
                    >
                      {resetting ? '重置中…' : '确认重置'}
                    </Button>
                  </AlertDialogClose>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <pre className="overflow-auto rounded-[var(--radius-md)] bg-background-muted p-3 text-sm whitespace-pre-wrap">
            {`curl -H "X-Agent-Token: ${token ?? '<令牌>'}" ${apiUrl}/projects/search.md?q=项目名`}
          </pre>
        </div>
      </Card>
    </div>
  )
}
