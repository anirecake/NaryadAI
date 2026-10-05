import { Fragment, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { HBars, WeeklyStack } from '../../components/Charts'
import { Segmented } from '../../components/Inputs'
import { Layout } from '../../components/Layout'
import { aiInsights, type FindingView } from '../../lib/ai'
import { downloadCsv, fmt1, periodRange, type PeriodKey } from '../../lib/format'
import { useI18n } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'

type Tab = 'dashboard' | 'shift' | 'rating' | 'anomalies' | 'materials' | 'downtime' | 'assistant'
const TABS: Tab[] = ['dashboard', 'shift', 'rating', 'anomalies', 'materials', 'downtime', 'assistant']

interface Rating { employee_id: string; full_name: string; specialty: string; brigade_id: number; orders: number; avg_score: number; on_time: number; clean: number; volume: number; unjustified_rejects: number; total: number }

function usePeriod(def: PeriodKey) {
  const [p, setP] = useState<PeriodKey>(def)
  const { t } = useI18n()
  const control = (
    <Segmented value={p} onChange={setP} options={(['shift', 'day', 'week', 'month', 'quarter'] as PeriodKey[]).map((k) => ({ value: k, label: t(`period.${k}`) }))} />
  )
  return { period: p, range: periodRange(p), control }
}

function ExportBar({ name, rows }: { name: string; rows: Record<string, unknown>[] }) {
  const { t } = useI18n()
  return (
    <div className="row-wrap no-print">
      <button className="btn" onClick={() => downloadCsv(name, rows)}>⬇ Excel (CSV)</button>
      <button className="btn" onClick={() => window.print()}>🖨 PDF</button>
      <span className="muted small">{t('panel.export_hint')}</span>
    </div>
  )
}

// ───── Дашборд руководителя ─────
function Dashboard() {
  const { t } = useI18n()
  const [k, setK] = useState<Record<string, any> | null>(null)
  const [best, setBest] = useState<Rating[]>([])
  useEffect(() => {
    supabase.rpc('dashboard_kpis', { p_days: 92 }).then(({ data }) => setK(data))
    supabase.rpc('worker_rating', { p_from: new Date(Date.now() - 92 * 864e5).toISOString(), p_to: new Date().toISOString() })
      .then(({ data }) => setBest(((data as Rating[]) ?? []).slice(0, 5)))
  }, [])
  if (!k) return <p className="muted">…</p>
  return (
    <>
      <section className="counters wide">
        <div className="counter"><b>{k.in_work}</b><span>{t('kpi.in_work')}</span></div>
        <div className="counter danger"><b>{k.overdue_now}</b><span>{t('kpi.overdue')}</span></div>
        <div className="counter"><b>{fmt1(k.avg_reaction_min)} мин</b><span>{t('kpi.reaction')}</span></div>
        <div className="counter"><b>{fmt1(k.avg_exec_h)} ч</b><span>{t('kpi.exec')}</span></div>
        <div className="counter"><b>{Math.round((k.on_time ?? 0) * 100)}%</b><span>{t('kpi.on_time')}</span></div>
        <div className="counter"><b>{k.downtime_h} ч</b><span>{t('kpi.downtime')}</span></div>
      </section>
      <div className="grid-2">
        <section className="card">
          <h3>{t('kpi.top_equipment')}</h3>
          <HBars data={(k.top_equipment ?? []).map((e: any) => ({ label: e.equipment, value: e.unplanned, note: `простой ${e.downtime_h} ч` }))} />
        </section>
        <section className="card">
          <h3>{t('kpi.best')}</h3>
          <HBars data={best.map((b) => ({ label: b.full_name.split(' ').slice(0, 2).join(' '), value: Number(b.total) }))} max={100} />
        </section>
      </div>
      <section className="card">
        <h3>{t('kpi.weekly')}</h3>
        <WeeklyStack data={k.weekly ?? []} />
      </section>
    </>
  )
}

// ───── Отчёт за смену / период ─────
function Shift() {
  const { t } = useI18n()
  const { range, control, period } = usePeriod('shift')
  const [r, setR] = useState<Record<string, any> | null>(null)
  const [summary, setSummary] = useState('')
  useEffect(() => {
    setR(null); setSummary('')
    supabase.rpc('shift_report', { p_from: range.from, p_to: range.to }).then(({ data }) => setR(data))
    aiInsights<{ text: string }>({ kind: 'shift_summary', ...range }).then((x) => setSummary(x.text)).catch(() => {})
  }, [period]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="no-print">{control}</div>
      {!r ? <p className="muted">…</p> : (
        <>
          <section className="card ai-card">
            <h3>🤖 {t('shift.summary')}</h3>
            <p>{summary || <span className="pulse">{t('ai.thinking')}</span>}</p>
          </section>
          <section className="counters wide">
            <div className="counter"><b>{r.issued}</b><span>{t('shift.issued')}</span></div>
            <div className="counter"><b>{r.done}</b><span>{t('shift.done')}</span></div>
            <div className="counter danger"><b>{r.overdue}</b><span>{t('shift.overdue')}</span></div>
            <div className="counter"><b>{r.rejected}</b><span>{t('shift.rejected')}</span></div>
            <div className="counter"><b>{r.rework}</b><span>{t('shift.rework')}</span></div>
            <div className="counter"><b>{r.downtime_h} ч</b><span>{t('kpi.downtime')}</span></div>
          </section>
          <section className="card">
            <h3>{t('shift.load')}</h3>
            <HBars data={(r.load ?? []).map((x: any) => ({ label: x.employee.split(' ').slice(0, 2).join(' '), value: Number(x.hours), note: `${x.orders} нарядов` }))} unit=" ч" />
          </section>
          <ExportBar name={`smena-${range.from.slice(0, 10)}`} rows={(r.load ?? []).map((x: any) => ({ сотрудник: x.employee, нарядов: x.orders, часов: x.hours }))} />
        </>
      )}
    </>
  )
}

// ───── Рейтинг исполнителей и бригад (п. 6.6) ─────
function RatingTab() {
  const { t } = useI18n()
  const { range, control, period } = usePeriod('quarter')
  const [rows, setRows] = useState<Rating[]>([])
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    supabase.rpc('worker_rating', { p_from: range.from, p_to: range.to }).then(({ data }) => setRows((data as Rating[]) ?? []))
  }, [period]) // eslint-disable-line react-hooks/exhaustive-deps
  const brigades = [1, 2, 3].map((b) => {
    const xs = rows.filter((r) => r.brigade_id === b)
    const n = xs.reduce((a, x) => a + x.orders, 0)
    return { label: `Бригада №${b}`, value: n ? Math.round(xs.reduce((a, x) => a + Number(x.total) * x.orders, 0) / n) : 0 }
  })
  const pct = (x: number) => `${Math.round(Number(x) * 100)}%`
  return (
    <>
      <div className="no-print">{control}</div>
      <section className="card">
        <h3>{t('rating.formula_title')}</h3>
        <p className="muted">{t('rating.formula')}</p>
      </section>
      <div className="grid-2">
        <section className="card">
          <h3>{t('rating.workers')}</h3>
          <HBars data={rows.map((r) => ({ label: r.full_name.split(' ').slice(0, 2).join(' '), value: Number(r.total) }))} max={100} />
        </section>
        <section className="card">
          <h3>{t('rating.brigades')}</h3>
          <HBars data={brigades} max={100} />
        </section>
      </div>
      <section className="card table-wrap">
        <table>
          <thead><tr><th>{t('rating.worker')}</th><th>{t('rating.total')}</th><th>{t('rating.quality')}</th><th>{t('rating.on_time')}</th><th>{t('rating.clean')}</th><th>{t('rating.volume')}</th><th>{t('rating.orders')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.employee_id}>
                <tr className="clickable" onClick={() => setOpen(open === r.employee_id ? null : r.employee_id)}>
                  <td>{r.full_name}<div className="muted small">{r.specialty} · бр. {r.brigade_id}</div></td>
                  <td><b>{r.total}</b></td><td>{r.avg_score}</td><td>{pct(r.on_time)}</td><td>{pct(r.clean)}</td><td>{pct(r.volume)}</td><td>{r.orders}</td>
                </tr>
                {open === r.employee_id && (
                  <tr><td colSpan={7} className="explain">
                    🤖 {t('rating.explain', {
                      q: Math.round(35 * r.avg_score / 5), qs: r.avg_score, ot: Math.round(25 * r.on_time), otp: pct(r.on_time),
                      c: Math.round(20 * r.clean), cp: pct(r.clean), v: Math.round(15 * r.volume), d: Math.round(5 * Math.max(0, 1 - r.unjustified_rejects / r.orders * 5)),
                    })}
                    {Number(r.clean) < 0.7 && ` ${t('rating.advice_clean')}`}
                    {Number(r.on_time) < 0.85 && ` ${t('rating.advice_time')}`}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>
      <ExportBar name="rating" rows={rows.map((r) => ({ ...r, employee_id: undefined }))} />
    </>
  )
}

// ───── Аномалии и рекомендации ИИ (п. 6.5) ─────
function Anomalies() {
  const { t } = useI18n()
  const [items, setItems] = useState<FindingView[] | null>(null)
  const [ai, setAi] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    aiInsights<{ ai: boolean; findings: FindingView[] }>({ kind: 'anomalies' })
      .then((r) => { setItems(r.findings); setAi(r.ai) }).catch((e) => setErr(e.message))
  }, [])
  if (err) return <p className="error">{err}</p>
  if (!items) return <p className="pulse">🤖 {t('anomaly.loading')}</p>
  return (
    <>
      <p className="muted">{t('anomaly.intro')} {!ai && t('ai.rules_mode')}</p>
      <div className="stack">
        {items.map((f, i) => (
          <section key={i} className={`card finding ${f.severity}`}>
            <div className="order-head"><span className="badge">{t(`anomaly.${f.kind}`)}</span><b>{f.title}</b></div>
            <p>{f.conclusion}</p>
            {f.recommendation && <p>👉 <b>{f.recommendation}</b></p>}
            {Array.isArray(f.facts.weekly) && (
              <HBars data={(f.facts.weekly as number[]).map((v, w) => ({ label: `нед. ${w + 1}`, value: v }))} />
            )}
          </section>
        ))}
      </div>
      <ExportBar name="anomalies" rows={items.map((f) => ({ тип: t(`anomaly.${f.kind}`), объект: f.subject, вывод: f.conclusion, рекомендация: f.recommendation ?? '' }))} />
    </>
  )
}

function Materials() {
  const { t } = useI18n()
  const { range, control, period } = usePeriod('quarter')
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { supabase.rpc('materials_report', { p_from: range.from, p_to: range.to }).then(({ data }) => setRows(data ?? [])) }, [period]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="no-print">{control}</div>
      <section className="card table-wrap">
        <table>
          <thead><tr><th>{t('mat.material')}</th><th>{t('mat.qty')}</th><th>{t('mat.norm')}</th><th>{t('mat.ratio')}</th><th>{t('mat.orders')}</th><th>{t('mat.top_brigade')}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.material}><td>{r.material}</td><td>{r.qty} {r.unit}</td><td>{r.norm_qty ?? '—'}</td>
              <td className={r.ratio > 1.15 ? 'error' : ''}>{r.ratio ? `×${r.ratio}` : '—'}</td><td>{r.orders}</td>
              <td className={r.brigade_ratio > 1.25 ? 'error' : ''}>{r.top_brigade ? `${r.top_brigade} ×${r.brigade_ratio}` : '—'}</td></tr>
          ))}</tbody>
        </table>
      </section>
      <ExportBar name="materials" rows={rows} />
    </>
  )
}

function Downtime() {
  const { t } = useI18n()
  const { range, control, period } = usePeriod('quarter')
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { supabase.rpc('downtime_report', { p_from: range.from, p_to: range.to }).then(({ data }) => setRows(data ?? [])) }, [period]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="no-print">{control}</div>
      <section className="card">
        <h3>{t('down.title')}</h3>
        <HBars data={rows.slice(0, 10).map((r) => ({ label: r.equipment, value: Number(r.downtime_h), note: `${r.unplanned} отказов` }))} unit=" ч" />
      </section>
      <section className="card table-wrap">
        <table>
          <thead><tr><th>{t('form.equipment')}</th><th>{t('form.site')}</th><th>{t('down.unplanned')}</th><th>{t('down.planned')}</th><th>{t('down.hours')}</th><th>{t('down.code')}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.equipment}><td>{r.equipment}</td><td>{r.site}</td><td>{r.unplanned}</td><td>{r.planned}</td><td>{r.downtime_h}</td><td>{r.top_code ?? '—'} {r.top_category ? `(${r.top_category})` : ''}</td></tr>
          ))}</tbody>
        </table>
      </section>
      <ExportBar name="downtime" rows={rows} />
    </>
  )
}

// ───── ИИ-ассистент мастера (бонус п. 6.7) ─────
function Assistant() {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [log, setLog] = useState<{ q: string; a: string }[]>([])
  const [busy, setBusy] = useState(false)
  const ask = async (question: string) => {
    if (!question.trim()) return
    setBusy(true)
    setQ('')
    try {
      const r = await aiInsights<{ text: string }>({ kind: 'assistant', question })
      setLog((l) => [{ q: question, a: r.text }, ...l])
    } catch (e) { setLog((l) => [{ q: question, a: (e as Error).message }, ...l]) }
    setBusy(false)
  }
  return (
    <>
      <div className="chips">
        {[t('asst.q1'), t('asst.q2'), t('asst.q3')].map((x) => <button key={x} className="chip" onClick={() => ask(x)}>{x}</button>)}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('asst.ph')} />
        <button className="btn btn-primary" disabled={busy}>{busy ? '…' : t('asst.ask')}</button>
      </form>
      <div className="stack">
        {log.map((x, i) => (
          <section key={i} className="card"><b>{x.q}</b><pre className="report">{x.a}</pre></section>
        ))}
      </div>
    </>
  )
}

export default function Panel() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'dashboard'
  return (
    <Layout title={t('panel.title')}>
      <nav className="subtabs no-print">
        {TABS.map((x) => <button key={x} className={`seg${tab === x ? ' on' : ''}`} onClick={() => setParams({ tab: x })}>{t(`panel.${x}`)}</button>)}
        <Link to="/qr" className="seg">▦ QR</Link>
      </nav>
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'shift' && <Shift />}
      {tab === 'rating' && <RatingTab />}
      {tab === 'anomalies' && <Anomalies />}
      {tab === 'materials' && <Materials />}
      {tab === 'downtime' && <Downtime />}
      {tab === 'assistant' && <Assistant />}
    </Layout>
  )
}
