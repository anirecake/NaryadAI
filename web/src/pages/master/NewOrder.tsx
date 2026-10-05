import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PhotoPicker, QrScanner, Segmented, VoiceTextarea } from '../../components/Inputs'
import { Layout } from '../../components/Layout'
import { aiInsights, type Suggestion } from '../../lib/ai'
import { useAuth } from '../../lib/auth'
import type { LiveEmployee, Priority } from '../../lib/domain'
import { useI18n } from '../../lib/i18n'
import { uploadPhoto } from '../../lib/photo'
import { supabase } from '../../lib/supabase'

interface Site { id: number; name: string }
interface Equip { id: number; name: string; site_id: number; type: string; qr_code: string }
interface Candidate { employee_id: string; full_name: string; specialty: string; live_status: string; reason: string; score: number }

// Выдача наряда (п. 5.1). Цель ТЗ — ≤ 6 нажатий и ≤ 1 минута:
// QR → голос → приоритет → (исполнитель подставлен ИИ) → «Выдать».
export default function NewOrder() {
  const { t } = useI18n()
  const { employee } = useAuth()
  const navigate = useNavigate()
  const [sites, setSites] = useState<Site[]>([])
  const [equipment, setEquipment] = useState<Equip[]>([])
  const [people, setPeople] = useState<LiveEmployee[]>([])

  const [siteId, setSiteId] = useState<number | ''>('')
  const [equipmentId, setEquipmentId] = useState<number | ''>('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [assignee, setAssignee] = useState<string>('')
  const [manualPick, setManualPick] = useState(false)   // мастер выбрал сам — ИИ больше не меняет выбор
  const [hours, setHours] = useState<number | null>(null)
  const [customDue, setCustomDue] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [comment, setComment] = useState('')
  const [scan, setScan] = useState(false)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('sites').select('id, name').order('id'),
      supabase.from('equipment').select('id, name, site_id, type, qr_code').order('name'),
      supabase.from('employee_live_status').select('*').order('full_name'),
    ]).then(([s, e, p]) => {
      setSites((s.data as Site[]) ?? [])
      setEquipment((e.data as Equip[]) ?? [])
      setPeople((p.data as LiveEmployee[]) ?? [])
    })
  }, [])

  const eqList = useMemo(() => equipment.filter((e) => !siteId || e.site_id === siteId), [equipment, siteId])

  // ИИ: шифр и норматив по описанию (с задержкой, пока мастер диктует)
  useEffect(() => {
    if (description.trim().length < 8) return
    const timer = setTimeout(() => {
      aiInsights<{ suggestion: Suggestion | null }>({ kind: 'suggest_code', description, equipment_id: equipmentId || null })
        .then((r) => setSuggestion(r.suggestion)).catch(() => {})
    }, 700)
    return () => clearTimeout(timer)
  }, [description, equipmentId])

  // ИИ: подбор исполнителя — свободный, нужной специальности, с лучшей оценкой по этому типу оборудования
  useEffect(() => {
    if (!equipmentId) return
    supabase.rpc('suggest_assignees', { p_equipment_id: equipmentId, p_specialty: suggestion?.specialty ?? null, p_limit: 3 })
      .then(({ data }) => {
        const list = (data as Candidate[]) ?? []
        setCandidates(list)
        if (!manualPick) setAssignee(list[0]?.employee_id || '')
      })
  }, [equipmentId, suggestion?.specialty, manualPick])

  const pick = (id: string) => { setAssignee(id); setManualPick(true) }

  const onQr = (text: string) => {
    setScan(false)
    const eq = equipment.find((e) => e.qr_code === text.trim() || String(e.id) === text.replace(/\D/g, ''))
    if (eq) { setSiteId(eq.site_id); setEquipmentId(eq.id) } else setError(t('qr.unknown'))
  }

  const normHours = hours ?? suggestion?.norm_hours ?? (priority === 'emergency' ? 1 : 2)
  const canSubmit = equipmentId && description.trim() && assignee && !busy

  const submit = async () => {
    if (!canSubmit || !employee) return
    setBusy(true)
    setError('')
    const eq = equipment.find((e) => e.id === equipmentId)!
    const worker = people.find((p) => p.id === assignee)
    const { data, error } = await supabase.rpc('create_order', { p: {
      type: priority === 'planned' ? 'planned' : 'unplanned', priority, description: description.trim(),
      site_id: eq.site_id, equipment_id: eq.id, assignee_id: assignee, brigade_id: worker?.brigade_id ?? null,
      norm_hours: normHours, due_at: customDue ? new Date(customDue).toISOString() : null, comment: comment || null,
    } })
    if (error) { setBusy(false); setError(error.message); return }
    const order = data as { id: number; number: number }
    try {
      for (const f of photos) await uploadPhoto(order.id, 'before', f, employee.id)
    } catch (e) { setError(`${t('form.photo_error')}: ${(e as Error).message}`) }
    setBusy(false)
    navigate('/master', { state: { created: order.number } })
  }

  const liveLabel = (p: { live_status: string; queue_count?: number; current_order_number?: number | null }) =>
    t(`live.${p.live_status}`, { n: p.live_status === 'busy' ? p.current_order_number ?? '' : p.queue_count ?? 0 })

  return (
    <Layout title={t('order.new')} back="/master">
      <div className="form">
        <section className="field">
          <span>{t('form.equipment')}</span>
          <div className="row">
            <button type="button" className="btn btn-primary qr-btn" onClick={() => setScan(true)}>▦ {t('qr.scan')}</button>
            <select value={siteId} onChange={(e) => { setSiteId(e.target.value ? Number(e.target.value) : ''); setEquipmentId('') }}>
              <option value="">{t('form.site')}</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <select value={equipmentId} onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : ''
            setEquipmentId(id)
            const eq = equipment.find((x) => x.id === id)
            if (eq) setSiteId(eq.site_id)
          }}>
            <option value="">{t('form.choose_equipment')}</option>
            {eqList.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </section>

        <section className="field">
          <span>{t('form.description')}</span>
          <VoiceTextarea value={description} onChange={setDescription} placeholder={t('form.description_ph')} />
          {suggestion && (
            <div className="ai-hint">
              🤖 {t('form.ai_code')}: <b>{suggestion.code}</b> {suggestion.name} · {t('form.norm')} {suggestion.norm_hours} ч · {suggestion.specialty}
            </div>
          )}
        </section>

        <section className="field">
          <span>{t('form.priority')}</span>
          <Segmented value={priority} onChange={setPriority} options={[
            { value: 'emergency', label: t('priority.emergency'), tone: 'danger' },
            { value: 'high', label: t('priority.high'), tone: 'warn' },
            { value: 'normal', label: t('priority.normal') },
            { value: 'planned', label: t('priority.planned') },
          ]} />
        </section>

        <section className="field">
          <span>{t('form.assignee')}</span>
          {candidates.length > 0 && <div className="muted">🤖 {t('form.ai_assignee')}</div>}
          <div className="pick-list">
            {candidates.map((c, i) => (
              <button key={c.employee_id} type="button" className={`pick${assignee === c.employee_id ? ' on' : ''}`} onClick={() => pick(c.employee_id)}>
                <b>{i === 0 && '★ '}{c.full_name}</b>
                <span className="muted">{c.reason}</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => setShowAll(!showAll)}>{showAll ? '▲' : '▼'} {t('form.all_workers')}</button>
          {showAll && (
            <div className="pick-list">
              {people.map((p) => (
                <button key={p.id} type="button" disabled={!p.on_shift}
                        className={`pick live-${p.live_status}${assignee === p.id ? ' on' : ''}`} onClick={() => pick(p.id)}>
                  <b><i className="dot" /> {p.full_name}</b>
                  <span className="muted">{p.specialty} · {liveLabel(p)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="field">
          <span>{t('form.due')}</span>
          <Segmented value={String(hours ?? 'norm')} onChange={(v) => { setHours(v === 'norm' ? null : Number(v)); setCustomDue('') }} options={[
            { value: 'norm', label: `${t('form.by_norm')} ${suggestion?.norm_hours ?? normHours} ч` },
            { value: '1', label: '1 ч' }, { value: '2', label: '2 ч' }, { value: '4', label: '4 ч' }, { value: '8', label: '8 ч' },
          ]} />
          <input type="datetime-local" value={customDue} onChange={(e) => setCustomDue(e.target.value)} aria-label={t('form.due_exact')} />
        </section>

        <section className="field">
          <span>{t('form.photos_before')}</span>
          <PhotoPicker files={photos} onChange={setPhotos} max={5} />
        </section>

        <section className="field">
          <span>{t('form.comment')}</span>
          <input value={comment} onChange={(e) => setComment(e.target.value)} />
        </section>

        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-xl sticky-submit" disabled={!canSubmit} onClick={submit}>
          {busy ? t('form.sending') : t('form.issue')}
        </button>
      </div>
      {scan && <QrScanner onResult={onQr} onClose={() => setScan(false)} />}
    </Layout>
  )
}
