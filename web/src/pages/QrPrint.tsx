import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Layout } from '../components/Layout'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'

// Лист QR-кодов для шильдиков оборудования: распечатать и наклеить (бонус ТЗ)
export default function QrPrint() {
  const { t } = useI18n()
  const [items, setItems] = useState<{ id: number; name: string; inv_no: string; img: string }[]>([])
  useEffect(() => {
    supabase.from('equipment').select('id, name, inv_no, qr_code').order('site_id').order('name').then(async ({ data }) => {
      setItems(await Promise.all((data ?? []).map(async (e) => ({
        ...e, img: await QRCode.toDataURL(e.qr_code ?? `NARAD:EQ:${e.id}`, { margin: 1, width: 240 }),
      }))))
    })
  }, [])
  return (
    <Layout title={t('qr.print_title')} back="/panel">
      <button className="btn no-print" onClick={() => window.print()}>🖨 {t('qr.print')}</button>
      <div className="qr-grid">
        {items.map((e) => (
          <figure key={e.id} className="qr-card">
            <img src={e.img} alt={`QR ${e.name}`} />
            <figcaption><b>{e.name}</b><br />{e.inv_no}</figcaption>
          </figure>
        ))}
      </div>
    </Layout>
  )
}
