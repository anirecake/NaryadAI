import { useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import type { Role } from '../lib/domain'
import { dt } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { useNotifications } from '../lib/notifications'
import { Icon } from './Icon'

export function LangToggle() {
  const { lang, setLang } = useI18n()
  return (
    <button className="btn btn-ghost btn-sm lang" onClick={() => setLang(lang === 'ru' ? 'kk' : 'ru')}>
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
      <button className="btn btn-ghost btn-icon" aria-label={t('nav.notifications')} onClick={() => { setOpen(!open); if (!open) markAllRead() }}>
        <Icon name="bell" />
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <>
          <div className="bell-scrim" onClick={() => setOpen(false)} />
          <div className="bell-panel">
            <div className="bell-title">{t('nav.notifications')}</div>
            {items.length === 0 && <p className="muted pad">{t('notif.empty')}</p>}
            {items.slice(0, 30).map((n) => (
              <button key={n.id} className={`notice${n.read_at ? '' : ' unread'}`}
                      onClick={() => { setOpen(false); if (n.order_id) navigate(`/order/${n.order_id}`) }}>
                <span className="notice-text">{n.text}</span>
                <span className="cap">{dt(n.created_at)}</span>
              </button>
            ))}
          </div>
        </>
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
          <button className="btn btn-ghost btn-icon" aria-label="Закрыть" onClick={() => dismiss(n.id)}><Icon name="x" size={18} /></button>
        </div>
      ))}
    </div>
  )
}

interface NavItem { to: string; icon: string; label: string; end?: boolean; mobile?: boolean }

function navFor(role: Role, t: (k: string) => string): NavItem[] {
  const items: NavItem[] = []
  if (role === 'worker') items.push({ to: '/worker', icon: 'list', label: t('worker.title'), mobile: true })
  if (role === 'master' || role === 'admin') {
    items.push({ to: '/master', icon: 'board', label: t('board.title'), end: true, mobile: true })
    items.push({ to: '/master/new', icon: 'plus', label: t('order.new'), mobile: true })
  }
  if (role !== 'worker') items.push({ to: '/panel', icon: 'chart', label: t('panel.title'), mobile: true })
  if (role === 'admin') {
    items.push({ to: '/admin/people', icon: 'users', label: t('admin.people') })
    items.push({ to: '/admin/catalog', icon: 'box', label: t('admin.catalog') })
  }
  items.push({ to: '/settings', icon: 'settings', label: t('settings.title'), mobile: true })
  return items
}

const initials = (name: string) => name.split(' ').slice(0, 2).map((p) => p[0]).join('')

export function Layout({ title, subtitle, children, actions, back }: {
  title: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode; back?: string
}) {
  const { employee, logout } = useAuth()
  const { t } = useI18n()
  const nav = employee ? navFor(employee.role, t) : []
  return (
    <div className="shell">
      <aside className="side">
        <Link to="/" className="logo"><img src="/icon.svg" alt="" width={26} height={26} /> Наряд<b>AI</b></Link>
        <nav className="side-nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="item"><Icon name={n.icon} size={18} /> {n.label}</NavLink>
          ))}
        </nav>
        {employee && (
          <div className="me">
            <span className="av">{initials(employee.full_name)}</span>
            <span className="me-text"><b>{employee.full_name.split(' ').slice(0, 2).join(' ')}</b><small>{t(`role.${employee.role}`)}</small></span>
            <button className="btn btn-ghost btn-icon" aria-label={t('nav.logout')} title={t('nav.logout')} onClick={logout}><Icon name="logout" size={18} /></button>
          </div>
        )}
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            {back && <Link to={back} className="back"><Icon name="back" size={18} /> {t('nav.back')}</Link>}
            <h1>{title}</h1>
            {subtitle && <div className="subtitle">{subtitle}</div>}
          </div>
          <div className="topbar-actions">
            {actions}
            {employee && <Bell />}
            <LangToggle />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>

      {employee && (
        <nav className="tabbar">
          {nav.filter((n) => n.mobile).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="tab"><Icon name={n.icon} size={22} /><span>{n.label}</span></NavLink>
          ))}
        </nav>
      )}
      <Toasts />
    </div>
  )
}
