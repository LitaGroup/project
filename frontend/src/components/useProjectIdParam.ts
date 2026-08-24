import { useSearchParams } from 'react-router-dom'

/** 读写 URL 中的 ?projectId= 参数：返回 'all' 或项目 id 字符串 + 设置器（同步回 URL，replace 不留历史） */
export function useProjectIdParam(): [string, (v: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const value = searchParams.get('projectId') ?? 'all'
  const setValue = (v: string) => {
    const next = new URLSearchParams(searchParams)
    if (v === 'all') next.delete('projectId')
    else next.set('projectId', v)
    setSearchParams(next, { replace: true })
  }
  return [value, setValue]
}
