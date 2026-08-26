import { useEffect, useState } from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { api, type Settings } from '../lib/api'

/** 键值行：左侧标签，右侧值（code 样式） */
function SettingRow({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm">{label}</span>
      <code
        className="max-w-[60%] truncate rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm"
        title={hint ?? value}
      >
        {value}
      </code>
    </div>
  )
}

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
                检查 / 测试脚本的根目录，来源于后端配置（CHECK_SCRIPTS_DIR），只读
              </CardDescription>
            </CardHeader>
            <div className="flex flex-col gap-3 px-6 pb-6 group-data-inset/card:px-4">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm">
                  {settings.scriptsDir}
                </code>
                <Button onClick={handlePull} disabled={pulling}>
                  {pulling ? '更新中…' : 'git pull'}
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
              <CardTitle>运行环境与访问域名</CardTitle>
              <CardDescription>
                服务端口、环境与对外访问地址，均来源于后端配置，只读
              </CardDescription>
            </CardHeader>
            <div className="flex flex-col gap-3 px-6 pb-6 group-data-inset/card:px-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">运行环境</span>
                <Badge variant="secondary">{settings.environment}</Badge>
              </div>
              <SettingRow label="服务端口" value={String(settings.port)} />
              <SettingRow
                label="浏览器访问"
                value={settings.appUrl}
                hint="APP_URL"
              />
              <SettingRow
                label="接口访问"
                value={settings.apiUrl}
                hint="API_URL"
              />
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Appium Agent</CardTitle>
              <CardDescription>
                APP 测试执行机的连接信息，实时来自 agent 上报，只读
              </CardDescription>
            </CardHeader>
            <div className="flex flex-col gap-3 px-6 pb-6 group-data-inset/card:px-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">连接状态</span>
                <Badge variant={settings.agent.online ? 'success' : 'light'}>
                  {settings.agent.online ? '在线' : '离线'}
                </Badge>
              </div>
              <SettingRow
                label="执行机"
                value={settings.agent.name ?? '—'}
              />
              <SettingRow
                label="Appium 内网地址"
                value={settings.agent.appiumUrl ?? '—'}
                hint="agent 本机 appium server 的内网地址，局域网内可直接访问"
              />
            </div>
          </Card>


          <Card>
            <CardHeader>
              <CardTitle>图片与飞书集成</CardTitle>
              <CardDescription>
                图片静态目录与飞书相关配置（不暴露密钥），只读
              </CardDescription>
            </CardHeader>
            <div className="flex flex-col gap-3 px-6 pb-6 group-data-inset/card:px-4">
              <SettingRow
                label="图片根目录"
                value={settings.imageWebroot}
                hint="DIR_IMAGE_WEBROOT，经 /images/{path} 访问"
              />
              <SettingRow
                label="Lita API 地址"
                value={settings.litaApiHost}
                hint="LITA_API_HOST，飞书 token 服务"
              />
              <SettingRow
                label="项目同步源"
                value={settings.feishuProjectSourceUrl}
                hint="FEISHU_PROJECT_SOURCE_URL（未配置用内置默认）"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">飞书 token 来源</span>
                <Badge variant={settings.feishuTokenSource === 'lita' ? 'primary' : 'light'}>
                  {settings.feishuTokenSource === 'lita'
                    ? 'Lita 平台（推荐）'
                    : '自建应用凭据（兜底）'}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">兜底通知 webhook</span>
                <Badge variant={settings.feishuWebhookConfigured ? 'success' : 'light'}>
                  {settings.feishuWebhookConfigured ? '已配置' : '未配置'}
                </Badge>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
