import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './styles.css'
import { AuthProvider, homeFor, useAuth } from './lib/auth'
import type { Role } from './lib/domain'
import { I18nProvider, useI18n } from './lib/i18n'
import { NotificationsProvider } from './lib/notifications'
import { isConfigured } from './lib/supabase'
import Login from './pages/Login'
import OrderDetail from './pages/OrderDetail'
import QrPrint from './pages/QrPrint'
import Settings from './pages/Settings'
import Board from './pages/master/Board'
import NewOrder from './pages/master/NewOrder'
import Panel from './pages/panel/Panel'
import Catalog from './pages/admin/Catalog'
import People from './pages/admin/People'
import CloseOrder from './pages/worker/CloseOrder'
import MyOrders from './pages/worker/MyOrders'

// Каждая роль видит только свои экраны (требование 9.5 ТЗ)
function RequireRole({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { loading, employee } = useAuth()
  if (loading) return null
  if (!employee) return <Navigate to="/login" replace />
  if (roles && !roles.includes(employee.role)) return <Navigate to={homeFor(employee.role)} replace />
  return children
}

function Home() {
  const { loading, employee } = useAuth()
  if (loading) return null
  return <Navigate to={employee ? homeFor(employee.role) : '/login'} replace />
}

function Setup() {
  const { t } = useI18n()
  return (
    <div className="login">
      <div className="card login-card">
        <h1>{t('setup.title')}</h1>
        <p>{t('setup.text')}</p>
      </div>
    </div>
  )
}

const MASTER: Role[] = ['master', 'admin']
const STAFF: Role[] = ['manager', 'admin', 'master']

function App() {
  if (!isConfigured) return <Setup />
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/master" element={<RequireRole roles={MASTER}><Board /></RequireRole>} />
      <Route path="/master/new" element={<RequireRole roles={MASTER}><NewOrder /></RequireRole>} />
      <Route path="/worker" element={<RequireRole roles={['worker']}><MyOrders /></RequireRole>} />
      <Route path="/worker/close/:id" element={<RequireRole roles={['worker']}><CloseOrder /></RequireRole>} />
      <Route path="/order/:id" element={<RequireRole><OrderDetail /></RequireRole>} />
      <Route path="/panel" element={<RequireRole roles={STAFF}><Panel /></RequireRole>} />
      <Route path="/qr" element={<RequireRole roles={STAFF}><QrPrint /></RequireRole>} />
      <Route path="/settings" element={<RequireRole><Settings /></RequireRole>} />
      <Route path="/admin/people" element={<RequireRole roles={['admin']}><People /></RequireRole>} />
      <Route path="/admin/catalog" element={<RequireRole roles={['admin']}><Catalog /></RequireRole>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <NotificationsProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </NotificationsProvider>
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
)
