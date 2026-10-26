import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@appica/ui-react/providers/theme-provider'
import { AuthProvider } from './context/AuthContext'
import { MotionProvider } from './components/MotionProvider'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <MotionProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MotionProvider>
    </ThemeProvider>
  </StrictMode>,
)
