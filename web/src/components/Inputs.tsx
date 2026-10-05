import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { useSpeech } from '../lib/speech'

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
          {speech.listening ? '⏺' : '🎤'}
        </button>
      )}
    </div>
  )
}

// Выбор фото: камера телефона (или галерея, если разрешено), до max штук, с превью
export function PhotoPicker({ files, onChange, max = 5, cameraOnly = false }: {
  files: File[]; onChange: (f: File[]) => void; max?: number; cameraOnly?: boolean
}) {
  const { t } = useI18n()
  const id = useId()
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f))
    setUrls(u)
    return () => u.forEach(URL.revokeObjectURL)
  }, [files])
  return (
    <div className="photos">
      {urls.map((u, i) => (
        <div key={u} className="thumb">
          <img src={u} alt="" />
          <button type="button" className="thumb-x" aria-label="Удалить" onClick={() => onChange(files.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      {files.length < max && (
        <label htmlFor={id} className="btn add-photo">📷 {t('form.photo')}</label>
      )}
      <input id={id} type="file" accept="image/*" hidden {...(cameraOnly ? { capture: 'environment' } : {})}
             onChange={(e) => { if (e.target.files?.length) onChange([...files, ...Array.from(e.target.files)].slice(0, max)); e.target.value = '' }} />
    </div>
  )
}

// Сканер QR на шильдике оборудования (бонус ТЗ): код вида NARAD:EQ:<id>
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const { t } = useI18n()
  const box = useRef<HTMLDivElement>(null)
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
        <div id="qr-reader" ref={box} className="qr-box" />
        {error && <p className="error">{error}</p>}
        <button className="btn btn-ghost btn-xl" onClick={onClose}>{t('reason.cancel')}</button>
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
