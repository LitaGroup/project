import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom'
import { Layout } from './components/Layout'
import { useAuth } from './context/AuthContext'
import { OverviewPage } from './pages/OverviewPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { DocumentDetailPage } from './pages/DocumentDetailPage'
import { CheckRunPage } from './pages/CheckRunPage'
import { TestRunPage } from './pages/TestRunPage'
import { ExportRunPage } from './pages/ExportRunPage'
import { ScheduleDetailPage } from './pages/ScheduleDetailPage'
import { TestsPage } from './pages/TestsPage'
import { ChecksPage } from './pages/ChecksPage'
import { ExportsPage } from './pages/ExportsPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { KnowledgeBrowserPage } from './pages/KnowledgeBrowserPage'
import { KnowledgeSearchPage } from './pages/KnowledgeSearchPage'
import { ResourcesPage } from './pages/ResourcesPage'
import { MilestonesPage } from './pages/MilestonesPage'
import { CommitsPage } from './pages/CommitsPage'
import { ReposPage } from './pages/ReposPage'
import { ScriptsPage } from './pages/ScriptsPage'
import { SchedulesPage } from './pages/SchedulesPage'
import { TaskCenterPage } from './pages/TaskCenterPage'
import { TasksPage } from './pages/TasksPage'
import { TaskCreatePage } from './pages/TaskCreatePage'
import { TaskTemplatesPage } from './pages/TaskTemplatesPage'
import { TaskTemplateEditPage } from './pages/TaskTemplateEditPage'
import { TaskPackageDetailPage } from './pages/TaskPackageDetailPage'
import { WorkersLivePage } from './pages/WorkersLivePage'
import { WorkersPage } from './pages/WorkersPage'
import { WorkerEditPage } from './pages/WorkerEditPage'
import { WorkerDebugPage } from './pages/WorkerDebugPage'
import { ExecutorsPage } from './pages/ExecutorsPage'
import { DefectsPage } from './pages/DefectsPage'
import { DefectDetailPage } from './pages/DefectDetailPage'
import { ProjectDefectsPage } from './pages/ProjectDefectsPage'
import { ProjectTestsPage } from './pages/ProjectTestsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ProfilePage } from './pages/ProfilePage'
import { AppsPage } from './pages/AppsPage'
import { LoginPage } from './pages/LoginPage'
import { UserListPage } from './pages/UserListPage'

/** 路由级登录守卫：未登录一律跳 /login（会话加载中先不渲染，避免登录用户闪跳） */
function RequireAuth() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

/** 旧「调度器」路由兼容：调度器已合并进机器人 */
function SchedulerRedirect() {
  const { workerId } = useParams<{ workerId: string }>()
  return (
    <Navigate
      to={workerId ? `/tasks/workers/${workerId}` : '/tasks/workers'}
      replace
    />
  )
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
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route
            path="/projects/:id/checks/:checkId"
            element={<CheckRunPage />}
          />
          <Route
            path="/projects/:id/tests"
            element={<ProjectTestsPage />}
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
            path="/projects/:id/schedules/:scheduleId"
            element={<ScheduleDetailPage />}
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
          <Route path="/docs" element={<Navigate to="/docs/detail/" replace />} />
          <Route path="/docs/search" element={<KnowledgeSearchPage />} />
          <Route path="/docs/detail" element={<KnowledgeBrowserPage />} />
          <Route path="/docs/detail/*" element={<KnowledgeBrowserPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/milestones" element={<MilestonesPage />} />
          <Route path="/commits" element={<CommitsPage />} />
          <Route path="/code" element={<Navigate to="/code/repos" replace />} />
          <Route path="/code/repos" element={<ReposPage />} />
          <Route path="/scripts" element={<ScriptsPage />} />
          <Route path="/schedules" element={<SchedulesPage />} />
          <Route path="/tasks" element={<TaskCenterPage />} />
          <Route path="/tasks/list" element={<TasksPage />} />
          <Route path="/tasks/new" element={<TaskCreatePage />} />
          <Route path="/tasks/live" element={<WorkersLivePage />} />
          <Route path="/tasks/templates" element={<TaskTemplatesPage />} />
          <Route
            path="/tasks/templates/new"
            element={<TaskTemplateEditPage />}
          />
          <Route
            path="/tasks/templates/:templateId"
            element={<TaskTemplateEditPage />}
          />
          <Route path="/tasks/workers" element={<WorkersPage />} />
          <Route path="/tasks/workers/new" element={<WorkerEditPage />} />
          <Route path="/tasks/workers/:workerId" element={<WorkerEditPage />} />
          <Route path="/tasks/debug" element={<WorkerDebugPage />} />
          {/* 调度器已合并进机器人：旧链接兼容 */}
          <Route path="/tasks/schedulers" element={<SchedulerRedirect />} />
          <Route path="/tasks/schedulers/:workerId" element={<SchedulerRedirect />} />
          <Route path="/tasks/executors" element={<ExecutorsPage />} />
          <Route path="/tasks/:id" element={<TaskPackageDetailPage />} />
          <Route path="/apps" element={<AppsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/admin/users" element={<UserListPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
