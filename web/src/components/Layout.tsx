import { useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { dt } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { useNotifications } from '../lib/notifications'

export function LangToggle() {
  const { lang, setLang } = useI18n()
  return (
    <button className="btn btn-ghost lang" onClick={() => setLang(lang === 'ru' ? 'kk' : 'ru')}>
      {lang === 'ru' ? 'ҚАЗ' : 'РУС'}
    </button>
  )
}

function Bell() {
  const { items, unread, markAllRead } = useNotifications()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <div className="bell-wrap">
      <button className="btn btn-ghost bell" aria-label={t('nav.notifications')} onClick={() => { setOpen(!open); if (!open) markAllRead() }}>
        🔔{unread > 0 && <span className="bell-count">{unread}</span>}
      </button>
      {open && (
        <div className="bell-panel card" onClick={() => setOpen(false)}>
          {items.length === 0 && <p className="muted">{t('board.empty')}</p>}
          {items.slice(0, 20).map((n) => (
            <button key={n.id} className={`notice${n.read_at ? '' : ' unread'}`}
                    onClick={() => n.order_id && navigate(`/order/${n.order_id}`)}>
              <span className="muted">{dt(n.created_at)}</span> {n.text}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Toasts() {
  const { toasts, dismiss } = useNotifications()
  const navigate = useNavigate()
  if (!toasts.length) return null
  return (
    <div className="toasts" role="status">
      {toasts.map((n) => (
        <div key={n.id} className={`toast${/АВАРИЙН|просрочен/i.test(n.text) ? ' urgent' : ''}`}>
          <button className="toast-body" onClick={() => { dismiss(n.id); if (n.order_id) navigate(`/order/${n.order_id}`) }}>{n.text}</button>
          <button className="btn btn-ghost toast-x" aria-label="Закрыть" onClick={() => dismiss(n.id)}>✕</button>
        </div>
      ))}
    </div>
  )
}

export function Layout({ title, children, actions, back }: { title: string; children: ReactNode; actions?: ReactNode; back?: string }) {
  const { employee, logout } = useAuth()
  const { t } = useI18n()
  const staff = employee && employee.role !== 'worker'
  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar-title">
          {back && <Link to={back} className="back">← {t('nav.back')}</Link>}
          <strong>{title}</strong>
          {employee && <span className="muted">{employee.full_name} · {t(`role.${employee.role}`)}</span>}
        </div>
        <div className="topbar-actions">
          {actions}
          {employee && <Bell />}
          <LangToggle />
          <button className="btn btn-ghost" onClick={logout}>{t('nav.logout')}</button>
        </div>
      </header>
      {employee && (
        <nav className="tabs">
          {employee.role === 'worker' && <NavLink to="/worker">{t('worker.title')}</NavLink>}
          {(employee.role === 'master' || employee.role === 'admin') && <NavLink to="/master" end>{t('board.title')}</NavLink>}
          {staff && <NavLink to="/panel">{t('panel.title')}</NavLink>}
          <NavLink to="/settings">{t('settings.title')}</NavLink>
        </nav>
      )}
      <main>{children}</main>
      <Toasts />
    </div>
  )
}
