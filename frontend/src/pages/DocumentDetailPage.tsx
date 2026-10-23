import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import GithubSlugger from 'github-slugger'
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
import { api, documentSourceLabel, type DocumentType, type ProjectDocument } from '../lib/api'
import { parseDocHeadings } from '../lib/doc-toc'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { ApipostDocViewer } from '../components/ApipostDocViewer'
import { DocToc } from '../components/DocToc'

const plugins = [gfm()]

/** 预览区标题选择器：仅取 markdown-body 直接子级（排除引用块内的标题，与目录解析口径一致） */
const HEADING_SELECTOR = '.markdown-body > :is(h1, h2, h3, h4, h5, h6)'

/** 给预览区标题补 GitHub 风格锚点 id 与悬停 # 链接（幂等，供 MutationObserver 反复调用）。
    slug 直接对渲染后的 textContent 计算（与目录侧对行内剥离后文本计算的结果一致）。
    返回本轮是否产生了修改（设置了 id 或新增锚点）——Toc 的 scroll-spy 只在挂载时按
    id 查找目标，标题 id 注入/重建后需要据此重挂载目录 */
function applyHeadingAnchors(box: HTMLElement, onAnchorClick: (slug: string) => void): boolean {
  const preview = box.querySelector<HTMLElement>('.bytemd-preview')
  if (!preview) return false
  const slugger = new GithubSlugger()
  let changed = false
  for (const el of preview.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) {
    const slug = slugger.slug(el.textContent ?? '')
    if (!slug) continue
    if (el.id !== slug) {
      el.id = slug
      changed = true
    }
    if (el.querySelector('.doc-heading-anchor')) continue
    const anchor = document.createElement('a')
    anchor.className = 'doc-heading-anchor'
    anchor.href = `#${encodeURIComponent(slug)}`
    anchor.textContent = '#'
    anchor.title = '复制标题链接'
    anchor.addEventListener('click', (event) => {
      event.preventDefault()
      onAnchorClick(slug)
    })
    el.appendChild(anchor)
    changed = true
  }
  return changed
}

/** YAML 风格键值行（key: value），用于识别 frontmatter 内容 */
const YAML_KV_RE = /^[A-Za-z0-9_-]+\s*:/

/** 把预览区开头的 YAML frontmatter 替换为键值卡片（幂等，供 MutationObserver 反复调用）。
    ByteMD 按 CommonMark 渲染、不识别 frontmatter：正文开头的 `---` 变分隔线，
    键值段落被结尾的 `---` 变成 setext 大标题，键值全挤在一行里，观感凌乱。
    这里在 DOM 层识别「首个元素为分隔线、其后是纯键值行的标题/段落」结构，重建为键值卡片。 */
function applyFrontmatterCard(box: HTMLElement): boolean {
  const body = box.querySelector<HTMLElement>('.bytemd-preview .markdown-body')
  if (!body) return false
  const first = body.firstElementChild
  const second = first?.nextElementSibling
  if (!first || first.tagName !== 'HR' || !second) return false
  if (!/^H[1-6]$/.test(second.tagName) && second.tagName !== 'P') return false
  // 键值行前若空行隔开，结尾 --- 是独立分隔线（标题/段落两种宿主都可能）
  if (second.tagName === 'P' && second.nextElementSibling?.tagName === 'HR') {
    second.nextElementSibling.remove()
  }
  // 克隆取文本：标题可能已被锚点逻辑注入 <a class="doc-heading-anchor">，需剔除
  const clone = second.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.doc-heading-anchor').forEach((el) => el.remove())
  const lines = (clone.textContent ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0 || !lines.every((line) => YAML_KV_RE.test(line))) return false

  const card = document.createElement('div')
  card.className = 'doc-frontmatter'
  for (const line of lines) {
    const i = line.indexOf(':')
    const row = document.createElement('div')
    row.className = 'doc-frontmatter-row'
    const key = document.createElement('span')
    key.className = 'doc-frontmatter-key'
    key.textContent = line.slice(0, i + 1)
    const val = document.createElement('span')
    val.className = 'doc-frontmatter-value'
    // 值去掉 YAML 对称包裹引号（仅一层），展示更干净
    val.textContent = line
      .slice(i + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1')
    row.append(key, val)
    card.append(row)
  }
  second.replaceWith(card)
  first.remove()
  return true
}

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [doc, setDoc] = useState<ProjectDocument | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const editorBoxRef = useRef<HTMLDivElement>(null)
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
        setDoc(d)
        setDraft(d.content ?? '')
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

  // 所有文档进入后默认切到「预览」页签（ByteMD 未提供默认页签 prop，
  // 模拟点击页签走内部状态，后续重渲染不会被重置）
  useEffect(() => {
    if (!doc || isApipost) return
    const previewTab =
      editorBoxRef.current?.querySelectorAll('.bytemd-toolbar-tab')[1]
    if (previewTab instanceof HTMLElement) previewTab.click()
  }, [doc, isApipost])

  // 滚动到指定标题：预览页签未显示时先切到预览，再轮询等渲染完成后平滑滚动
  const scrollToHeading = useCallback((slug: string) => {
    const box = editorBoxRef.current
    if (!box || !slug) return
    const preview = box.querySelector<HTMLElement>('.bytemd-preview')
    if (!preview || preview.offsetParent === null) {
      const previewTab = box.querySelectorAll('.bytemd-toolbar-tab')[1]
      if (previewTab instanceof HTMLElement) previewTab.click()
    }
    let attempts = 0
    const tryScroll = () => {
      attempts += 1
      const target = Array.from(
        box.querySelectorAll<HTMLElement>(HEADING_SELECTOR),
      ).find((el) => el.id === slug)
      if (target && target.offsetParent !== null) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      // 预览尚未渲染出锚点（切页签/长文档渲染需要时间），短暂重试
      if (attempts < 20) window.setTimeout(tryScroll, 120)
    }
    tryScroll()
  }, [])

  // 标题悬停 # 链接点击：地址栏带上锚点（replaceState 不产生历史记录）+ 复制完整链接 + 滚动定位
  const handleAnchorClick = useCallback(
    (slug: string) => {
      window.history.replaceState(null, '', `#${encodeURIComponent(slug)}`)
      const url = `${window.location.origin}${window.location.pathname}#${encodeURIComponent(slug)}`
      void navigator.clipboard?.writeText(url).catch(() => {})
      scrollToHeading(slug)
    },
    [scrollToHeading],
  )

  // 目录点击：与锚点一致更新地址栏并滚动（不复制）
  const handleTocSelect = useCallback(
    (slug: string) => {
      window.history.replaceState(null, '', `#${encodeURIComponent(slug)}`)
      scrollToHeading(slug)
    },
    [scrollToHeading],
  )

  // URL 带 #锚点 进入时，默认预览后滚动到对应标题（如 /documents/98#2-进度刷新消息box_bless_refresh）
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

  // 预览区 DOM 后处理：ByteMD 未暴露渲染钩子，用 MutationObserver 在预览重渲染后
  // 先把开头 frontmatter 换成键值卡片、再补标题 id 与 # 链接；
  // 有改动时递增 anchorEpoch 让右侧 Toc 重挂载（Toc 只在挂载时按 id 查找观察目标）
  useEffect(() => {
    if (!doc || isApipost) return
    const box = editorBoxRef.current
    if (!box) return

    let applyRaf = 0
    const applyAnchors = () => {
      applyRaf = 0
      // frontmatter 先于锚点：其键值"伪标题"不应被注入 # 链接（马上会被卡片整体替换）
      const fmChanged = applyFrontmatterCard(box)
      if (applyHeadingAnchors(box, handleAnchorClick) || fmChanged) {
        setAnchorEpoch((epoch) => epoch + 1)
      }
    }
    const scheduleApply = () => {
      if (!applyRaf) applyRaf = requestAnimationFrame(applyAnchors)
    }

    const observer = new MutationObserver(scheduleApply)
    observer.observe(box, { childList: true, subtree: true })
    applyAnchors()
    return () => {
      observer.disconnect()
      if (applyRaf) cancelAnimationFrame(applyRaf)
    }
  }, [doc, isApipost, handleAnchorClick])

  if (error) return <p>加载失败:{error}</p>
  if (!doc) return <p>加载中…</p>

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

      {/* 2. 内容区：apipost 文档为结构化接口视图；其余为 Markdown（ByteMD） */}
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
                className="doc-editor min-h-0 flex-1 overflow-auto rounded-md border border-border-strong bg-background"
              >
                {/* 统一用 Editor；飞书导入的文档正文不允许本地修改：readOnly 禁用编辑，内容变更走「更新同步」。
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
