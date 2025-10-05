import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './contexts/AuthContext'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Header } from '@/components/Header.component'
import Logout from '@/routes/Logout'
import ProtectedRoute from '@/routes/ProtectedRoute'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <div className="h-screen flex flex-col bg-background">
          <Header />
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-hidden">
                <Routes>
                  <Route path="/" element={<Navigate to="/chat" replace />} />
                  <Route path="/chat" element={<App />} />
                  <Route
                    path="/chat/:id"
                    element={
                      <ProtectedRoute>
                        <App />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/logout" element={<Logout />} />
                  <Route path="*" element={<Navigate to="/chat" replace />} />
                </Routes>
              </div>
            </div>
          </div>
        </div>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
