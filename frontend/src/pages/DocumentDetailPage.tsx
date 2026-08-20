import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Editor } from '@bytemd/react'
import gfm from '@bytemd/plugin-gfm'
import zhHans from 'bytemd/locales/zh_Hans.json'
import 'bytemd/dist/index.css'
// GitHub 风格的 Markdown 排版样式（ByteMD 预览容器自带 .markdown-body 类名，正好匹配）
import 'github-markdown-css/github-markdown.css'
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
import { api, type DocumentType, type ProjectDocument } from '../lib/api'

const plugins = [gfm()]

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [doc, setDoc] = useState<ProjectDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const editorBoxRef = useRef<HTMLDivElement>(null)

  const reload = useCallback(() => {
    if (!id) return
    api
      .getDocument(Number(id))
      .then((d) => {
        setDoc(d)
        setDraft(d.content ?? '')
        setDirty(false)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  useEffect(reload, [reload])

  // 飞书文档进入后默认切到「预览」页签（ByteMD 未提供默认页签 prop，
  // 模拟点击页签走内部状态，后续重渲染不会被重置）；非飞书文档保持默认「编辑」
  useEffect(() => {
    if (!doc || doc.source !== '飞书') return
    const previewTab =
      editorBoxRef.current?.querySelectorAll('.bytemd-toolbar-tab')[1]
    if (previewTab instanceof HTMLElement) previewTab.click()
  }, [doc])

  if (error) return <p>加载失败:{error}</p>
  if (!doc) return <p>加载中…</p>

  const isFeishu = doc.source === '飞书'

  const handleSave = () => {
    setSaving(true)
    setError(null)
    api
      .updateDocumentContent(doc.id, draft)
      .then(() => setDirty(false))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  const handleResync = () => {
    if (!doc.feishuUrl || !doc.projectId) return
    setSaving(true)
    setError(null)
    api
      .importFeishuDocument({
        projectId: doc.projectId,
        type: doc.type as DocumentType,
        url: doc.feishuUrl,
      })
      .then(reload)
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 1. 文档属性信息：压缩为不超过 3 行的紧凑布局 */}
      <div className="flex flex-col gap-1.5">
        <div>
          {doc.projectId ? (
            <Link to={`/projects/${doc.projectId}`} className="text-sm">
              ← 返回项目
            </Link>
          ) : (
            <Link to="/projects" className="text-sm">
              ← 返回项目列表
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{doc.title}</h1>
          {/* Markdown 视图：后端 .md URL 规范（GET /api/documents/:id.md） */}
          <a
            href={`/api/documents/${doc.id}.md`}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
            title="Markdown 视图"
          >
            MD
          </a>
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
          {/* 文档类型放信息行最前面 */}
          <Badge variant="secondary">{doc.type}</Badge>
          <span>
            {[
              doc.description && `描述：${doc.description}`,
              doc.remark && `备注：${doc.remark}`,
              `更新于 ${new Date(doc.updatedAt).toLocaleString()}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {/* 来源标识放在信息行末尾：非飞书文档省略；飞书文档显示「来自飞书」并附原文链接 */}
          {isFeishu && (
            <>
              {' · '}
              {doc.feishuUrl ? (
                <a
                  href={doc.feishuUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  来自飞书（查看原文）
                </a>
              ) : (
                <span>来自飞书</span>
              )}
            </>
          )}
        </p>
      </div>

      {/* 2. Markdown 内容（ByteMD），用带边框的面板与标题/说明区分开；全屏用 ByteMD 工具栏自带按钮 */}
      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">内容</h2>
          <div className="flex gap-2">
            {isFeishu ? (
              <Button variant="outline" size="sm" onClick={handleResync} disabled={saving}>
                {saving ? '同步中…' : '更新同步'}
              </Button>
            ) : (
              <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
                {saving ? '保存中…' : dirty ? '保存' : '已保存'}
              </Button>
            )}
            <DeleteDocumentButton doc={doc} />
          </div>
        </div>
        <div
          ref={editorBoxRef}
          className="doc-editor min-h-0 flex-1 overflow-auto rounded-md border border-border-strong bg-background"
        >
          {/* 统一用 Editor；飞书导入的文档正文不允许本地修改：readOnly 禁用编辑、默认预览页签，内容变更走「更新同步」。
              key 保证切换文档时编辑器重新挂载，页签/只读状态不串文档 */}
          <Editor
            key={doc.id}
            mode="tab"
            value={draft}
            plugins={plugins}
            locale={zhHans}
            editorConfig={isFeishu ? { readOnly: true } : undefined}
            onChange={(v) => {
              setDraft(v)
              setDirty(true)
            }}
          />
        </div>
        {isFeishu && (
          <p className="text-sm text-foreground-muted">
            飞书导入的文档为只读，内容变更请使用「更新同步」从源拉取。
          </p>
        )}
      </section>
    </div>
  )
}

/** 删除文档（二次确认），删除后返回所属项目 */
function DeleteDocumentButton({ doc }: { doc: ProjectDocument }) {
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = () => {
    setDeleting(true)
    setError(null)
    api
      .deleteDocument(doc.id)
      .then(() =>
        navigate(doc.projectId ? `/projects/${doc.projectId}` : '/projects'),
      )
      .catch((e: Error) => setError(e.message))
      .finally(() => setDeleting(false))
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger>
        <Button variant="outline" size="sm">删除</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除文档</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除「{doc.title}」吗？删除后不可恢复。
            {error && `（删除失败：${error}）`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </AlertDialogClose>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? '删除中…' : '确认删除'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
