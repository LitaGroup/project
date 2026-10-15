import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { useAuth } from './context/AuthContext'
import { OverviewPage } from './pages/OverviewPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { DocumentDetailPage } from './pages/DocumentDetailPage'
import { CheckRunPage } from './pages/CheckRunPage'
import { TestRunPage } from './pages/TestRunPage'
import { ExportRunPage } from './pages/ExportRunPage'
import { TaskDetailPage } from './pages/TaskDetailPage'
import { TestsPage } from './pages/TestsPage'
import { ChecksPage } from './pages/ChecksPage'
import { ExportsPage } from './pages/ExportsPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { ResourcesPage } from './pages/ResourcesPage'
import { MilestonesPage } from './pages/MilestonesPage'
import { ScriptsPage } from './pages/ScriptsPage'
import { TasksPage } from './pages/TasksPage'
import { DefectsPage } from './pages/DefectsPage'
import { DefectDetailPage } from './pages/DefectDetailPage'
import { ProjectDefectsPage } from './pages/ProjectDefectsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ProfilePage } from './pages/ProfilePage'
import { AppsPage } from './pages/AppsPage'
import { LoginPage } from './pages/LoginPage'

/** 路由级登录守卫：未登录一律跳 /login（会话加载中先不渲染，避免登录用户闪跳） */
function RequireAuth() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 登录页公开（OAuth 回调失败跳转目标） */}
        <Route path="/login" element={<LoginPage />} />
        {/* 其余网页全部要求登录（后端 JSON 接口由 AuthGuard 同步拦截） */}
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route
            path="/projects/:id/checks/:checkId"
            element={<CheckRunPage />}
          />
          <Route
            path="/projects/:id/tests/:testId"
            element={<TestRunPage />}
          />
          <Route
            path="/projects/:id/exports/:exportId"
            element={<ExportRunPage />}
          />
          <Route
            path="/projects/:id/tasks/:taskId"
            element={<TaskDetailPage />}
          />
          <Route
            path="/projects/:id/defects"
            element={<ProjectDefectsPage />}
          />
          <Route
            path="/projects/:id/defects/:defectId"
            element={<DefectDetailPage />}
          />
          <Route path="/defects" element={<DefectsPage />} />
          <Route path="/tests" element={<TestsPage />} />
          <Route path="/checks" element={<ChecksPage />} />
          <Route path="/exports" element={<ExportsPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/:id" element={<DocumentDetailPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/milestones" element={<MilestonesPage />} />
          <Route path="/scripts" element={<ScriptsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/apps" element={<AppsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
