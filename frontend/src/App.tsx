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
import { ResourcesPage } from './pages/ResourcesPage'
import { MilestonesPage } from './pages/MilestonesPage'
import { CommitsPage } from './pages/CommitsPage'
import { ReposPage } from './pages/ReposPage'
import { GithubAccessPage } from './pages/GithubAccessPage'
import { ScriptLibraryPage } from './pages/ScriptLibraryPage'
import { ScriptLibraryDetailPage } from './pages/ScriptLibraryDetailPage'
import { SchedulesPage } from './pages/SchedulesPage'
import { TaskCenterPage } from './pages/TaskCenterPage'
import { TasksPage } from './pages/TasksPage'
import { TaskCreatePage } from './pages/TaskCreatePage'
import { TaskDefinitionsPage } from './pages/TaskDefinitionsPage'
import { TaskDefinitionDetailPage } from './pages/TaskDefinitionDetailPage'
import { TaskTemplatesPage } from './pages/TaskTemplatesPage'
import { TaskTypesPage } from './pages/TaskTypesPage'
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
import { ProfileTaskDefinitionsPage } from './pages/ProfileTaskDefinitionsPage'
import { AppsPage } from './pages/AppsPage'
import { LoginPage } from './pages/LoginPage'
import { UserListPage } from './pages/UserListPage'
import { TicketsPage } from './pages/TicketsPage'
import { TicketCreatePage } from './pages/TicketCreatePage'
import { TicketDetailPage } from './pages/TicketDetailPage'
import { TicketHomePage } from './pages/TicketHomePage'
import { TicketDefinitionsPage } from './pages/TicketDefinitionsPage'
import { TicketDefinitionEditPage } from './pages/TicketDefinitionEditPage'
import { WorkbenchPage } from './pages/WorkbenchPage'
import { RobotChatPage } from './pages/RobotChatPage'

/** 路由级登录守卫：未登录一律跳 /login（会话加载中先不渲染，避免登录用户闪跳） */
function RequireAuth() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

/** 管理区守卫：仅管理员可访问，其他人直接访问 /admin/* 时跳回项目概览 */
function RequireAdmin() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user?.role !== '管理员') return <Navigate to="/" replace />
  return <Outlet />
}

/** 工单列表按 URL 中的工单配置 ID 加载 */
function TicketsPageWithDefinition() {
  const { definitionId } = useParams<{ definitionId: string }>()
  const id = Number(definitionId)
  if (!Number.isInteger(id) || id <= 0) return <Navigate to="/tickets" replace />
  return <TicketsPage definitionId={id} />
}

/** 旧「调度器」路由兼容：调度器已合并进机器人 */
function SchedulerRedirect() {
  const { workerId } = useParams<{ workerId: string }>()
  return (
    <Navigate
      to={workerId ? `/admin/workers/${workerId}` : '/admin/workers'}
      replace
    />
  )
}

/** 任务定义已迁移到管理模块：保留旧详情链接兼容 */
function LegacyTaskTemplateRedirect() {
  const { templateId } = useParams<{ templateId: string }>()
  return <Navigate to={`/admin/task-templates/${templateId}`} replace />
}

/** 机器人已迁移到管理模块：保留旧详情链接兼容 */
function LegacyWorkerRedirect() {
  const { workerId } = useParams<{ workerId: string }>()
  return <Navigate to={`/admin/workers/${workerId}`} replace />
}

/** 机器人调试已迁移到管理模块：保留旧链接兼容 */
function LegacyWorkerDebugRedirect() {
  const { workerId } = useParams<{ workerId: string }>()
  return (
    <Navigate to={`/admin/workers/${workerId}/debug`} replace />
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
          <Route path="/workbench" element={<WorkbenchPage />} />
          <Route path="/workbench/tasks/:taskId" element={<WorkbenchPage />} />
          <Route path="/robots" element={<RobotChatPage />} />
          <Route path="/robots/:workerId" element={<RobotChatPage />} />
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
          <Route path="/docs/detail" element={<KnowledgeBrowserPage />} />
          <Route path="/docs/detail/*" element={<KnowledgeBrowserPage />} />
          <Route path="/docs/scripts" element={<ScriptLibraryPage />} />
          <Route
            path="/docs/scripts/detail"
            element={<ScriptLibraryDetailPage />}
          />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/milestones" element={<MilestonesPage />} />
          <Route path="/commits" element={<CommitsPage />} />
          {/* 仓库已并入管理模块：旧代码分区链接兼容 */}
          <Route path="/code" element={<Navigate to="/admin/repos" replace />} />
          <Route path="/code/repos" element={<Navigate to="/admin/repos" replace />} />
          <Route path="/scripts" element={<Navigate to="/docs/scripts" replace />} />
          <Route path="/schedules" element={<SchedulesPage />} />
          <Route path="/tasks" element={<TaskCenterPage />} />
          <Route path="/tasks/list" element={<TasksPage />} />
          <Route path="/tasks/new" element={<TaskCreatePage />} />
          <Route path="/tasks/live" element={<WorkersLivePage />} />
          <Route path="/tasks/definitions" element={<TaskDefinitionsPage />} />
          <Route
            path="/tasks/definitions/:templateId"
            element={<TaskDefinitionDetailPage />}
          />
          {/* 任务类型 / 任务定义 / 机器人 / 执行器已迁移到管理模块：旧链接兼容 */}
          <Route
            path="/tasks/types"
            element={<Navigate to="/admin/task-types" replace />}
          />
          <Route
            path="/tasks/templates"
            element={<Navigate to="/admin/task-templates" replace />}
          />
          <Route
            path="/tasks/templates/new"
            element={<Navigate to="/admin/task-templates/new" replace />}
          />
          <Route
            path="/tasks/templates/:templateId"
            element={<LegacyTaskTemplateRedirect />}
          />
          <Route
            path="/tasks/workers"
            element={<Navigate to="/admin/workers" replace />}
          />
          <Route
            path="/tasks/workers/new"
            element={<Navigate to="/admin/workers/new" replace />}
          />
          <Route
            path="/tasks/workers/:workerId"
            element={<LegacyWorkerRedirect />}
          />
          <Route
            path="/tasks/workers/:workerId/debug"
            element={<LegacyWorkerDebugRedirect />}
          />
          {/* 调试入口已并入机器人列表行内按钮：旧链接兼容 */}
          <Route
            path="/tasks/debug"
            element={<Navigate to="/admin/workers" replace />}
          />
          {/* 调度器已合并进机器人：旧链接兼容 */}
          <Route path="/tasks/schedulers" element={<SchedulerRedirect />} />
          <Route path="/tasks/schedulers/:workerId" element={<SchedulerRedirect />} />
          <Route
            path="/tasks/executors"
            element={<Navigate to="/admin/executors" replace />}
          />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/task-types" element={<TaskTypesPage />} />
            <Route path="/admin/task-templates" element={<TaskTemplatesPage />} />
            <Route
              path="/admin/task-templates/new"
              element={<TaskTemplateEditPage />}
            />
            <Route
              path="/admin/task-templates/:templateId"
              element={<TaskTemplateEditPage />}
            />
            <Route path="/admin/workers" element={<WorkersPage />} />
            <Route path="/admin/workers/new" element={<WorkerEditPage />} />
            <Route path="/admin/workers/:workerId" element={<WorkerEditPage />} />
            <Route
              path="/admin/workers/:workerId/debug"
              element={<WorkerDebugPage />}
            />
            <Route path="/admin/executors" element={<ExecutorsPage />} />
            <Route path="/admin/users" element={<UserListPage />} />
            <Route path="/admin/ticket-config" element={<TicketDefinitionsPage />} />
            <Route
              path="/admin/ticket-config/:definitionId"
              element={<TicketDefinitionEditPage />}
            />
            <Route
              path="/admin/ticket-definitions"
              element={<Navigate to="/admin/ticket-config" replace />}
            />
            <Route
              path="/admin/ticket-definitions/:definitionId"
              element={<Navigate to="/admin/ticket-config" replace />}
            />
            <Route path="/admin/repos" element={<ReposPage />} />
            <Route path="/admin/github-access" element={<GithubAccessPage />} />
          </Route>
          <Route path="/tasks/:id" element={<TaskPackageDetailPage />} />
          <Route path="/tickets" element={<TicketHomePage />} />
          <Route path="/tickets/mine" element={<TicketsPage scope="mine" />} />
          <Route path="/tickets/all" element={<TicketsPage scope="all" />} />
          <Route
            path="/tickets/wf/:definitionId"
            element={<TicketsPageWithDefinition />}
          />
          <Route
            path="/tickets/wf/:definitionId/new"
            element={<TicketCreatePage />}
          />
          <Route
            path="/tickets/tech"
            element={<Navigate to="/tickets" replace />}
          />
          <Route
            path="/tickets/data"
            element={<Navigate to="/tickets" replace />}
          />
          <Route
            path="/tickets/solution"
            element={<Navigate to="/tickets" replace />}
          />
          <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
          <Route path="/apps" element={<AppsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/robot" element={<WorkerEditPage personal />} />
          <Route
            path="/profile/task-definitions"
            element={<ProfileTaskDefinitionsPage />}
          />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
