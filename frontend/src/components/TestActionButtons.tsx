import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { Button } from '@appica/ui-react/button'
import { api, type ProjectTest } from '../lib/api'

/** 自动导入测试：扫描项目脚本目录下全部 .test.ts，过滤已登记的全部导入 */
export function ImportTestsButton({
  projectId,
  scriptsPath,
  onImported,
}: {
  projectId: number
  scriptsPath: string | null
  onImported: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const run = () => {
    if (!scriptsPath) {
      setMessage('请先在项目详情页设置项目的脚本目录，再执行自动导入')
      return
    }
    setLoading(true)
    setMessage(null)
    api
      .importTests(projectId)
      .then((r) => {
        setMessage(`已导入 ${r.created.length} 个，跳过 ${r.skipped} 个`)
        onImported()
      })
      .catch((e: Error) => setMessage(`导入失败:${e.message}`))
      .finally(() => setLoading(false))
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={run}
        disabled={loading}
        title="扫描脚本目录下的 .test.ts，未登记的全部导入（编号按文件名生成，描述待补充）"
      >
        {loading ? '导入中…' : '自动导入'}
      </Button>
      {message && <span className="text-sm text-foreground-muted">{message}</span>}
    </>
  )
}

/** 运行测试脚本：启动一次运行并跳转到运行详情页（实时进度/历史记录） */
export function RunTestButton({
  test,
  projectId,
}: {
  test: ProjectTest
  projectId: number
}) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = () => {
    setLoading(true)
    setError(null)
    api
      .startTestRun(test.id)
      .then(() => navigate(`/projects/${projectId}/tests/${test.id}`))
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={run}
      disabled={loading}
      title={error ?? '启动一次脚本运行'}
    >
      {loading ? '启动中…' : '运行'}
    </Button>
  )
}

export function DeleteTestButton({
  test,
  onDeleted,
}: {
  test: ProjectTest
  onDeleted: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger>
        <Button variant="outline" size="sm">
          删除
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除测试</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除测试「{test.code}」吗？只删除登记信息，不影响脚本文件本身。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </AlertDialogClose>
          <AlertDialogClose>
            <Button variant="destructive" onClick={onDeleted}>
              确认删除
            </Button>
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
