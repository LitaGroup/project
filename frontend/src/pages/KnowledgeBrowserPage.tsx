import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
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
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@appica/ui-react/dialog'
import { Input } from '@appica/ui-react/input'
import { Textarea } from '@appica/ui-react/textarea'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { Book, Folder } from '@appica/icons-react'
import {
  api,
  knowledgeMdPath,
  knowledgeWebPath,
  type KnowledgeDirectory,
  type KnowledgeNode,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { MarkdownEditor, type MarkdownEditorHandle } from '../components/MarkdownEditor'

interface KnowledgeLocation {
  path: string
  directory: boolean
}

/** 从 /docs/detail/... 解析路径；逐段解码并拒绝编码斜杠 */
function parseLocation(pathname: string): KnowledgeLocation {
  if (!pathname.startsWith('/docs/detail')) {
    return { path: '/', directory: true }
  }
  let suffix = pathname.slice('/docs/detail'.length)
  if (!suffix.startsWith('/')) return { path: '/', directory: true }
  const directory = suffix.endsWith('/')
  suffix = suffix.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!suffix) return { path: '/', directory: true }
  const segments = suffix.split('/').map((segment) => {
    const decoded = decodeURIComponent(segment)
    if (decoded.includes('/') || decoded.includes('\\')) {
      throw new Error('非法知识路径')
    }
    return decoded
  })
  return { path: `/${segments.join('/')}`, directory }
}

/** 知识板块：路径即目录/文章，目录必须带结尾 / */
export function KnowledgeBrowserPage() {
  const { pathname } = useLocation()
  const location = useMemo(() => parseLocation(pathname), [pathname])
  const [directory, setDirectory] = useState<KnowledgeDirectory | null>(null)
  const [article, setArticle] = useState<KnowledgeNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    setDirectory(null)
    setArticle(null)
    const call = location.directory
      ? api.getKnowledgeDirectory(location.path)
      : api.getKnowledgeArticle(location.path)
    call
      .then((data) => {
        if (location.directory) setDirectory(data as KnowledgeDirectory)
        else setArticle(data as KnowledgeNode)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [location.directory, location.path])

  useEffect(() => {
    // 数据加载需要先切到加载态；请求完成后由 Promise 更新内容
    // oxlint-disable-next-line react/set-state-in-effect
    reload()
  }, [reload])

  const crumbs = useMemo(() => {
    const items: Array<{ label: string; to: string }> = [
      { label: '知识', to: knowledgeWebPath('/', true) },
    ]
    const segments = location.path.split('/').filter(Boolean)
    let current = ''
    segments.forEach((segment, index) => {
      current += `/${segment}`
      const isLast = index === segments.length - 1
      items.push({
        label: segment,
        to:
          isLast && !location.directory
            ? knowledgeWebPath(current, false)
            : knowledgeWebPath(current, true),
      })
    })
    return items
  }, [location.directory, location.path])

  if (loading) return <p>加载中…</p>
  if (error) {
    return (
      <div>
        <PageBreadcrumb items={crumbs} />
        <h1 className="mt-3 text-2xl font-semibold">知识</h1>
        <p className="mt-4 text-sm">
          {error.includes('未配置') || error.includes('初始化失败')
            ? '知识库尚未配置或暂不可用'
            : '加载失败'}
          ：{error}
        </p>
      </div>
    )
  }
  if (article) {
    return (
      <KnowledgeArticleView
        key={`${article.id}:${article.updatedAt}`}
        article={article}
        crumbs={crumbs}
        onChanged={reload}
      />
    )
  }
  if (!directory) return <p>加载失败：未知知识节点</p>

  return (
    <KnowledgeDirectoryView
      directory={directory}
      crumbs={crumbs}
      onChanged={reload}
    />
  )
}

function KnowledgeDirectoryView({
  directory,
  crumbs,
  onChanged,
}: {
  directory: KnowledgeDirectory
  crumbs: Array<{ label: string; to: string }>
  onChanged: () => void
}) {
  const total = directory.directories.length + directory.articles.length
  return (
    <div className="flex h-full min-h-0 gap-5">
      <aside className="w-56 shrink-0 border-r border-border-strong pr-4">
        <Link
          to={knowledgeWebPath('/', true)}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-foreground-intense hover:bg-background-muted"
        >
          <Book size={17} />
          知识库
        </Link>
        <p className="mt-4 mb-1 px-2 text-xs text-foreground-muted">当前目录</p>
        <div className="flex flex-col gap-0.5">
          {directory.directories.map((node) => (
            <Link
              key={node.id}
              to={knowledgeWebPath(node.path, true)}
              className="flex items-center gap-2 truncate rounded-md px-2 py-1.5 text-sm text-foreground-muted hover:bg-background-muted hover:text-foreground-intense"
              title={node.path}
            >
              <Folder size={15} className="shrink-0" />
              <span className="truncate">{node.name}</span>
            </Link>
          ))}
          {directory.directories.length === 0 && (
            <span className="px-2 text-xs text-foreground-muted">暂无子目录</span>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <PageBreadcrumb items={crumbs} />
        <div className="mt-3 mb-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">
              {directory.path === '/' ? '知识库' : directory.title}
            </h1>
            <p className="mt-1 font-mono text-xs text-foreground-muted">
              {directory.path === '/' ? '/' : `${directory.path}/`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CreateKnowledgeDialog
              kind="directory"
              parentPath={directory.path}
              onSaved={onChanged}
            />
            <CreateKnowledgeDialog
              kind="article"
              parentPath={directory.path}
              onSaved={onChanged}
            />
          </div>
        </div>

        <Table hoverableRows>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead className="w-24 text-center">类型</TableHead>
              <TableHead className="w-40">更新时间</TableHead>
              <TableHead className="w-28 text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {directory.directories.map((node) => (
              <TableRow key={node.id}>
                <TableCell>
                  <Link
                    to={knowledgeWebPath(node.path, true)}
                    className="flex items-center gap-2 text-foreground-intense underline"
                  >
                    <Folder size={16} />
                    {node.title}/
                  </Link>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary">目录</Badge>
                </TableCell>
                <TableCell>
                  {new Date(node.updatedAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-center">
                  <DeleteKnowledgeButton node={node} onDeleted={onChanged} />
                </TableCell>
              </TableRow>
            ))}
            {directory.articles.map((node) => (
              <TableRow key={node.id}>
                <TableCell>
                  <Link
                    to={knowledgeWebPath(node.path, false)}
                    className="text-foreground-intense underline"
                  >
                    {node.title}
                  </Link>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="soft">
                    {node.source === 'native' ? '知识' : '项目文档'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {new Date(node.updatedAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-center">
                  {node.source === 'native' ? (
                    <DeleteKnowledgeButton node={node} onDeleted={onChanged} />
                  ) : (
                    <span className="text-xs text-foreground-muted">系统同步</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {total === 0 && (
              <TableRow>
                <TableCell colSpan={4}>
                  当前目录为空。可新建文章或子目录；项目文档同步后会出现在 /project
                  下。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function KnowledgeArticleView({
  article,
  crumbs,
  onChanged,
}: {
  article: KnowledgeNode
  crumbs: Array<{ label: string; to: string }>
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(article.title)
  const [content, setContent] = useState(article.content ?? '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const editable = article.source === 'native'

  const save = () => {
    setSaving(true)
    setError(null)
    const markdown = editorRef.current?.getMarkdown() ?? content
    api
      .updateKnowledgeNode(article.id, { title: title.trim(), content: markdown })
      .then(() => {
        setDirty(false)
        onChanged()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageBreadcrumb items={crumbs} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {editable ? (
            <Input
              className="h-auto border-0 px-0 text-2xl font-semibold shadow-none"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setDirty(true)
              }}
              aria-label="文章标题"
            />
          ) : (
            <h1 className="text-2xl font-semibold">{article.title}</h1>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-foreground-muted">
            <span>{article.path}</span>
            <Badge variant={editable ? 'soft' : 'secondary'}>
              {editable ? '知识文章' : '项目文档同步'}
            </Badge>
            <span>更新于 {new Date(article.updatedAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={knowledgeMdPath(article.path, false)}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
          >
            MD
          </a>
          {article.source === 'project-document' && article.sourceDocumentId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/documents/${article.sourceDocumentId}`)}
            >
              查看原文档
            </Button>
          )}
          {editable && (
            <>
              <MoveKnowledgeDialog
                node={article}
                onMoved={(moved) =>
                  navigate(knowledgeWebPath(moved.path, false))
                }
              />
              <DeleteKnowledgeButton node={article} onDeleted={() => navigate(knowledgeWebPath(article.parentPath, true))} />
              <Button size="sm" onClick={save} disabled={!dirty || saving}>
                {saving ? '保存中…' : dirty ? '保存' : '已保存'}
              </Button>
            </>
          )}
        </div>
      </div>
      {error && <p className="text-sm">保存失败：{error}</p>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border-strong bg-background">
        {/* 正文超出一屏时在面板内滚动：外层 overflow-hidden 只负责圆角裁剪 */}
        <div className="min-h-0 flex-1 overflow-auto">
          <MarkdownEditor
            key={`${article.id}:${article.updatedAt}`}
            ref={editorRef}
            value={content}
            readOnly={!editable}
            onChange={(markdown) => {
              setContent(markdown)
              setDirty(true)
            }}
          />
        </div>
      </div>
      {!editable && (
        <p className="text-sm text-foreground-muted">
          项目文档正文由文档模块同步，请在原文档中修改；此处只读并参与知识检索。
        </p>
      )}
    </div>
  )
}

function CreateKnowledgeDialog({
  kind,
  parentPath,
  onSaved,
}: {
  kind: 'directory' | 'article'
  parentPath: string
  onSaved: () => void
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isArticle = kind === 'article'

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setName('')
      setTitle('')
      setContent('')
      setError(null)
    }
  }

  const submit = () => {
    setError(null)
    api
      .createKnowledgeNode({
        kind,
        parentPath,
        name: name.trim(),
        title: isArticle ? title.trim() || name.trim() : undefined,
        content: isArticle ? content : undefined,
      })
      .then((node) => {
        setOpen(false)
        onSaved()
        navigate(knowledgeWebPath(node.path, !isArticle))
      })
      .catch((e: Error) => setError(e.message))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        {isArticle ? '新建文章' : '新建目录'}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isArticle ? '新建知识文章' : '新建目录'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              路径名（一个 URL 路径段，不能包含 /）
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isArticle ? 'deploy-guide' : 'guides'}
              />
            </label>
            {isArticle && (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  标题（不填取路径名）
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="部署指引"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  正文（Markdown，创建后可继续编辑）
                  <Textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={8}
                    placeholder="# 标题&#10;&#10;正文…"
                  />
                </label>
              </>
            )}
            <p className="text-xs text-foreground-muted">
              将创建在：{parentPath === '/' ? '/' : `${parentPath}/`}
              {name || '…'}
              {!isArticle && '/'}
            </p>
            {error && <p className="text-sm">创建失败：{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={!name.trim()}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MoveKnowledgeDialog({
  node,
  onMoved,
}: {
  node: KnowledgeNode
  onMoved: (node: KnowledgeNode) => void
}) {
  const [open, setOpen] = useState(false)
  const [parentPath, setParentPath] = useState(node.parentPath)
  const [name, setName] = useState(node.name)
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setParentPath(node.parentPath)
      setName(node.name)
      setError(null)
    }
  }
  const submit = () => {
    api
      .updateKnowledgeNode(node.id, { parentPath, name: name.trim() })
      .then((moved) => {
        setOpen(false)
        onMoved(moved)
      })
      .catch((e: Error) => setError(e.message))
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        移动
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>移动 / 重命名</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              父目录绝对路径
              <Input
                value={parentPath}
                onChange={(e) => setParentPath(e.target.value)}
                placeholder="/guides"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              名称
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <p className="font-mono text-xs text-foreground-muted">
              目标：{parentPath === '/' ? '' : parentPath.replace(/\/+$/, '')}/
              {name || '…'}
            </p>
            {error && <p className="text-sm">移动失败：{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={!name.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteKnowledgeButton({
  node,
  onDeleted,
}: {
  node: { id: string; title: string; kind: 'directory' | 'article' }
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        删除
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除「{node.title}」</AlertDialogTitle>
          <AlertDialogDescription>
            {node.kind === 'directory'
              ? '该目录及其全部子目录、文章都会被删除，且不可恢复。'
              : '文章删除后不可恢复。'}
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
            disabled={deleting}
            onClick={() => {
              setDeleting(true)
              api
                .deleteKnowledgeNode(node.id, node.kind === 'directory')
                .then(onDeleted)
                .catch((e: Error) => setError(e.message))
                .finally(() => setDeleting(false))
            }}
          >
            {deleting ? '删除中…' : '确认删除'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
