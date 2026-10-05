import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { useAuth } from '../lib/auth'
import { REASONS, WORKER_ACTIONS, type LiveEmployee, type OrderStatus, type Priority } from '../lib/domain'
import { dt, fmt1, hoursBetween } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { transition } from '../lib/offline'
import { photoUrl } from '../lib/photo'
import { useRealtimeRefresh } from '../lib/realtime'
import { supabase } from '../lib/supabase'

interface Full {
  id: number; number: number; type: string; priority: Priority; status: OrderStatus; description: string; comment: string | null
  due_at: string; issued_at: string; accepted_at: string | null; started_at: string | null; done_at: string | null; closed_at: string | null
  is_overdue: boolean; norm_hours: number | null; fault_code: string | null; work_done: string | null; close_comment: string | null
  assignee_id: string | null; rework_count: number
  equipment: { name: string; inv_no: string } | null; sites: { name: string } | null
  assignee: { full_name: string } | null; master: { full_name: string } | null; fault: { name: string } | null
}
interface Review {
  id: number; verdict: string; score: number; confidence: number; explanation: string; worker_report: string; master_report: string
  master_score: number | null; master_comment: string | null; created_at: string; checks: { issues?: string[]; remarks?: string[]; ai?: boolean }
}
interface Event { id: number; action: string; at: string; comment: string | null; reason: string | null; actor: { full_name: string } | null }

const SELECT = `*, equipment(name, inv_no), sites(name), fault:fault_codes(name),
  assignee:employees!orders_assignee_id_fkey(full_name), master:employees!orders_master_id_fkey(full_name)`

export default function OrderDetail() {
  const { id } = useParams()
  const orderId = Number(id)
  const { employee } = useAuth()
  const { t } = useI18n()
  const [o, setO] = useState<Full | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [photos, setPhotos] = useState<{ kind: string; url: string }[]>([])
  const [mats, setMats] = useState<{ qty: number; materials: { name: string; unit: string } }[]>([])
  const [people, setPeople] = useState<LiveEmployee[]>([])
  const [ask, setAsk] = useState<null | 'return' | 'reassign' | 'reject' | 'pause'>(null)
  const [score, setScore] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [a, r, e, p, m] = await Promise.all([
      supabase.from('orders').select(SELECT).eq('id', orderId).single(),
      supabase.from('ai_reviews').select('*').eq('order_id', orderId).order('id', { ascending: false }).limit(1),
      supabase.from('order_events').select('id, action, at, comment, reason, actor:employees(full_name)').eq('order_id', orderId).order('at'),
      supabase.from('photos').select('kind, storage_path').eq('order_id', orderId).order('uploaded_at'),
      supabase.from('material_writeoffs').select('qty, materials(name, unit)').eq('order_id', orderId),
    ])
    setO(a.data as unknown as Full)
    setReview(((r.data as Review[]) ?? [])[0] ?? null)
    setEvents((e.data as unknown as Event[]) ?? [])
    setMats((m.data as unknown as typeof mats) ?? [])
    setPhotos(await Promise.all(((p.data as { kind: string; storage_path: string }[]) ?? []).map(async (x) => ({ kind: x.kind, url: await photoUrl(x.storage_path) }))))
  }, [orderId])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(`order-${orderId}`, ['orders'], load, `id=eq.${orderId}`)
  useRealtimeRefresh(`order-review-${orderId}`, ['ai_reviews'], load, `order_id=eq.${orderId}`)

  const staff = employee && employee.role !== 'worker'
  const isMaster = employee && ['master', 'admin'].includes(employee.role)
  const mine = employee && o?.assignee_id === employee.id

  const act = async (action: string, extra: { reason?: string; payload?: Record<string, unknown>; comment?: string } = {}) => {
    setMsg('')
    const { error } = await supabase.rpc('transition_order', {
      p_order_id: orderId, p_action: action, p_reason: extra.reason ?? null, p_comment: extra.comment ?? null, p_payload: extra.payload ?? {},
    })
    if (error) setMsg(error.message)
    setAsk(null)
    setReason('')
    load()
  }
  const workerAct = async (action: string, r?: string) => {
    const res = await transition(orderId, action, r ?? null)
    setMsg(res.queued ? t('offline.queued') : res.error ?? '')
    setAsk(null)
    load()
  }
  const reassign = async (to: string) => {
    const { error } = await supabase.rpc('reassign_order', { p_order_id: orderId, p_assignee: to })
    if (error) setMsg(error.message)
    setAsk(null)
    load()
  }
  const openReassign = async () => {
    const { data } = await supabase.from('employee_live_status').select('*').eq('on_shift', true).order('full_name')
    setPeople((data as LiveEmployee[]) ?? [])
    setAsk('reassign')
  }

  if (!o) return <Layout title="…" back={staff ? '/master' : '/worker'}><p className="muted">…</p></Layout>

  const overdue = o.is_overdue && !['done', 'ai_review', 'closed', 'cancelled'].includes(o.status)
  const downtime = o.type === 'unplanned' ? hoursBetween(o.issued_at, o.done_at ?? new Date().toISOString()) : null
  const verdictTone = review ? { accepted: 'ok', accepted_with_remarks: 'warn', rework: 'danger', needs_master_review: 'info' }[review.verdict] : ''

  return (
    <Layout title={`${t('order.title')} №${o.number}`} back={staff ? '/master' : '/worker'}>
      <div className="detail-grid">
        <section className={`card order prio-${o.priority}${overdue ? ' overdue' : ''}`}>
          <div className="order-head">
            <span className={`badge prio-${o.priority}`}>{t(`priority.${o.priority}`)}</span>
            <span className={`badge st-${o.status}`}>{t(`status.${o.status}`)}</span>
            {overdue && <span className="badge prio-emergency">{t('worker.overdue')}</span>}
            {o.rework_count > 0 && <span className="badge">{t('order.rework_count')}: {o.rework_count}</span>}
          </div>
          <div className="order-eq">{o.equipment?.name} <span className="muted">· {o.sites?.name} · {o.equipment?.inv_no}</span></div>
          <p>{o.description}</p>
          {o.comment && <p className="muted">{o.comment}</p>}
          <dl className="kv">
            <dt>{t('order.assignee')}</dt><dd>{o.assignee?.full_name ?? '—'}</dd>
            <dt>{t('order.master')}</dt><dd>{o.master?.full_name ?? '—'}</dd>
            <dt>{t('worker.due')}</dt><dd className={overdue ? 'error' : ''}>{dt(o.due_at)}</dd>
            <dt>{t('form.norm')}</dt><dd>{o.norm_hours ? `${o.norm_hours} ч` : '—'}</dd>
            <dt>{t('order.fact')}</dt><dd>{fmt1(hoursBetween(o.started_at, o.done_at))} ч</dd>
            {downtime !== null && <><dt>{t('order.downtime')}</dt><dd>{fmt1(downtime)} ч</dd></>}
          </dl>

          {mine && WORKER_ACTIONS[o.status].length > 0 && (
            <div className="actions">
              {WORKER_ACTIONS[o.status].map((a) => a === 'complete'
                ? <Link key={a} className="btn btn-xl act-complete" to={`/worker/close/${o.id}`}>{t('action.complete')}</Link>
                : <button key={a} className={`btn btn-xl act-${a}`} onClick={() => (a === 'reject' || a === 'pause') ? setAsk(a) : workerAct(a)}>{t(`action.${a}`)}</button>)}
            </div>
          )}
          {isMaster && !['closed', 'cancelled'].includes(o.status) && (
            <div className="actions row-wrap">
              {['issued', 'accepted', 'queued', 'rejected', 'paused'].includes(o.status) && <button className="btn" onClick={openReassign}>{t('master.reassign')}</button>}
              {o.status !== 'ai_review' && (
                <select className="btn" value={o.priority} onChange={(e) => act('priority', { payload: { priority: e.target.value } })} aria-label={t('form.priority')}>
                  {(['emergency', 'high', 'normal', 'planned'] as Priority[]).map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
                </select>
              )}
              <button className="btn act-reject" onClick={() => confirm(t('master.cancel_confirm')) && act('cancel')}>{t('master.cancel')}</button>
            </div>
          )}
          {msg && <p className="error">{msg}</p>}
        </section>

        {/* Отчёт ИИ (п. 6.4): исполнителю — оценка и что улучшить, мастеру — полная картина */}
        <section className={`card ai-card ${verdictTone}`}>
          <h3>🤖 {t('ai.check')}</h3>
          {!review && o.status === 'done' && <p className="pulse">{t('ai.checking')}</p>}
          {!review && o.status !== 'done' && <p className="muted">{t('ai.not_yet')}</p>}
          {review && (
            <>
              <div className="verdict">
                <span className={`badge v-${review.verdict}`}>{t(`verdict.${review.verdict}`)}</span>
                <b className="score">{review.master_score ?? review.score}/5</b>
                {review.master_score != null && <span className="muted">({t('ai.master_changed')}, {t('ai.ai_score')} {review.score})</span>}
                <span className="muted">{t('ai.confidence')} {Math.round(review.confidence * 100)}%</span>
              </div>
              <p>{review.explanation}</p>
              <pre className="report">{staff ? review.master_report : review.worker_report}</pre>
              {staff && (review.checks.issues?.length || review.checks.remarks?.length) ? (
                <ul className="checks">
                  {review.checks.issues?.map((x) => <li key={x} className="error">✖ {x}</li>)}
                  {review.checks.remarks?.map((x) => <li key={x}>⚠ {x}</li>)}
                </ul>
              ) : null}
              {!review.checks.ai && <p className="muted small">{t('ai.rules_mode')}</p>}
            </>
          )}
          {isMaster && ['ai_review', 'done'].includes(o.status) && (
            <div className="actions">
              <div className="field">
                <span>{t('master.final_score')}</span>
                <div className="segmented">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button key={s} type="button" className={`seg${score === s ? ' on' : ''}`} onClick={() => setScore(score === s ? null : s)}>{s}</button>
                  ))}
                </div>
              </div>
              <button className="btn btn-xl act-accept" onClick={() => act('approve', { payload: score ? { master_score: score } : {}, comment: score ? t('master.score_changed') : undefined })}>
                ✔ {t('master.approve')}{score ? ` (${score}/5)` : ''}
              </button>
              <button className="btn btn-xl act-reject" onClick={() => setAsk('return')}>↩ {t('master.return')}</button>
            </div>
          )}
        </section>

        {photos.length > 0 && (
          <section className="card">
            <h3>{t('order.photos')}</h3>
            <div className="photo-compare">
              {(['before', 'after'] as const).map((k) => (
                <div key={k}>
                  <div className="muted">{t(`order.photo_${k}`)}</div>
                  <div className="photos">
                    {photos.filter((p) => p.kind === k).map((p) => <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="thumb big"><img src={p.url} alt="" /></a>)}
                    {!photos.some((p) => p.kind === k) && <span className="muted">—</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {(o.work_done || mats.length > 0) && (
          <section className="card">
            <h3>{t('close.work')}</h3>
            <p>{o.work_done}</p>
            {o.fault_code && <p><b>{o.fault_code}</b> {o.fault?.name}</p>}
            {mats.length > 0 && <ul>{mats.map((m, i) => <li key={i}>{m.materials.name} — {m.qty} {m.materials.unit}</li>)}</ul>}
            {o.close_comment && <p className="muted">{o.close_comment}</p>}
          </section>
        )}

        <section className="card">
          <h3>{t('order.timeline')}</h3>
          <ol className="timeline">
            {events.map((e) => (
              <li key={e.id}>
                <span className="muted">{dt(e.at)}</span> <b>{t(`event.${e.action}`)}</b>
                {e.actor ? ` — ${e.actor.full_name}` : e.action === 'ai_verdict' ? ' — ИИ' : ''}
                {(e.reason || e.comment) && <div className="muted">{e.reason ?? e.comment}</div>}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {(ask === 'return' || ask === 'reject' || ask === 'pause') && (
        <div className="sheet-backdrop" onClick={() => setAsk(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{t('reason.title')}</h3>
            {ask !== 'return' && REASONS[ask].map((r) => (
              <button key={r} className="btn btn-xl" onClick={() => workerAct(ask, t(r))}>{t(r)}</button>
            ))}
            {ask === 'return' && <>
              <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('master.return_ph')} />
              <button className="btn btn-primary btn-xl" disabled={!reason.trim()} onClick={() => act('return', { reason })}>{t('master.return')}</button>
            </>}
            <button className="btn btn-ghost btn-xl" onClick={() => setAsk(null)}>{t('reason.cancel')}</button>
          </div>
        </div>
      )}
      {ask === 'reassign' && (
        <div className="sheet-backdrop" onClick={() => setAsk(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{t('master.reassign')}</h3>
            <div className="pick-list scroll">
              {people.filter((p) => p.id !== o.assignee_id).map((p) => (
                <button key={p.id} className={`pick live-${p.live_status}`} onClick={() => reassign(p.id)}>
                  <b><i className="dot" /> {p.full_name}</b>
                  <span className="muted">{p.specialty} · {t(`live.${p.live_status}`, { n: p.live_status === 'busy' ? p.current_order_number ?? '' : p.queue_count })}</span>
                </button>
              ))}
            </div>
            <button className="btn btn-ghost btn-xl" onClick={() => setAsk(null)}>{t('reason.cancel')}</button>
          </div>
        </div>
      )}
    </Layout>
  )
}
