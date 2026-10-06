import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Empty, Segmented } from '../../components/Inputs'
import { Layout } from '../../components/Layout'
import type { Role } from '../../lib/domain'
import { useI18n } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'

interface Person {
  id: string; tab_no: string; full_name: string; specialty: string; grade: number | null
  brigade_id: number | null; role: Role; shift: string | null; active: boolean
}
interface Brigade { id: number; name: string }

const SPECIALTIES = ['слесарь', 'слесарь-гидравлик', 'электрик', 'сварщик', 'мастер смены', 'главный механик', 'администратор']
const ROLE_PREFIX: Record<Role, string> = { worker: '3', master: '1', manager: '2', admin: '9' }
const randomPin = () => String(Math.floor(100000 + Math.random() * 900000))

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-employees', { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const msg = ctx ? (await ctx.json().catch(() => null))?.error : null
    throw new Error(msg ?? error.message)
  }
  return data
}

// Кабинет администратора предприятия: сотрудники, роли, ПИН-коды, увольнение
export default function People() {
  const { t } = useI18n()
  const [people, setPeople] = useState<Person[]>([])
  const [brigades, setBrigades] = useState<Brigade[]>([])
  const [q, setQ] = useState('')
  const [role, setRole] = useState<Role | 'all'>('all')
  const [showFired, setShowFired] = useState(false)
  const [edit, setEdit] = useState<Partial<Person> & { pin?: string } | null>(null)
  const [done, setDone] = useState<{ name: string; tab: string; pin: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const [p, b] = await Promise.all([
      supabase.from('employees').select('id, tab_no, full_name, specialty, grade, brigade_id, role, shift, active').order('role').order('full_name'),
      supabase.from('brigades').select('id, name').order('id'),
    ])
    setPeople((p.data as Person[]) ?? [])
    setBrigades((b.data as Brigade[]) ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => people.filter((p) => (showFired || p.active) && (role === 'all' || p.role === role) &&
    (!q || `${p.full_name} ${p.tab_no} ${p.specialty}`.toLowerCase().includes(q.toLowerCase()))), [people, q, role, showFired])

  const nextTab = (r: Role) => {
    const used = new Set(people.map((p) => p.tab_no))
    for (let n = Number(ROLE_PREFIX[r] + '001'); ; n++) if (!used.has(String(n))) return String(n)
  }

  const openNew = () => {
    setErr('')
    setEdit({ role: 'worker', tab_no: nextTab('worker'), specialty: 'слесарь', grade: 4, brigade_id: brigades[0]?.id ?? null, pin: randomPin() })
  }

  const save = async () => {
    if (!edit) return
    setBusy(true)
    setErr('')
    try {
      if (!edit.id) {
        await call({ action: 'create', pin: edit.pin, employee: { ...edit, on_shift: true } })
        setDone({ name: edit.full_name ?? '', tab: edit.tab_no ?? '', pin: edit.pin ?? '' })
      } else {
        await call({ action: 'update', employee_id: edit.id, fields: {
          full_name: edit.full_name, specialty: edit.specialty, grade: edit.grade, brigade_id: edit.brigade_id, role: edit.role, shift: edit.shift } })
        if (edit.pin) {
          await call({ action: 'reset_pin', employee_id: edit.id, pin: edit.pin })
          setDone({ name: edit.full_name ?? '', tab: edit.tab_no ?? '', pin: edit.pin })
        }
      }
      setEdit(null)
      load()
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }

  const setActive = async (p: Partial<Person>, active: boolean) => {
    if (!active && !confirm(t('admin.fire_confirm', { name: p.full_name ?? '' }))) return
    setBusy(true)
    try { await call({ action: 'set_active', employee_id: p.id, active }); setEdit(null); load() } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }

  const counts = (r: Role) => people.filter((p) => p.active && p.role === r).length

  return (
    <Layout title={t('admin.people')} subtitle={t('admin.people_sub', { w: counts('worker'), m: counts('master') })}
            actions={<button className="btn btn-primary" onClick={openNew}><Icon name="plus" size={18} /> <span className="lbl">{t('admin.add')}</span></button>}>
      {done && (
        <div className="banner ok">
          <Icon name="key" />
          <span>{t('admin.created', { name: done.name, tab: done.tab })} <b className="pin-show">{done.pin}</b>. {t('admin.created_hint')}</span>
          <button className="btn btn-ghost btn-icon" aria-label="OK" onClick={() => setDone(null)}><Icon name="x" size={18} /></button>
        </div>
      )}

      <div className="filters">
        <input placeholder={t('admin.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value as Role | 'all')}>
          <option value="all">{t('admin.all_roles')}</option>
          {(['worker', 'master', 'manager', 'admin'] as Role[]).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
        </select>
      </div>
      <label className="check"><input type="checkbox" checked={showFired} onChange={(e) => setShowFired(e.target.checked)} /> {t('admin.show_fired')}</label>

      <section className="card table-wrap" style={{ marginTop: 12 }}>
        {shown.length === 0 ? <Empty icon="users" text={t('admin.nobody')} /> : (
          <table>
            <thead><tr><th>{t('admin.name')}</th><th>{t('admin.tab')}</th><th>{t('admin.role')}</th><th>{t('admin.specialty')}</th><th>{t('admin.brigade')}</th><th /></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className={`clickable${p.active ? '' : ' inactive'}`} onClick={() => { setErr(''); setEdit({ ...p }) }}>
                  <td><b>{p.full_name}</b>{!p.active && <div className="cap">{t('admin.fired')}</div>}</td>
                  <td>{p.tab_no}</td>
                  <td>{t(`role.${p.role}`)}</td>
                  <td>{p.specialty}{p.grade ? `, ${p.grade} ${t('admin.grade_short')}` : ''}</td>
                  <td>{brigades.find((b) => b.id === p.brigade_id)?.name ?? '—'}</td>
                  <td><Icon name="chevron" size={18} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {edit && (
        <div className="sheet-backdrop" onClick={() => setEdit(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{edit.id ? edit.full_name : t('admin.new_person')}</h3>
            <label className="field"><span>{t('admin.name')}</span>
              <input value={edit.full_name ?? ''} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} placeholder="Фамилия Имя Отчество" autoFocus={!edit.id} />
            </label>
            <div className="field"><span>{t('admin.role')}</span>
              <Segmented value={edit.role ?? 'worker'} onChange={(r) => setEdit({ ...edit, role: r, ...(edit.id ? {} : { tab_no: nextTab(r) }),
                specialty: r === 'worker' ? 'слесарь' : r === 'master' ? 'мастер смены' : r === 'manager' ? 'главный механик' : 'администратор' })}
                options={(['worker', 'master', 'manager', 'admin'] as Role[]).map((r) => ({ value: r, label: t(`role.${r}`) }))} />
            </div>
            <div className="row">
              <label className="field" style={{ flex: 1 }}><span>{t('admin.tab')}</span>
                <input value={edit.tab_no ?? ''} inputMode="numeric" disabled={Boolean(edit.id)} onChange={(e) => setEdit({ ...edit, tab_no: e.target.value.replace(/\D/g, '') })} />
              </label>
              {edit.role === 'worker' && (
                <label className="field" style={{ flex: 1 }}><span>{t('admin.grade')}</span>
                  <select value={edit.grade ?? ''} onChange={(e) => setEdit({ ...edit, grade: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">—</option>{[2, 3, 4, 5, 6].map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
              )}
            </div>
            <label className="field"><span>{t('admin.specialty')}</span>
              <select value={edit.specialty ?? ''} onChange={(e) => setEdit({ ...edit, specialty: e.target.value })}>
                {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {edit.role === 'worker' && (
              <label className="field"><span>{t('admin.brigade')}</span>
                <select value={edit.brigade_id ?? ''} onChange={(e) => setEdit({ ...edit, brigade_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option>{brigades.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
            <div className="field"><span>{edit.id ? t('admin.new_pin') : t('admin.pin')}</span>
              <div className="row">
                <input value={edit.pin ?? ''} inputMode="numeric" maxLength={6} placeholder={edit.id ? t('admin.pin_keep') : '000000'}
                       onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
                <button type="button" className="btn" onClick={() => setEdit({ ...edit, pin: randomPin() })}><Icon name="key" size={18} /> {t('admin.gen_pin')}</button>
              </div>
            </div>
            {err && <p className="banner">{err}</p>}
            <button className="btn btn-primary btn-xl" disabled={busy || !edit.full_name?.trim() || (!edit.id && (edit.pin?.length ?? 0) !== 6) || (Boolean(edit.pin) && edit.pin!.length !== 6)} onClick={save}>
              {busy ? t('form.sending') : edit.id ? t('admin.save') : t('admin.create')}
            </button>
            {edit.id && (edit.active
              ? <button className="btn btn-danger" disabled={busy} onClick={() => setActive(edit, false)}>{t('admin.fire')}</button>
              : <button className="btn" disabled={busy} onClick={() => setActive(edit, true)}>{t('admin.rehire')}</button>)}
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>{t('reason.cancel')}</button>
          </div>
        </div>
      )}
    </Layout>
  )
}
