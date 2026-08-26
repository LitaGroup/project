import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { OverviewPage } from './pages/OverviewPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { DocumentDetailPage } from './pages/DocumentDetailPage'
import { CheckRunPage } from './pages/CheckRunPage'
import { TestRunPage } from './pages/TestRunPage'
import { TaskDetailPage } from './pages/TaskDetailPage'
import { TestsPage } from './pages/TestsPage'
import { ChecksPage } from './pages/ChecksPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { ScriptsPage } from './pages/ScriptsPage'
import { TasksPage } from './pages/TasksPage'
import { DefectsPage } from './pages/DefectsPage'
import { DefectDetailPage } from './pages/DefectDetailPage'
import { SettingsPage } from './pages/SettingsPage'
import { AppsPage } from './pages/AppsPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<OverviewPage />} />
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
            path="/projects/:id/tasks/:taskId"
            element={<TaskDetailPage />}
          />
          <Route
            path="/projects/:id/defects/:defectId"
            element={<DefectDetailPage />}
          />
          <Route path="/defects" element={<DefectsPage />} />
          <Route path="/tests" element={<TestsPage />} />
          <Route path="/checks" element={<ChecksPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/:id" element={<DocumentDetailPage />} />
          <Route path="/scripts" element={<ScriptsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/apps" element={<AppsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
