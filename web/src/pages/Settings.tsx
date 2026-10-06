import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Layout } from '../components/Layout'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'

// Настройки: подключение Telegram (push на телефон), демо-сброс смены, QR-коды
export default function Settings() {
  const { employee, logout } = useAuth()
  const { t } = useI18n()
  const [bot, setBot] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [msg, setMsg] = useState('')
  const [connected, setConnected] = useState(false)
  const staff = employee && employee.role !== 'worker'

  useEffect(() => {
    supabase.from('app_config').select('value').eq('key', 'bot_username').maybeSingle().then(({ data }) => setBot(data?.value ?? null))
    if (employee) supabase.from('employees').select('telegram_chat_id').eq('id', employee.id).single()
      .then(({ data }) => setConnected(Boolean(data?.telegram_chat_id)))
  }, [employee])

  const connectTelegram = async () => {
    const { data, error } = await supabase.rpc('telegram_link_code')
    if (error) return setMsg(error.message)
    setLink(`https://t.me/${bot}?start=${data}`)
  }
  const setupBot = async () => {
    setMsg('…')
    const { data, error } = await supabase.functions.invoke('tg-setup', { body: {} })
    if (error) return setMsg(error.message)
    if (!data.ok) return setMsg(data.reason === 'no_token' ? t('settings.no_token') : t('settings.bad_token'))
    setBot(data.bot)
    setMsg(`✔ @${data.bot}`)
  }
  const resetDemo = async () => {
    if (!confirm(t('settings.reset_confirm'))) return
    const { data, error } = await supabase.rpc('demo_reset_shift')
    setMsg(error ? error.message : t('settings.reset_done', { n: data as number }))
  }
  const notifPermission = async () => {
    try { setMsg(await Notification.requestPermission()) } catch { setMsg('—') }
  }

  return (
    <Layout title={t('settings.title')}>
      {employee && (
        <section className="card me-card">
          <span className="av">{employee.full_name.split(' ').slice(0, 2).map((x) => x[0]).join('')}</span>
          <div className="me-text"><b>{employee.full_name}</b><small>{t(`role.${employee.role}`)} · {t('login.tab')} {employee.tab_no}</small></div>
          <button className="btn" onClick={logout}><Icon name="logout" size={18} /> {t('nav.logout')}</button>
        </section>
      )}
      <section className="card">
        <div className="card-title"><Icon name="bell" size={18} /> Telegram</div>
        <p className="muted">{t('settings.tg_intro')}</p>
        {connected && <p>✔ {t('settings.tg_connected')}</p>}
        {bot ? (
          <>
            <button className="btn btn-primary btn-xl" onClick={connectTelegram}>{t('settings.tg_connect')}</button>
            {link && <p><a className="btn btn-xl" href={link} target="_blank" rel="noreferrer">{t('settings.tg_open')} @{bot}</a></p>}
          </>
        ) : <p className="muted">{t('settings.tg_not_ready')}</p>}
        {staff && <button className="btn" onClick={setupBot}>{t('settings.tg_setup')}</button>}
      </section>

      <section className="card">
        <div className="card-title"><Icon name="bell" size={18} /> {t('settings.browser_notif')}</div>
        <button className="btn" onClick={notifPermission}>{t('settings.allow_notif')}</button>
      </section>

      {staff && (
        <section className="card">
          <div className="card-title"><Icon name="play" size={18} /> {t('settings.demo')}</div>
          <p className="muted">{t('settings.demo_text')}</p>
          <button className="btn btn-danger" onClick={resetDemo}>{t('settings.reset')}</button>
          <p><Link to="/qr">▦ {t('settings.qr_print')}</Link> · <a href="/demo/seed.sql" download>⬇ {t('settings.dataset')}</a></p>
        </section>
      )}
      {msg && <p className="banner">{msg}</p>}
    </Layout>
  )
}
