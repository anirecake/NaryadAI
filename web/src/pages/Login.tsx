import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { LangToggle } from '../components/Layout'
import { homeFor, useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'

// Вход по табельному номеру и ПИН. Цифровая клавиатура — крупная, под рабочие перчатки.
export default function Login() {
  const { employee, login } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [tab, setTab] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (employee) return <Navigate to={homeFor(employee.role)} replace />

  const press = (d: string) => setPin((p) => (d === '⌫' ? p.slice(0, -1) : (p + d).slice(0, 6)))

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!tab || pin.length < 6) return
    setBusy(true)
    setError('')
    const res = await login(tab, pin)
    setBusy(false)
    if (res === 'bad_credentials') setError(t('login.error'))
    else if (res === 'no_employee') setError(t('login.no_employee'))
    else navigate('/', { replace: true })
  }

  return (
    <div className="login">
     <div className="login-card">
      <div className="login-head">
        <img src="/icon.svg" alt="" width={48} height={48} />
        <div>
          <h1>Наряд<b>AI</b></h1>
          <p className="muted">{t('app.slogan')}</p>
        </div>
        <LangToggle />
      </div>

      <form onSubmit={submit} className="login-form">
        <label className="field">
          <span>{t('login.tab')}</span>
          <input inputMode="numeric" autoComplete="username" placeholder="1001" value={tab}
                 onChange={(e) => setTab(e.target.value.replace(/\D/g, ''))} />
        </label>

        <div className="field">
          <span>{t('login.pin')}</span>
          <div className="pin-dots" aria-label={t('login.pin')}>
            {Array.from({ length: 6 }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
          </div>
        </div>

        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) =>
            d ? <button type="button" key={i} className="btn key" onClick={() => press(d)}>{d}</button> : <span key={i} />)}
        </div>

        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-xl" disabled={busy || !tab || pin.length < 6}>{busy ? t('form.sending') : t('login.submit')}</button>
      </form>
      <p className="cap center">{t('login.help')}</p>
     </div>
    </div>
  )
}
