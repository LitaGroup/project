import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom'
import { Layout } from './components/Layout'
import { useAuth } from './context/AuthContext'
// 登录页保持同步加载：OAuth 回调跳转的兜底入口，避免懒加载失败白屏
import { LoginPage } from './pages/LoginPage'

// 路由级懒加载：页面按路由拆包，首屏只加载当前页面代码
const OverviewPage = lazy(() =>
  import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })),
)
const RequirementsPage = lazy(() =>
  import('./pages/RequirementsPage').then((m) => ({ default: m.RequirementsPage })),
)
const IterationsPage = lazy(() =>
  import('./pages/IterationsPage').then((m) => ({ default: m.IterationsPage })),
)
const IterationEditPage = lazy(() =>
  import('./pages/IterationEditPage').then((m) => ({ default: m.IterationEditPage })),
)
const IterationDetailPage = lazy(() =>
  import('./pages/IterationDetailPage').then((m) => ({ default: m.IterationDetailPage })),
)
const BacklogDetailPage = lazy(() =>
  import('./pages/BacklogDetailPage').then((m) => ({ default: m.BacklogDetailPage })),
)
const IdeasPage = lazy(() =>
  import('./pages/IdeasPage').then((m) => ({ default: m.IdeasPage })),
)
const IdeaEditPage = lazy(() =>
  import('./pages/IdeaEditPage').then((m) => ({ default: m.IdeaEditPage })),
)
const IdeaDetailPage = lazy(() =>
  import('./pages/IdeaDetailPage').then((m) => ({ default: m.IdeaDetailPage })),
)
const FeedbackPage = lazy(() =>
  import('./pages/FeedbackPage').then((m) => ({ default: m.FeedbackPage })),
)
const FeedbackDetailPage = lazy(() =>
  import('./pages/FeedbackDetailPage').then((m) => ({ default: m.FeedbackDetailPage })),
)
const ProjectDetailPage = lazy(() =>
  import('./pages/ProjectDetailPage').then((m) => ({ default: m.ProjectDetailPage })),
)
const DocumentDetailPage = lazy(() =>
  import('./pages/DocumentDetailPage').then((m) => ({ default: m.DocumentDetailPage })),
)
const CheckRunPage = lazy(() =>
  import('./pages/CheckRunPage').then((m) => ({ default: m.CheckRunPage })),
)
const TestRunPage = lazy(() =>
  import('./pages/TestRunPage').then((m) => ({ default: m.TestRunPage })),
)
const ExportRunPage = lazy(() =>
  import('./pages/ExportRunPage').then((m) => ({ default: m.ExportRunPage })),
)
const ScheduleDetailPage = lazy(() =>
  import('./pages/ScheduleDetailPage').then((m) => ({ default: m.ScheduleDetailPage })),
)
const TestsPage = lazy(() =>
  import('./pages/TestsPage').then((m) => ({ default: m.TestsPage })),
)
const ChecksPage = lazy(() =>
  import('./pages/ChecksPage').then((m) => ({ default: m.ChecksPage })),
)
const ExportsPage = lazy(() =>
  import('./pages/ExportsPage').then((m) => ({ default: m.ExportsPage })),
)
const DocumentsPage = lazy(() =>
  import('./pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage })),
)
const KnowledgeBrowserPage = lazy(() =>
  import('./pages/KnowledgeBrowserPage').then((m) => ({ default: m.KnowledgeBrowserPage })),
)
const ResourcesPage = lazy(() =>
  import('./pages/ResourcesPage').then((m) => ({ default: m.ResourcesPage })),
)
const MilestonesPage = lazy(() =>
  import('./pages/MilestonesPage').then((m) => ({ default: m.MilestonesPage })),
)
const CommitsPage = lazy(() =>
  import('./pages/CommitsPage').then((m) => ({ default: m.CommitsPage })),
)
const ReposPage = lazy(() =>
  import('./pages/ReposPage').then((m) => ({ default: m.ReposPage })),
)
const GithubAccessPage = lazy(() =>
  import('./pages/GithubAccessPage').then((m) => ({ default: m.GithubAccessPage })),
)
const FeishuBotConfigPage = lazy(() =>
  import('./pages/FeishuBotConfigPage').then((m) => ({ default: m.FeishuBotConfigPage })),
)
const FeishuBotGroupPolicyPage = lazy(() =>
  import('./pages/FeishuBotGroupPolicyPage').then((m) => ({ default: m.FeishuBotGroupPolicyPage })),
)
const McpLogsPage = lazy(() =>
  import('./pages/McpLogsPage').then((m) => ({ default: m.McpLogsPage })),
)
const McpServersPage = lazy(() =>
  import('./pages/McpServersPage').then((m) => ({ default: m.McpServersPage })),
)
const SsoClientsPage = lazy(() =>
  import('./pages/SsoClientsPage').then((m) => ({ default: m.SsoClientsPage })),
)
const ModelConfigPage = lazy(() =>
  import('./pages/ModelConfigPage').then((m) => ({ default: m.ModelConfigPage })),
)
const ScriptLibraryPage = lazy(() =>
  import('./pages/ScriptLibraryPage').then((m) => ({ default: m.ScriptLibraryPage })),
)
const ScriptLibraryDetailPage = lazy(() =>
  import('./pages/ScriptLibraryDetailPage').then((m) => ({ default: m.ScriptLibraryDetailPage })),
)
const SchedulesPage = lazy(() =>
  import('./pages/SchedulesPage').then((m) => ({ default: m.SchedulesPage })),
)
const TaskCenterPage = lazy(() =>
  import('./pages/TaskCenterPage').then((m) => ({ default: m.TaskCenterPage })),
)
const TasksPage = lazy(() =>
  import('./pages/TasksPage').then((m) => ({ default: m.TasksPage })),
)
const TaskCreatePage = lazy(() =>
  import('./pages/TaskCreatePage').then((m) => ({ default: m.TaskCreatePage })),
)
const TaskDefinitionsPage = lazy(() =>
  import('./pages/TaskDefinitionsPage').then((m) => ({ default: m.TaskDefinitionsPage })),
)
const TaskDefinitionDetailPage = lazy(() =>
  import('./pages/TaskDefinitionDetailPage').then((m) => ({ default: m.TaskDefinitionDetailPage })),
)
const TaskTemplatesPage = lazy(() =>
  import('./pages/TaskTemplatesPage').then((m) => ({ default: m.TaskTemplatesPage })),
)
const TaskTemplateEditPage = lazy(() =>
  import('./pages/TaskTemplateEditPage').then((m) => ({ default: m.TaskTemplateEditPage })),
)
const TaskPackageDetailPage = lazy(() =>
  import('./pages/TaskPackageDetailPage').then((m) => ({ default: m.TaskPackageDetailPage })),
)
const WorkersLivePage = lazy(() =>
  import('./pages/WorkersLivePage').then((m) => ({ default: m.WorkersLivePage })),
)
const WorkersPage = lazy(() =>
  import('./pages/WorkersPage').then((m) => ({ default: m.WorkersPage })),
)
const WorkerEditPage = lazy(() =>
  import('./pages/WorkerEditPage').then((m) => ({ default: m.WorkerEditPage })),
)
const WorkerDebugPage = lazy(() =>
  import('./pages/WorkerDebugPage').then((m) => ({ default: m.WorkerDebugPage })),
)
const ExecutorsPage = lazy(() =>
  import('./pages/ExecutorsPage').then((m) => ({ default: m.ExecutorsPage })),
)
const DefectsPage = lazy(() =>
  import('./pages/DefectsPage').then((m) => ({ default: m.DefectsPage })),
)
const DefectDetailPage = lazy(() =>
  import('./pages/DefectDetailPage').then((m) => ({ default: m.DefectDetailPage })),
)
const ProjectDefectsPage = lazy(() =>
  import('./pages/ProjectDefectsPage').then((m) => ({ default: m.ProjectDefectsPage })),
)
const ProjectTestsPage = lazy(() =>
  import('./pages/ProjectTestsPage').then((m) => ({ default: m.ProjectTestsPage })),
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })),
)
const ProfileTaskDefinitionsPage = lazy(() =>
  import('./pages/ProfileTaskDefinitionsPage').then((m) => ({ default: m.ProfileTaskDefinitionsPage })),
)
const AppsPage = lazy(() =>
  import('./pages/AppsPage').then((m) => ({ default: m.AppsPage })),
)
const UserListPage = lazy(() =>
  import('./pages/UserListPage').then((m) => ({ default: m.UserListPage })),
)
const TicketsPage = lazy(() =>
  import('./pages/TicketsPage').then((m) => ({ default: m.TicketsPage })),
)
const TicketCreatePage = lazy(() =>
  import('./pages/TicketCreatePage').then((m) => ({ default: m.TicketCreatePage })),
)
const TicketDetailPage = lazy(() =>
  import('./pages/TicketDetailPage').then((m) => ({ default: m.TicketDetailPage })),
)
const TicketHomePage = lazy(() =>
  import('./pages/TicketHomePage').then((m) => ({ default: m.TicketHomePage })),
)
const TicketDefinitionsPage = lazy(() =>
  import('./pages/TicketDefinitionsPage').then((m) => ({ default: m.TicketDefinitionsPage })),
)
const TicketDefinitionEditPage = lazy(() =>
  import('./pages/TicketDefinitionEditPage').then((m) => ({ default: m.TicketDefinitionEditPage })),
)
const WorkbenchPage = lazy(() =>
  import('./pages/WorkbenchPage').then((m) => ({ default: m.WorkbenchPage })),
)
const RobotChatPage = lazy(() =>
  import('./pages/RobotChatPage').then((m) => ({ default: m.RobotChatPage })),
)


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
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center text-sm text-foreground-muted">
          页面加载中…
        </div>
      }
    >
      <BrowserRouter>
        <Routes>
          {/* 登录页公开（OAuth 回调失败跳转目标） */}
          <Route path="/login" element={<LoginPage />} />
          {/* 其余网页全部要求登录（后端 JSON 接口由 AuthGuard 同步拦截） */}
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
            {/* 业务分区落地页：需求池；概览页保留 /overview 路由（不挂导航） */}
            <Route path="/" element={<Navigate to="/requirements" replace />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/requirements" element={<RequirementsPage />} />
            <Route path="/iterations" element={<IterationsPage />} />
            <Route path="/iterations/new" element={<IterationEditPage />} />
            <Route path="/iterations/:iterationId" element={<IterationDetailPage />} />
            <Route path="/backlogs/:backlogId" element={<BacklogDetailPage />} />
            <Route path="/ideas" element={<IdeasPage />} />
            <Route path="/ideas/new" element={<IdeaEditPage key="idea-new" />} />
            <Route path="/ideas/:ideaId/edit" element={<IdeaEditPage />} />
            <Route path="/ideas/:ideaId" element={<IdeaDetailPage />} />
            <Route path="/feedback" element={<FeedbackPage />} />
            <Route path="/feedback/:feedbackId" element={<FeedbackDetailPage />} />
            <Route path="/workbench" element={<WorkbenchPage />} />
            <Route path="/workbench/tasks/:taskId" element={<WorkbenchPage />} />
            <Route path="/robots" element={<RobotChatPage />} />
            <Route path="/robots/:workerId" element={<RobotChatPage />} />
            {/* 旧「项目」列表路由兼容：统一并入需求池 */}
            <Route path="/projects" element={<Navigate to="/requirements" replace />} />
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
            {/* 任务定义 / 机器人 / 执行器已迁移到管理模块：旧链接兼容 */}
            <Route
              path="/tasks/types"
              element={<Navigate to="/admin/task-templates" replace />}
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
              <Route path="/admin/feishu-config" element={<FeishuBotConfigPage />} />
              <Route
                path="/admin/feishu-config/policy/:configId"
                element={<FeishuBotGroupPolicyPage />}
              />
              <Route path="/admin/mcp-servers" element={<McpServersPage />} />
              <Route path="/admin/mcp-logs" element={<McpLogsPage />} />
              <Route path="/admin/model-config" element={<ModelConfigPage />} />
              <Route path="/admin/sso-clients" element={<SsoClientsPage />} />
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
    </Suspense>
  )
}

export default App
