import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { PhotoPicker, VoiceTextarea } from '../../components/Inputs'
import { Layout } from '../../components/Layout'
import { aiInsights, type Suggestion } from '../../lib/ai'
import { useAuth } from '../../lib/auth'
import { ORDER_SELECT, type Order } from '../../lib/domain'
import { useI18n } from '../../lib/i18n'
import { uploadPhoto } from '../../lib/photo'
import { supabase } from '../../lib/supabase'

interface Code { code: string; name: string; category: string }
interface Material { id: number; name: string; unit: string }
interface Norm { fault_code: string; material_id: number; typical_qty: number }

// Форма закрытия наряда (п. 5.3.3): работы, шифр, материалы, фото «после», комментарий.
// После отправки наряд уходит на ИИ-проверку (триггер в БД).
export default function CloseOrder() {
  const { id } = useParams()
  const { t } = useI18n()
  const { employee } = useAuth()
  const navigate = useNavigate()
  const [order, setOrder] = useState<Order | null>(null)
  const [codes, setCodes] = useState<Code[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [norms, setNorms] = useState<Norm[]>([])

  const [work, setWork] = useState('')
  const [code, setCode] = useState('')
  const [qty, setQty] = useState<Record<number, number>>({})
  const [search, setSearch] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [comment, setComment] = useState('')
  const [hint, setHint] = useState<Suggestion | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmNoPhoto, setConfirmNoPhoto] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('orders').select(ORDER_SELECT).eq('id', Number(id)).single(),
      supabase.from('fault_codes').select('code, name, category').order('code'),
      supabase.from('materials').select('id, name, unit').order('name'),
      supabase.from('material_norms').select('*'),
    ]).then(([o, c, m, n]) => {
      setOrder(o.data as Order)
      setCodes((c.data as Code[]) ?? [])
      setMaterials((m.data as Material[]) ?? [])
      setNorms((n.data as Norm[]) ?? [])
      const prev = o.data as Order & { fault_code?: string; work_done?: string }
      if (prev?.fault_code) setCode(prev.fault_code)
      if (prev?.work_done) setWork(prev.work_done)
    })
  }, [id])

  // ИИ-подсказка шифра по описанию проблемы и выполненным работам
  useEffect(() => {
    if (!order) return
    const timer = setTimeout(() => {
      aiInsights<{ suggestion: Suggestion | null }>({ kind: 'suggest_code', description: `${order.description}. ${work}`, equipment_id: order.equipment_id })
        .then((r) => { setHint(r.suggestion); setCode((c) => c || r.suggestion?.code || '') }).catch(() => {})
    }, work ? 800 : 0)
    return () => clearTimeout(timer)
  }, [order, work])

  const typical = useMemo(() => norms.filter((n) => n.fault_code === code), [norms, code])
  const found = useMemo(() => search.trim().length < 2 ? [] :
    materials.filter((m) => m.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8), [materials, search])
  const mat = (mid: number) => materials.find((m) => m.id === mid)
  const setQ = (mid: number, v: number) => setQty((q) => {
    const next = { ...q }
    if (v <= 0) delete next[mid]; else next[mid] = Math.round(v * 10) / 10
    return next
  })
  const step = (mid: number) => (mat(mid)?.unit === 'шт' ? 1 : 0.5)

  const unplanned = order?.type === 'unplanned'
  const submit = async (force = false) => {
    if (!order || !employee) return
    if (unplanned && photos.length === 0 && !force) { setConfirmNoPhoto(true); return }
    setConfirmNoPhoto(false)
    setBusy(true)
    setError('')
    try {
      // сначала фото — ИИ-проверка стартует сразу после «Исполнено»
      for (const f of photos) await uploadPhoto(order.id, 'after', f, employee.id)
      const { error } = await supabase.rpc('transition_order', {
        p_order_id: order.id, p_action: 'complete', p_comment: comment || null,
        p_payload: { work_done: work.trim(), fault_code: code || null, close_comment: comment || null,
                     materials: Object.entries(qty).map(([material_id, q]) => ({ material_id: Number(material_id), qty: q })) },
      })
      if (error) throw error
      navigate(`/order/${order.id}`, { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  if (!order) return <Layout title={t('action.complete')} back="/worker"><p className="muted">…</p></Layout>

  const matCount = Object.keys(qty).length
  return (
    <Layout title={`${t('close.title')} №${order.number}`} subtitle={`${order.equipment?.name} · ${order.description}`} back="/worker">
      <div className="form">
        {/* 1. Что сделано */}
        <section className="step-card">
          <div className="step-head"><span className={`step-num${work.trim() ? ' done' : ''}`}>{work.trim() ? <Icon name="check" size={16} /> : 1}</span>{t('close.step1')}</div>
          <VoiceTextarea value={work} onChange={setWork} placeholder={t('close.work_ph')} />
          <div className="field">
            <span>{t('close.code')}</span>
            {hint && <div className="ai-hint"><Icon name="sparkle" size={18} /><span>{t('form.ai_code')}: <b>{hint.code}</b> {hint.name}</span></div>}
            <select value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">—</option>
              {codes.map((c) => <option key={c.code} value={c.code}>{c.code} {c.name}</option>)}
            </select>
          </div>
        </section>

        {/* 2. Материалы */}
        <section className="step-card">
          <div className="step-head"><span className={`step-num${matCount ? ' done' : ''}`}>{matCount ? <Icon name="check" size={16} /> : 2}</span>{t('close.step2')}</div>
          {typical.length > 0 && <span className="hint">{t('close.typical_hint')}</span>}
          {typical.length > 0 && (
            <div className="chips">
              {typical.filter((n) => !qty[n.material_id]).map((n) => (
                <button key={n.material_id} type="button" className="chip" onClick={() => setQ(n.material_id, Number(n.typical_qty))}>
                  + {mat(n.material_id)?.name} · {Number(n.typical_qty)} {mat(n.material_id)?.unit}
                </button>
              ))}
            </div>
          )}
          {Object.entries(qty).map(([mid, q]) => (
            <div key={mid} className="mat-row">
              <span>{mat(Number(mid))?.name}</span>
              <div className="stepper">
                <button type="button" className="btn" aria-label="−" onClick={() => setQ(Number(mid), q - step(Number(mid)))}>−</button>
                <b>{q} {mat(Number(mid))?.unit}</b>
                <button type="button" className="btn" aria-label="+" onClick={() => setQ(Number(mid), q + step(Number(mid)))}>+</button>
              </div>
            </div>
          ))}
          <input placeholder={t('close.search_material')} value={search} onChange={(e) => setSearch(e.target.value)} />
          {found.map((m) => (
            <button key={m.id} type="button" className="pick" onClick={() => { setQ(m.id, qty[m.id] ?? 1); setSearch('') }}>
              <b>+ {m.name}</b><span className="muted">{m.unit}</span>
            </button>
          ))}
        </section>

        {/* 3. Фото результата */}
        <section className="step-card">
          <div className="step-head"><span className={`step-num${photos.length ? ' done' : ''}`}>{photos.length ? <Icon name="check" size={16} /> : 3}</span>{t('close.step3')}{unplanned && <span className="badge prio-high">{t('close.required')}</span>}</div>
          <span className="hint">{t('close.photo_hint')}</span>
          <PhotoPicker files={photos} onChange={setPhotos} max={3} cameraOnly />
          <div className="field">
            <span>{t('form.comment')}</span>
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('close.comment_ph')} />
          </div>
        </section>

        {error && <p className="banner">{error}</p>}
        <button className="btn btn-primary btn-xl sticky-submit" disabled={busy || !work.trim()} onClick={() => submit()}>
          {busy ? t('form.sending') : work.trim() ? t('close.submit') : t('close.fill_hint')}
        </button>
      </div>

      {confirmNoPhoto && (
        <div className="sheet-backdrop" onClick={() => setConfirmNoPhoto(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{t('close.no_photo_title')}</h3>
            <p className="muted">{t('close.no_photo_text')}</p>
            <button className="btn btn-primary btn-xl" onClick={() => setConfirmNoPhoto(false)}><Icon name="camera" /> {t('close.add_photo')}</button>
            <button className="btn btn-xl" onClick={() => submit(true)}>{t('close.send_anyway')}</button>
          </div>
        </div>
      )}
    </Layout>
  )
}
