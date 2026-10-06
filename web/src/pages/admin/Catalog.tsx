import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { Empty, Segmented } from '../../components/Inputs'
import { Layout } from '../../components/Layout'
import { useI18n } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'

interface Site { id: number; name: string; name_kk: string | null }
interface Equip { id: number; name: string; inv_no: string; site_id: number; type: string; criticality: number; qr_code: string | null }
interface Brigade { id: number; name: string }
type Tab = 'equipment' | 'sites' | 'brigades'

const TYPES = ['конвейер', 'дробилка', 'питатель', 'грохот', 'насос', 'сепаратор', 'вентилятор', 'дымосос', 'сушильный барабан', 'фильтр', 'компрессор', 'станок', 'кран', 'пресс', 'сварочное']

// Справочники предприятия (п. 5.4): участки, оборудование с QR, бригады
export default function Catalog() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'equipment'
  const [sites, setSites] = useState<Site[]>([])
  const [eq, setEq] = useState<Equip[]>([])
  const [brigades, setBrigades] = useState<Brigade[]>([])
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [s, e, b] = await Promise.all([
      supabase.from('sites').select('*').order('id'),
      supabase.from('equipment').select('*').order('site_id').order('name'),
      supabase.from('brigades').select('*').order('id'),
    ])
    setSites((s.data as Site[]) ?? [])
    setEq((e.data as Equip[]) ?? [])
    setBrigades((b.data as Brigade[]) ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const table = tab === 'equipment' ? 'equipment' : tab === 'sites' ? 'sites' : 'brigades'
  const save = async () => {
    if (!edit) return
    setBusy(true)
    setErr('')
    const { id, ...fields } = edit
    const res = id
      ? await supabase.from(table).update(fields).eq('id', id as number).select().single()
      : await supabase.from(table).insert(fields).select().single()
    if (res.error) { setErr(res.error.code === '23505' ? t('catalog.duplicate') : res.error.message); setBusy(false); return }
    // QR-код нового оборудования — по его id
    if (tab === 'equipment' && !id && res.data) {
      await supabase.from('equipment').update({ qr_code: `NARAD:EQ:${res.data.id}` }).eq('id', res.data.id)
    }
    setBusy(false)
    setEdit(null)
    load()
  }

  const valid = edit && String(edit.name ?? '').trim() && (tab !== 'equipment' || (String(edit.inv_no ?? '').trim() && edit.site_id))

  return (
    <Layout title={t('admin.catalog')} subtitle={t('catalog.sub')}
            actions={<button className="btn btn-primary" onClick={() => { setErr(''); setEdit(tab === 'equipment' ? { site_id: sites[0]?.id, type: 'конвейер', criticality: 2 } : {}) }}><Icon name="plus" size={18} /> <span className="lbl">{t('admin.add')}</span></button>}>
      <div className="subtabs">
        {(['equipment', 'sites', 'brigades'] as Tab[]).map((x) => (
          <button key={x} className={`seg${tab === x ? ' on' : ''}`} onClick={() => setParams({ tab: x })}>{t(`catalog.${x}`)}</button>
        ))}
        <Link to="/qr" className="seg"><Icon name="qr" size={16} /> {t('settings.qr_print')}</Link>
      </div>

      <section className="card table-wrap">
        {tab === 'equipment' && (eq.length === 0 ? <Empty icon="box" text={t('catalog.empty')} /> : (
          <table>
            <thead><tr><th>{t('form.equipment')}</th><th>{t('catalog.inv')}</th><th>{t('form.site')}</th><th>{t('catalog.type')}</th><th>{t('catalog.crit')}</th><th /></tr></thead>
            <tbody>{eq.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => { setErr(''); setEdit({ ...e }) }}>
                <td><b>{e.name}</b></td><td>{e.inv_no}</td><td>{sites.find((s) => s.id === e.site_id)?.name}</td><td>{e.type}</td>
                <td>{t(`catalog.crit${e.criticality}`)}</td><td><Icon name="chevron" size={18} /></td>
              </tr>
            ))}</tbody>
          </table>
        ))}
        {tab === 'sites' && (
          <table>
            <thead><tr><th>{t('form.site')}</th><th>{t('catalog.name_kk')}</th><th>{t('catalog.units')}</th><th /></tr></thead>
            <tbody>{sites.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => { setErr(''); setEdit({ ...s }) }}>
                <td><b>{s.name}</b></td><td>{s.name_kk ?? '—'}</td><td>{eq.filter((e) => e.site_id === s.id).length}</td><td><Icon name="chevron" size={18} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {tab === 'brigades' && (
          <table>
            <thead><tr><th>{t('admin.brigade')}</th><th /></tr></thead>
            <tbody>{brigades.map((b) => (
              <tr key={b.id} className="clickable" onClick={() => { setErr(''); setEdit({ ...b }) }}><td><b>{b.name}</b></td><td><Icon name="chevron" size={18} /></td></tr>
            ))}</tbody>
          </table>
        )}
      </section>

      {edit && (
        <div className="sheet-backdrop" onClick={() => setEdit(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{edit.id ? String(edit.name) : t(`catalog.new_${tab}`)}</h3>
            <label className="field"><span>{t('catalog.name')}</span>
              <input value={String(edit.name ?? '')} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus={!edit.id} />
            </label>
            {tab === 'sites' && (
              <label className="field"><span>{t('catalog.name_kk')}</span>
                <input value={String(edit.name_kk ?? '')} onChange={(e) => setEdit({ ...edit, name_kk: e.target.value || null })} />
              </label>
            )}
            {tab === 'equipment' && (
              <>
                <label className="field"><span>{t('catalog.inv')}</span>
                  <input value={String(edit.inv_no ?? '')} onChange={(e) => setEdit({ ...edit, inv_no: e.target.value })} placeholder="ИН-10108" />
                </label>
                <label className="field"><span>{t('form.site')}</span>
                  <select value={Number(edit.site_id ?? '')} onChange={(e) => setEdit({ ...edit, site_id: Number(e.target.value) })}>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="field"><span>{t('catalog.type')}</span>
                  <select value={String(edit.type ?? '')} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                    {TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
                <div className="field"><span>{t('catalog.crit')}</span>
                  <Segmented value={String(edit.criticality ?? 2)} onChange={(v) => setEdit({ ...edit, criticality: Number(v) })}
                    options={[1, 2, 3].map((c) => ({ value: String(c), label: t(`catalog.crit${c}`) }))} />
                </div>
              </>
            )}
            {err && <p className="banner">{err}</p>}
            <button className="btn btn-primary btn-xl" disabled={busy || !valid} onClick={save}>{busy ? t('form.sending') : t('admin.save')}</button>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>{t('reason.cancel')}</button>
          </div>
        </div>
      )}
    </Layout>
  )
}
