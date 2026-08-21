import { useEffect, useState } from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import { Button } from '@appica/ui-react/button'
import { api, type Settings } from '../lib/api'

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pulling, setPulling] = useState(false)
  const [pullResult, setPullResult] = useState<string | null>(null)
  const [pullError, setPullError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((e: Error) => setError(e.message))
  }, [])

  const handlePull = () => {
    setPulling(true)
    setPullResult(null)
    setPullError(null)
    api
      .pullScripts()
      .then((r) => setPullResult(r.output))
      .catch((e: Error) => setPullError(e.message))
      .finally(() => setPulling(false))
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">设置</h1>
      {error && <p className="text-sm">加载失败：{error}</p>}

      {settings && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>脚本目录</CardTitle>
              <CardDescription>
                检查/测试脚本的根目录，来源于后端配置文件，只读
              </CardDescription>
            </CardHeader>
            <div className="flex flex-col gap-3 px-6 pb-6 group-data-inset/card:px-4">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm">
                  {settings.scriptsDir}
                </code>
                <Button onClick={handlePull} disabled={pulling}>
                  {pulling ? '更新中…' : '更新'}
                </Button>
              </div>
              {pullResult && (
                <pre className="overflow-auto rounded-[var(--radius-md)] bg-background-muted p-3 text-sm whitespace-pre-wrap">
                  {pullResult}
                </pre>
              )}
              {pullError && <p className="text-sm">更新失败：{pullError}</p>}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>访问域名</CardTitle>
              <CardDescription>平台对外访问地址，只读</CardDescription>
            </CardHeader>
            <div className="flex flex-col gap-3 px-6 pb-6 group-data-inset/card:px-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">浏览器访问</span>
                <code className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm">
                  {settings.appUrl}
                </code>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">接口访问</span>
                <code className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm">
                  {settings.apiUrl}
                </code>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
