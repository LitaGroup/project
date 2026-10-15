import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { api, type User } from '../lib/api'

interface AuthContextValue {
  /** 当前登录用户；null = 未登录（loading 期间也是 null，用 loading 区分） */
  user: User | null
  /** 首次 /me 请求是否完成 */
  loading: boolean
  /** 重新拉取当前用户（登录跳转回来后手动刷新用） */
  refresh: () => Promise<void>
  /** 登出：清服务端 Cookie + 本地状态 */
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
})

/** 登录仅提供身份（接口不拦截），会话经 HttpOnly Cookie 保持，无 token 暴露在前端 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setUser(await api.getMe())
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 首次拉取会话；setState 均在 fetch 完成后的异步回调里触发，非同步级联
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      /* Cookie 已失效等情况忽略，本地照常清空 */
    }
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// Context 文件同文件导出 hook 是惯例（Provider + useAuth）
// oxlint-disable-next-line react/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
