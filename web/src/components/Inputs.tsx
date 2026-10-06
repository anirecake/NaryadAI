import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { useSpeech } from '../lib/speech'
import { Icon } from './Icon'

// Текстовое поле с кнопкой микрофона: голос → текст (бонус ТЗ «голосовой ввод»)
export function VoiceTextarea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number
}) {
  const { lang, t } = useI18n()
  const speech = useSpeech(lang)
  return (
    <div className="voice">
      <textarea rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {speech.supported && (
        <button type="button" className={`btn mic${speech.listening ? ' on' : ''}`} aria-label={t('form.voice')}
                onClick={() => speech.listening ? speech.stop() : speech.start((txt) => onChange((value ? value + ' ' : '') + txt))}>
          <Icon name="mic" size={22} />
        </button>
      )}
    </div>
  )
}

// Камера внутри приложения: живой видоискатель, большая кнопка затвора, можно снять несколько кадров.
// Снимок делается в момент работы (а не берётся из галереи) — это и есть подтверждение для ИИ-проверки.
export function CameraCapture({ onCapture, onClose, left, onFallback }: {
  onCapture: (f: File) => void; onClose: () => void; left: number; onFallback?: () => void
}) {
  const { t } = useI18n()
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [error, setError] = useState('')
  const [shots, setShots] = useState(0)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
        if (cancelled) { s.getTracks().forEach((tr) => tr.stop()); return }
        stream.current = s
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}) }
        setError('')
      } catch {
        setError(t('camera.denied'))
      }
    })()
    return () => { cancelled = true; stream.current?.getTracks().forEach((tr) => tr.stop()) }
  }, [facing]) // eslint-disable-line react-hooks/exhaustive-deps

  const shoot = () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    c.toBlob((b) => {
      if (!b) return
      onCapture(new File([b], `photo-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }))
      setShots((n) => n + 1)
      setFlash(true)
      setTimeout(() => setFlash(false), 120)
      navigator.vibrate?.(30)
      if (left <= 1) setTimeout(onClose, 200)
    }, 'image/jpeg', 0.9)
  }

  return (
    <div className="camera" role="dialog" aria-label={t('camera.title')}>
      {error ? (
        <div className="camera-msg">
          <p>{error}</p>
          {onFallback && <button className="btn btn-xl" onClick={() => { onClose(); onFallback() }}><Icon name="camera" /> {t('camera.system')}</button>}
        </div>
      ) : <video ref={video} playsInline muted style={{ opacity: flash ? 0.3 : 1 }} />}
      <div className="camera-top">
        <span>{t('camera.title')}</span>
        {shots > 0 && <span className="camera-count">✓ {shots}</span>}
      </div>
      <div className="camera-bar">
        <button className="btn btn-ghost" onClick={onClose}>{shots > 0 ? t('camera.done') : t('reason.cancel')}</button>
        {!error && <button className="shutter" aria-label={t('camera.shoot')} onClick={shoot} />}
        {!error && <button className="btn btn-ghost btn-icon" aria-label={t('camera.flip')} onClick={() => setFacing((f) => f === 'environment' ? 'user' : 'environment')}><Icon name="flip" size={22} /></button>}
      </div>
    </div>
  )
}

const canLiveCamera = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext

// Фото: «Сфотографировать» (камера в приложении) и, если разрешено, «Из галереи»
export function PhotoPicker({ files, onChange, max = 5, cameraOnly = false }: {
  files: File[]; onChange: (f: File[]) => void; max?: number; cameraOnly?: boolean
}) {
  const { t } = useI18n()
  const fileId = useId()
  const camId = useId()
  const [urls, setUrls] = useState<string[]>([])
  const [camera, setCamera] = useState(false)
  const latest = useRef(files)
  latest.current = files

  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f))
    setUrls(u)
    return () => u.forEach(URL.revokeObjectURL)
  }, [files])

  const add = (list: File[]) => onChange([...latest.current, ...list].slice(0, max))
  const left = max - files.length

  return (
    <div className="photos">
      {urls.map((u, i) => (
        <div key={u} className="thumb">
          <img src={u} alt="" />
          <button type="button" className="thumb-x" aria-label="Удалить" onClick={() => onChange(files.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button>
        </div>
      ))}
      {left > 0 && (canLiveCamera
        ? <button type="button" className="btn add-photo" onClick={() => setCamera(true)}><Icon name="camera" size={24} />{t('form.shoot')}</button>
        : <label htmlFor={camId} className="btn add-photo"><Icon name="camera" size={24} />{t('form.shoot')}</label>)}
      {left > 0 && !cameraOnly && (
        <label htmlFor={fileId} className="btn btn-ghost btn-sm">{t('form.gallery')}</label>
      )}
      <input id={camId} type="file" accept="image/*" capture="environment" hidden
             onChange={(e) => { if (e.target.files?.length) add(Array.from(e.target.files)); e.target.value = '' }} />
      <input id={fileId} type="file" accept="image/*" multiple hidden
             onChange={(e) => { if (e.target.files?.length) add(Array.from(e.target.files)); e.target.value = '' }} />
      {camera && <CameraCapture left={left} onCapture={(f) => add([f])} onClose={() => setCamera(false)}
                                onFallback={() => (document.getElementById(camId) as HTMLInputElement | null)?.click()} />}
    </div>
  )
}

// Сканер QR на шильдике оборудования (бонус ТЗ): код вида NARAD:EQ:<id>
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [error, setError] = useState('')
  useEffect(() => {
    let stop: (() => Promise<void>) | null = null
    let done = false
    ;(async () => {
      const { Html5Qrcode } = await import('html5-qrcode')
      const q = new Html5Qrcode('qr-reader')
      stop = () => q.stop().catch(() => {})
      try {
        await q.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, (text) => {
          if (done) return
          done = true
          stop?.().then(() => onResult(text))
        }, () => {})
      } catch {
        setError(t('qr.no_camera'))
      }
    })()
    return () => { stop?.() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{t('qr.title')}</h3>
        <div id="qr-reader" className="qr-box" />
        {error && <p className="error">{error}</p>}
        <button className="btn btn-xl" onClick={onClose}>{t('reason.cancel')}</button>
      </div>
    </div>
  )
}

// Переключатель-«таблетки» с крупными кнопками
export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string; tone?: string }[]; onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
                className={`seg${value === o.value ? ' on' : ''}${o.tone ? ' ' + o.tone : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Пустое состояние с подсказкой, что делать дальше
export function Empty({ icon = 'check', text, hint }: { icon?: string; text: string; hint?: string }) {
  return (
    <div className="empty">
      <Icon name={icon} size={32} />
      <b>{text}</b>
      {hint && <span>{hint}</span>}
    </div>
  )
}
