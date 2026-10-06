import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { Empty } from '../../components/Inputs'
import { Layout } from '../../components/Layout'
import { isOverdue, OrderCard } from '../../components/OrderCard'
import { BOARD_COLUMNS, OPEN_STATUSES, ORDER_SELECT, type LiveEmployee, type Order, type Priority } from '../../lib/domain'
import { useI18n } from '../../lib/i18n'
import { useRealtimeRefresh } from '../../lib/realtime'
import { supabase } from '../../lib/supabase'

// Панель мастера (п. 5.2): люди с цветовым статусом + канбан нарядов, обновление в реальном времени
export default function Board() {
  const { t } = useI18n()
  const location = useLocation()
  const created = (location.state as { created?: number } | null)?.created
  const [people, setPeople] = useState<LiveEmployee[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [filter, setFilter] = useState<{ priority: Priority | ''; q: string }>({ priority: '', q: '' })
  const [col, setCol] = useState('col.overdue')
  const [showOff, setShowOff] = useState(false)

  const load = useCallback(async () => {
    const [p, o] = await Promise.all([
      supabase.from('employee_live_status').select('*').order('on_shift', { ascending: false }).order('full_name'),
      supabase.from('orders').select(ORDER_SELECT).in('status', OPEN_STATUSES).order('issued_at', { ascending: false }),
    ])
    if (p.data) setPeople(p.data as LiveEmployee[])
    if (o.data) setOrders(o.data as Order[])
  }, [])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh('master-board', ['orders', 'employees'], load)
  // просрочка наступает по времени, без события в БД — перерисовываем раз в 30 с
  useEffect(() => { const i = setInterval(load, 30_000); return () => clearInterval(i) }, [load])

  const toggleShift = async (p: LiveEmployee) => {
    await supabase.rpc('set_on_shift', { p_employee: p.id, p_on: !p.on_shift })
    load()
  }

  const shown = orders.filter((o) => (!filter.priority || o.priority === filter.priority) &&
    (!filter.q || `${o.equipment?.name} ${o.assignee?.full_name} ${o.description} ${o.number}`.toLowerCase().includes(filter.q.toLowerCase())))
  const overdue = shown.filter(isOverdue)
  const columns = [
    { key: 'col.overdue', items: overdue },
    ...BOARD_COLUMNS.map((c) => ({ key: c.key, items: shown.filter((o) => c.statuses.includes(o.status) && !isOverdue(o)) })),
  ]
  const onShift = people.filter((p) => p.on_shift)
  const visiblePeople = showOff ? people : onShift
  const current = columns.find((c) => c.key === col) ?? columns[0]

  return (
    <Layout title={t('board.title')} subtitle={t('board.subtitle', { free: onShift.filter((p) => p.live_status === 'free').length, all: onShift.length })}
            actions={<Link className="btn btn-primary" to="/master/new"><Icon name="plus" size={18} /> <span className="lbl">{t('board.new_short')}</span></Link>}>
      {created && <p className="banner ok"><Icon name="check" /> {t('board.created', { n: created })}</p>}

      <section className="counters">
        <div className="counter"><b>{orders.length}</b><span>{t('board.counters.open')}</span></div>
        <div className="counter danger"><b>{orders.filter(isOverdue).length}</b><span>{t('board.counters.overdue')}</span></div>
        <div className="counter"><b>{orders.filter((o) => ['done', 'ai_review'].includes(o.status)).length}</b><span>{t('board.counters.done')}</span></div>
        <div className="counter"><b>{orders.filter((o) => o.type === 'unplanned' && !['done', 'ai_review'].includes(o.status)).length}</b><span>{t('board.counters.downtime')}</span></div>
      </section>

      <h2>{t('board.people')}</h2>
      <div className="legend-row">
        <span><i className="dot live-free-dot" style={{ background: 'var(--ok)' }} />{t('live.free')}</span>
        <span><i className="dot" style={{ background: '#E8A33A' }} />{t('legend.busy')}</span>
        <span><i className="dot" style={{ background: 'var(--info)' }} />{t('legend.queue')}</span>
        <span><i className="dot" style={{ background: 'var(--border-strong)' }} />{t('live.off_shift')}</span>
        <span className="cap">{t('board.toggle_hint')}</span>
      </div>
      <section className="people">
        {visiblePeople.map((p) => (
          <button key={p.id} className={`person live-${p.live_status}`} onClick={() => toggleShift(p)} title={t('board.toggle_shift')}>
            <i className="dot" />
            <div>
              <div className="person-name">{p.full_name.split(' ').slice(0, 2).join(' ')}</div>
              <div className="muted">
                {p.specialty} · {t(`live.${p.live_status}`, { n: p.live_status === 'busy' ? p.current_order_number ?? '' : p.queue_count })}
                {p.live_status === 'busy' && p.queue_count > 0 && ` · +${p.queue_count}`}
              </div>
            </div>
          </button>
        ))}
      </section>
      {people.length > onShift.length && (
        <button className="btn btn-ghost btn-sm" onClick={() => setShowOff(!showOff)}>
          {showOff ? t('board.hide_off') : t('board.show_off', { n: people.length - onShift.length })}
        </button>
      )}

      <div className="filters">
        <input placeholder={t('board.search')} value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <select value={filter.priority} onChange={(e) => setFilter({ ...filter, priority: e.target.value as Priority | '' })}>
          <option value="">{t('board.all_priorities')}</option>
          {(['emergency', 'high', 'normal', 'planned'] as Priority[]).map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
        </select>
      </div>

      {/* desktop: канбан */}
      <section className="kanban">
        {columns.map((c) => (
          <div key={c.key} className={`kcol${c.key === 'col.overdue' ? ' kcol-danger' : ''}`}>
            <h3>{t(c.key)} <span className="count">{c.items.length}</span></h3>
            {c.items.length === 0 && <p className="cap center">{t('board.empty')}</p>}
            {c.items.map((o) => <OrderCard key={o.id} order={o} showAssignee href={`/order/${o.id}`} />)}
          </div>
        ))}
      </section>

      {/* телефон: вкладки колонок */}
      <div className="col-tabs" role="tablist">
        {columns.map((c) => (
          <button key={c.key} role="tab" aria-selected={current.key === c.key} className={`seg${current.key === c.key ? ' on' : ''}${c.key === 'col.overdue' && c.items.length ? ' danger' : ''}`} onClick={() => setCol(c.key)}>
            {t(c.key)} <span className="count">{c.items.length}</span>
          </button>
        ))}
      </div>
      <div className="col-list">
        {current.items.length === 0 && <div className="card"><Empty text={t('board.empty')} /></div>}
        {current.items.map((o) => <OrderCard key={o.id} order={o} showAssignee href={`/order/${o.id}`} />)}
      </div>
    </Layout>
  )
}
