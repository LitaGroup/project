import { useEffect, useState } from 'react'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { Input } from '@appica/ui-react/input'
import { Badge } from '@appica/ui-react/badge'
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from '@appica/ui-react/avatar'
import { api, type PlatformUser } from '../lib/api'

/**
 * 管理端用户列表：列出用户系统内全部用户（头像/姓名/部门/角色/邮箱/最近登录），
 * 支持姓名、部门、邮箱模糊搜索。
 */
export function UserListPage() {
  const [users, setUsers] = useState<PlatformUser[] | null>(null)
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listUsers()
      .then(setUsers)
      .catch((e: Error) => setError(e.message))
  }, [])

  const q = keyword.trim().toLowerCase()
  const filtered = (users ?? []).filter(
    (u) =>
      !q ||
      u.name.toLowerCase().includes(q) ||
      (u.department ?? '').toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q),
  )

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">用户列表</h1>
      </div>
      <div className="mb-4 flex gap-2">
        <Input
          className="w-64"
          placeholder="搜索姓名、部门、邮箱…"
          clearable
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onClear={() => setKeyword('')}
        />
      </div>
      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}
      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">头像</TableHead>
            <TableHead className="w-40">姓名</TableHead>
            <TableHead>部门</TableHead>
            <TableHead className="w-24 text-center">角色</TableHead>
            <TableHead>邮箱</TableHead>
            <TableHead className="w-52">最近登录</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <Avatar size="sm">
                  {u.avatarUrl && (
                    <AvatarImage src={u.avatarUrl} alt={u.name} />
                  )}
                  <AvatarFallback>{u.name.slice(0, 1)}</AvatarFallback>
                </Avatar>
              </TableCell>
              <TableCell className="font-medium text-foreground-intense">
                {u.name}
              </TableCell>
              <TableCell className="text-foreground-muted">
                {u.department ?? '—'}
              </TableCell>
              <TableCell className="text-center">
                <Badge variant={u.role === '管理员' ? 'soft' : 'secondary'}>
                  {u.role}
                </Badge>
              </TableCell>
              <TableCell className="text-foreground-muted">
                {u.email ?? '—'}
              </TableCell>
              <TableCell>
                {u.lastLoginAt
                  ? new Date(u.lastLoginAt).toLocaleString()
                  : '—'}
              </TableCell>
            </TableRow>
          ))}
          {users !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                {users.length === 0 ? '暂无用户' : '无匹配的用户'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
