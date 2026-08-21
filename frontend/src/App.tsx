import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { OverviewPage } from './pages/OverviewPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { DocumentDetailPage } from './pages/DocumentDetailPage'
import { CheckRunPage } from './pages/CheckRunPage'
import { TestRunPage } from './pages/TestRunPage'
import { TaskDetailPage } from './pages/TaskDetailPage'
import { SettingsPage } from './pages/SettingsPage'

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
          <Route path="/documents/:id" element={<DocumentDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
