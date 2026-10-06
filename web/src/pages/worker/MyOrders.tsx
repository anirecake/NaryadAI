import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { Empty } from '../../components/Inputs'
import { Layout } from '../../components/Layout'
import { OrderCard } from '../../components/OrderCard'
import { NEEDS_REASON, ORDER_SELECT, PRIMARY_ACTION, PRIORITY_ORDER, REASONS, WORKER_ACTIONS, type Order, type WorkerAction } from '../../lib/domain'
import { useAuth } from '../../lib/auth'
import { dt, fmt1 } from '../../lib/format'
import { useI18n } from '../../lib/i18n'
import { flushQueue, queuedCount, transition } from '../../lib/offline'
import { useRealtimeRefresh } from '../../lib/realtime'
import { supabase } from '../../lib/supabase'

interface Closed { id: number; number: number; closed_at: string; equipment: { name: string } | null; ai_reviews: { score: number; master_score: number | null; verdict: string }[] }

// Приложение исполнителя (п. 5.3): у каждого наряда одна главная кнопка — следующий шаг
export default function MyOrders() {
  const { employee } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<Order[]>([])
  const [closed, setClosed] = useState<Closed[]>([])
  const [askReason, setAskReason] = useState<{ order: Order; action: 'reject' | 'pause' } | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [pending, setPending] = useState(queuedCount())

  const load = useCallback(async () => {
    if (!employee) return
    const [open, done] = await Promise.all([
      supabase.from('orders').select(ORDER_SELECT).eq('assignee_id', employee.id)
        .in('status', ['issued', 'accepted', 'queued', 'in_progress', 'paused', 'rework', 'done', 'ai_review']),
      supabase.from('orders').select('id, number, closed_at, equipment(name), ai_reviews(score, master_score, verdict)')
        .eq('assignee_id', employee.id).eq('status', 'closed').order('closed_at', { ascending: false }).limit(10),
    ])
    // в работе — сверху, затем аварийные, затем по сроку
    const rank = (o: Order) => (o.status === 'in_progress' ? -1 : 0)
    setOrders(((open.data as Order[]) ?? []).sort((a, b) => rank(a) - rank(b) ||
      PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || a.due_at.localeCompare(b.due_at)))
    setClosed((done.data as unknown as Closed[]) ?? [])
    setPending(queuedCount())
  }, [employee])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(`worker-${employee?.id}`, ['orders'], load, employee ? `assignee_id=eq.${employee.id}` : undefined)
  useEffect(() => {
    const on = () => flushQueue().then(load)
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [load])

  const act = async (order: Order, action: WorkerAction, reason?: string) => {
    if (action === 'complete') return navigate(`/worker/close/${order.id}`)
    if (NEEDS_REASON.includes(action) && !reason) return setAskReason({ order, action: action as 'reject' | 'pause' })
    setBusy(order.id)
    const res = await transition(order.id, action, reason ?? null)
    setMsg(res.queued ? t('offline.queued') : res.error ?? '')
    setAskReason(null)
    await load()
    setBusy(null)
  }

  const active = orders.filter((o) => !['done', 'ai_review'].includes(o.status))
  const checking = orders.filter((o) => ['done', 'ai_review'].includes(o.status))

  return (
    <Layout title={t('worker.title')} subtitle={active.length ? t('worker.count', { n: active.length }) : undefined}>
      {!navigator.onLine && <p className="banner"><Icon name="alert" /> {t('offline.banner')}</p>}
      {pending > 0 && <p className="banner info"><Icon name="clock" /> {t('offline.pending', { n: pending })}</p>}
      {msg && <p className="banner">{msg}</p>}

      {active.length === 0 && <div className="card"><Empty text={t('worker.empty')} hint={t('worker.empty_hint')} /></div>}
      <div className="stack">
        {active.map((o) => {
          const primary = PRIMARY_ACTION[o.status]
          const rest = WORKER_ACTIONS[o.status].filter((a) => a !== primary)
          return (
            <OrderCard key={o.id} order={o} href={`/order/${o.id}`}>
              <div className="actions">
                {primary && (
                  <button className="btn btn-primary btn-xl" disabled={busy === o.id} onClick={() => act(o, primary)}>
                    {t(`action.${primary}`)}
                  </button>
                )}
                {rest.length > 0 && (
                  <div className="actions-secondary">
                    {rest.map((a) => (
                      <button key={a} className={`btn${a === 'reject' ? ' btn-danger' : ''}`} disabled={busy === o.id} onClick={() => act(o, a)}>{t(`action.${a}`)}</button>
                    ))}
                  </div>
                )}
              </div>
            </OrderCard>
          )
        })}
      </div>

      {checking.length > 0 && (
        <>
          <h2>{t('worker.on_check')}</h2>
          <div className="stack">
            {checking.map((o) => (
              <OrderCard key={o.id} order={o} href={`/order/${o.id}`}>
                {o.status === 'done' && <span className="pulse"><Icon name="sparkle" size={16} /> {t('ai.checking')}</span>}
              </OrderCard>
            ))}
          </div>
        </>
      )}

      {closed.length > 0 && (
        <>
          <h2>{t('worker.my_scores')}</h2>
          <div className="card list">
            {closed.map((c) => {
              const r = c.ai_reviews?.[c.ai_reviews.length - 1]
              return (
                <Link key={c.id} to={`/order/${c.id}`} className="list-row">
                  <span>№{c.number} · {c.equipment?.name}<br /><span className="cap">{dt(c.closed_at)}</span></span>
                  <b className="score">{r ? `${fmt1(r.master_score ?? r.score)}/5` : '—'}</b>
                </Link>
              )
            })}
          </div>
        </>
      )}

      {askReason && (
        <div className="sheet-backdrop" onClick={() => setAskReason(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{t('reason.title')}</h3>
            {REASONS[askReason.action].map((r) => (
              <button key={r} className="btn btn-xl" onClick={() => act(askReason.order, askReason.action, t(r))}>{t(r)}</button>
            ))}
            <button className="btn btn-ghost btn-xl" onClick={() => setAskReason(null)}>{t('reason.cancel')}</button>
          </div>
        </div>
      )}
    </Layout>
  )
}
