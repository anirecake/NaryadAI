import { useRef, useState } from 'react'

// Голосовой ввод (бонус ТЗ): Web Speech API — Chrome на Android, Safari на iPhone.
// Текст показывается по ходу речи (промежуточные результаты) и вставляется, когда распознавание закончилось.
// Safari часто так и не присылает «окончательный» результат — тогда берём последний промежуточный.
type Result = { isFinal: boolean; 0: { transcript: string } }
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean
  onresult: (e: { resultIndex: number; results: ArrayLike<Result> }) => void
  onend: () => void; onerror: (e: { error: string }) => void; start: () => void; stop: () => void
}

const Ctor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
const RecognitionImpl = Ctor.SpeechRecognition ?? Ctor.webkitSpeechRecognition

// Код ошибки браузера → ключ подсказки
export type SpeechError = '' | 'voice.no_speech' | 'voice.denied' | 'voice.failed'
const ERRORS: Record<string, SpeechError> = {
  'no-speech': 'voice.no_speech', 'not-allowed': 'voice.denied', 'service-not-allowed': 'voice.denied',
}

export function useSpeech(lang: 'ru' | 'kk') {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<SpeechError>('')
  const rec = useRef<Recognition | null>(null)

  const start = (onText: (text: string) => void, recLang = lang === 'kk' ? 'kk-KZ' : 'ru-RU') => {
    if (!RecognitionImpl) return
    const r = new RecognitionImpl()
    r.lang = recLang
    r.interimResults = true
    r.continuous = false
    let finalText = ''
    let lastInterim = ''
    let retried = false
    r.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) finalText += (finalText ? ' ' : '') + res[0].transcript.trim()
        else live += res[0].transcript
      }
      lastInterim = live.trim()
      setInterim([finalText, lastInterim].filter(Boolean).join(' '))
    }
    r.onerror = (e) => {
      // казахский поддерживается не везде — повторяем на русском
      if (e.error === 'language-not-supported' && recLang !== 'ru-RU') { retried = true; return }
      if (e.error !== 'aborted') setError(ERRORS[e.error] ?? 'voice.failed')
    }
    r.onend = () => {
      const text = (finalText || lastInterim).trim()
      if (text) onText(text)
      setInterim('')
      setListening(false)
      if (retried) start(onText, 'ru-RU')
    }
    rec.current = r
    setError('')
    setInterim('')
    setListening(true)
    try { r.start() } catch { setListening(false); setError('voice.failed') }
  }
  const stop = () => rec.current?.stop()
  return { supported: Boolean(RecognitionImpl), listening, interim, error, start, stop }
}
