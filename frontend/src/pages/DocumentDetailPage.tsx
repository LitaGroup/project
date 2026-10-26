import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import GithubSlugger from 'github-slugger'
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
import { api, documentSourceLabel, type DocumentType, type ProjectDocument } from '../lib/api'
import { parseDocHeadings } from '../lib/doc-toc'
import { prefersReducedMotion } from '../lib/motion'
import {
  splitFrontmatter,
  composeFrontmatter,
  type FrontmatterEntry,
} from '../lib/doc-frontmatter'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { ApipostDocViewer } from '../components/ApipostDocViewer'
import { DocToc } from '../components/DocToc'
import { MarkdownEditor, type MarkdownEditorHandle } from '../components/MarkdownEditor'

/** 编辑器正文标题选择器：仅取 ProseMirror 直接子级（排除引用块内的标题，与目录解析口径一致） */
const HEADING_SELECTOR = '.milkdown .ProseMirror > :is(h1, h2, h3, h4, h5, h6)'

/** 给编辑器内标题补 GitHub 风格锚点 id（幂等，供 MutationObserver 反复调用）。
    slug 直接对渲染后的 textContent 计算（与目录侧对行内剥离后文本计算的结果一致）。
    返回本轮是否产生了修改——Toc 的 scroll-spy 只在挂载时按 id 查找目标，
    标题 id 注入/重建后需要据此重挂载目录 */
function applyHeadingIds(box: HTMLElement): boolean {
  const slugger = new GithubSlugger()
  let changed = false
  for (const el of box.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) {
    const slug = slugger.slug(el.textContent ?? '')
    if (!slug) continue
    if (el.id !== slug) {
      el.id = slug
      changed = true
    }
  }
  return changed
}

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [doc, setDoc] = useState<ProjectDocument | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 正文（不含 frontmatter：所见即所得编辑器不识别 YAML，元信息单独以表格展示） */
  const [draft, setDraft] = useState('')
  const [meta, setMeta] = useState<FrontmatterEntry[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const editorBoxRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  // 正文标题目录（随编辑实时更新）；锚点注入轮次——Toc 组件据此（重）挂载以观察到已注入 id 的标题
  const headings = useMemo(() => parseDocHeadings(draft), [draft])
  const [anchorEpoch, setAnchorEpoch] = useState(0)
  const isFeishu = doc?.source === '飞书'
  const isApipost = doc?.source === 'apipost'
  const isExternal = isFeishu || isApipost

  const reload = useCallback(() => {
    if (!id) return
    api
      .getDocument(Number(id))
      .then((d) => {
        const { entries, body } = splitFrontmatter(d.content ?? '')
        setDoc(d)
        setMeta(entries)
        setDraft(body)
        setDirty(false)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  useEffect(reload, [reload])

  // 面包屑的项目层级
  useEffect(() => {
    if (!doc?.projectId) return
    api
      .getProject(doc.projectId)
      .then((p) => setProjectName(p.name))
      .catch(() => setProjectName(null))
  }, [doc?.projectId])

  // 滚动到指定标题（编辑器内容渲染需要时间，短暂重试）
  const scrollToHeading = useCallback((slug: string) => {
    const box = editorBoxRef.current
    if (!box || !slug) return
    let attempts = 0
    const tryScroll = () => {
      attempts += 1
      const target = Array.from(
        box.querySelectorAll<HTMLElement>(HEADING_SELECTOR),
      ).find((el) => el.id === slug)
      if (target) {
        target.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'start',
        })
        return
      }
      if (attempts < 20) window.setTimeout(tryScroll, 120)
    }
    tryScroll()
  }, [])

  // 目录点击：更新地址栏锚点并滚动
  const handleTocSelect = useCallback(
    (slug: string) => {
      window.history.replaceState(null, '', `#${encodeURIComponent(slug)}`)
      scrollToHeading(slug)
    },
    [scrollToHeading],
  )

  // URL 带 #锚点 进入时滚动到对应标题（如 /documents/98#2-进度刷新消息box_bless_refresh）
  useEffect(() => {
    if (!doc || isApipost) return
    const raw = window.location.hash.replace(/^#/, '')
    if (!raw) return
    try {
      scrollToHeading(decodeURIComponent(raw))
    } catch {
      scrollToHeading(raw)
    }
  }, [doc, isApipost, scrollToHeading])

  // 编辑器 DOM 后处理：Milkdown 未给标题加 id，用 MutationObserver 在重渲染后补 id；
  // 有改动时递增 anchorEpoch 让右侧 Toc 重挂载（Toc 只在挂载时按 id 查找观察目标）
  useEffect(() => {
    if (!doc || isApipost) return
    const box = editorBoxRef.current
    if (!box) return

    let applyRaf = 0
    const applyAnchors = () => {
      applyRaf = 0
      if (applyHeadingIds(box)) setAnchorEpoch((epoch) => epoch + 1)
    }
    const scheduleApply = () => {
      if (!applyRaf) applyRaf = requestAnimationFrame(applyAnchors)
    }

    const observer = new MutationObserver(scheduleApply)
    observer.observe(box, { childList: true, subtree: true, characterData: true })
    applyAnchors()
    return () => {
      observer.disconnect()
      if (applyRaf) cancelAnimationFrame(applyRaf)
    }
  }, [doc, isApipost])

  if (error) return <p>加载失败:{error}</p>
  if (!doc) return <p>加载中…</p>

  const handleSave = () => {
    setSaving(true)
    setError(null)
    // 取编辑器当前内容：onChange 有 200ms 防抖，避免刚输入就保存丢字
    const body = editorRef.current?.getMarkdown() ?? draft
    api
      .updateDocumentContent(doc.id, composeFrontmatter(meta, body))
      .then(() => {
        setDraft(body)
        setDirty(false)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  const handleResync = () => {
    if (!doc.projectId) return
    setSaving(true)
    setError(null)
    const call = isApipost
      ? doc.apipostUrl
        ? api.importApipostDocument({ projectId: doc.projectId, url: doc.apipostUrl })
        : null
      : doc.feishuUrl
        ? api.importFeishuDocument({
            projectId: doc.projectId,
            type: doc.type as DocumentType,
            url: doc.feishuUrl,
          })
        : null
    if (!call) {
      setSaving(false)
      return
    }
    call
      .then(reload)
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 1. 文档属性信息：压缩为不超过 3 行的紧凑布局 */}
      <div className="flex flex-col gap-1.5">
        <PageBreadcrumb
          items={[
            { label: '文档', to: '/documents' },
            ...(doc.projectId
              ? [
                  {
                    label: projectName ?? '…',
                    to: `/projects/${doc.projectId}`,
                  },
                ]
              : []),
            { label: doc.title },
          ]}
        />
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
          {/* 来源标识放在信息行末尾：本地文档省略；外部导入显示「来自 xx」并附原文链接 */}
          {isExternal && (
            <>
              {' · '}
              {(isApipost ? doc.apipostUrl : doc.feishuUrl) ? (
                <a
                  href={isApipost ? doc.apipostUrl! : doc.feishuUrl!}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  来自{isApipost ? documentSourceLabel(doc.source) : '飞书'}（查看原文）
                </a>
              ) : (
                <span>来自{isApipost ? documentSourceLabel(doc.source) : '飞书'}</span>
              )}
            </>
          )}
        </p>
      </div>

      {/* 2. 内容区：apipost 文档为结构化接口视图；其余为 Markdown（Milkdown Crepe） */}
      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">内容</h2>
          <div className="flex gap-2">
            {isExternal ? (
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
        {isApipost ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col">
              <ApipostDocViewer content={doc.content} docsUrl={doc.apipostUrl ?? null} />
            </div>
            <p className="text-sm text-foreground-muted">
              APIPOST 导入的接口文档为只读，内容变更请使用「更新同步」从源拉取。
            </p>
          </>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 gap-4">
              <div
                ref={editorBoxRef}
                className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border-strong bg-background"
              >
                {meta.length > 0 && (
                  <div className="shrink-0 border-b border-border-strong bg-background-muted px-4 py-2">
                    <table className="border-collapse text-xs">
                      <tbody>
                        {meta.map((entry) => (
                          <tr key={entry.key}>
                            <td className="border border-border-strong px-2 py-0.5 text-foreground-muted">
                              {entry.key}
                            </td>
                            <td className="border border-border-strong px-2 py-0.5">
                              {entry.value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-auto">
                  {/* 统一用 MarkdownEditor；飞书导入的文档正文不允许本地修改：readOnly 只读展示，
                      内容变更走「更新同步」。key 保证切换文档（或重新同步后）内容重新载入 */}
                  <MarkdownEditor
                    key={`${doc.id}:${doc.updatedAt}`}
                    ref={editorRef}
                    value={draft}
                    readOnly={isFeishu}
                    onChange={(markdown) => {
                      setDraft(markdown)
                      setDirty(true)
                    }}
                  />
                </div>
              </div>
              {/* 右侧标题目录：组件库 Toc（scroll-spy 高亮），锚点注入完成后挂载并随改动重挂载 */}
              {anchorEpoch > 0 && (
                <DocToc key={anchorEpoch} items={headings} onSelect={handleTocSelect} />
              )}
            </div>
            {isFeishu && (
              <p className="text-sm text-foreground-muted">
                飞书导入的文档为只读，内容变更请使用「更新同步」从源拉取。
              </p>
            )}
          </>
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
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>删除</AlertDialogTrigger>
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
