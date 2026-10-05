import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { OrderCard } from '../../components/OrderCard'
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
    await supabase.from('employees').update({ on_shift: !p.on_shift }).eq('id', p.id)
    load()
  }

  const shown = orders.filter((o) => (!filter.priority || o.priority === filter.priority) &&
    (!filter.q || `${o.equipment?.name} ${o.assignee?.full_name} ${o.description} ${o.number}`.toLowerCase().includes(filter.q.toLowerCase())))
  const isOverdue = (o: Order) => (o.is_overdue || new Date(o.due_at) < new Date()) && !['done', 'ai_review'].includes(o.status)
  const overdue = shown.filter(isOverdue)
  const columns = [
    ...BOARD_COLUMNS.map((c) => ({ key: c.key, items: shown.filter((o) => c.statuses.includes(o.status)) })),
    { key: 'col.overdue', items: overdue },
  ]
  const onShift = people.filter((p) => p.on_shift)

  return (
    <Layout title={t('board.title')} actions={<Link className="btn btn-primary" to="/master/new">{t('board.new')}</Link>}>
      {created && <p className="banner ok">✔ {t('board.created', { n: created })}</p>}
      <section className="counters">
        <div className="counter"><b>{orders.length}</b><span>{t('board.counters.open')}</span></div>
        <div className="counter"><b>{orders.filter((o) => ['done', 'ai_review'].includes(o.status)).length}</b><span>{t('board.counters.done')}</span></div>
        <div className="counter danger"><b>{orders.filter(isOverdue).length}</b><span>{t('board.counters.overdue')}</span></div>
        <div className="counter"><b>{orders.filter((o) => o.type === 'unplanned' && !['done', 'ai_review'].includes(o.status)).length}</b><span>{t('board.counters.downtime')}</span></div>
      </section>

      <h2>{t('board.people')} <span className="muted">{onShift.filter((p) => p.live_status === 'free').length} {t('board.free_of')} {onShift.length}</span></h2>
      <section className="people">
        {people.map((p) => (
          <button key={p.id} className={`person live-${p.live_status}`} onClick={() => toggleShift(p)} title={t('board.toggle_shift')}>
            <i className="dot" />
            <div>
              <div className="person-name">{p.full_name}</div>
              <div className="muted">
                {p.specialty} · {t(`live.${p.live_status}`, { n: p.live_status === 'busy' ? p.current_order_number ?? '' : p.queue_count })}
                {p.live_status === 'busy' && p.queue_count > 0 && ` · ${t('live.queue', { n: p.queue_count })}`}
              </div>
            </div>
          </button>
        ))}
      </section>

      <div className="filters">
        <input placeholder={t('board.search')} value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <select value={filter.priority} onChange={(e) => setFilter({ ...filter, priority: e.target.value as Priority | '' })}>
          <option value="">{t('board.all_priorities')}</option>
          {(['emergency', 'high', 'normal', 'planned'] as Priority[]).map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
        </select>
      </div>

      <section className="kanban">
        {columns.map((c) => (
          <div key={c.key} className={`kcol${c.key === 'col.overdue' ? ' kcol-danger' : ''}`}>
            <h3>{t(c.key)} <span className="muted">{c.items.length}</span></h3>
            {c.items.length === 0 && <p className="muted">{t('board.empty')}</p>}
            {c.items.map((o) => <OrderCard key={o.id} order={o} showAssignee href={`/order/${o.id}`} />)}
          </div>
        ))}
      </section>
    </Layout>
  )
}
