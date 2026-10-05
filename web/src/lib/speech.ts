import { useRef, useState } from 'react'

// Голосовой ввод (бонус ТЗ): Web Speech API, в Chrome на Android работает на русском и казахском
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void
  onend: () => void; onerror: () => void; start: () => void; stop: () => void
}

const Ctor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
const RecognitionImpl = Ctor.SpeechRecognition ?? Ctor.webkitSpeechRecognition

export function useSpeech(lang: 'ru' | 'kk') {
  const [listening, setListening] = useState(false)
  const rec = useRef<Recognition | null>(null)

  const start = (onText: (text: string) => void) => {
    if (!RecognitionImpl) return
    const r = new RecognitionImpl()
    r.lang = lang === 'kk' ? 'kk-KZ' : 'ru-RU'
    r.interimResults = false
    r.continuous = false
    r.onresult = (e) => onText(Array.from(e.results).map((x) => x[0].transcript).join(' '))
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    rec.current = r
    setListening(true)
    r.start()
  }
  const stop = () => rec.current?.stop()
  return { supported: Boolean(RecognitionImpl), listening, start, stop }
}
