import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/auth'
import Layout from './components/Layout'
import PrivateRoute from './components/PrivateRoute'
import Spinner from './components/ui/Spinner'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ConsolePage from './pages/ConsolePage'
import TokensPage from './pages/TokensPage'
import UsersPage from './pages/admin/UsersPage'
import HostsPage from './pages/admin/HostsPage'
import SettingsPage from './pages/admin/SettingsPage'
import StatsPage from './pages/admin/StatsPage'
import AuditPage from './pages/admin/AuditPage'

export default function App() {
  const { initFromStorage, isLoading } = useAuthStore()

  useEffect(() => {
    initFromStorage()
  }, [initFromStorage])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0d1117]">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Layout>
              <Routes>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/console" element={<ConsolePage />} />
                <Route path="/tokens" element={<TokensPage />} />
                <Route
                  path="/admin/users"
                  element={
                    <PrivateRoute adminOnly>
                      <UsersPage />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/admin/hosts"
                  element={
                    <PrivateRoute adminOnly>
                      <HostsPage />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/admin/settings"
                  element={
                    <PrivateRoute adminOnly>
                      <SettingsPage />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/admin/stats"
                  element={
                    <PrivateRoute adminOnly>
                      <StatsPage />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/admin/audit"
                  element={
                    <PrivateRoute adminOnly>
                      <AuditPage />
                    </PrivateRoute>
                  }
                />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Layout>
          </PrivateRoute>
        }
      />
    </Routes>
  )
}
