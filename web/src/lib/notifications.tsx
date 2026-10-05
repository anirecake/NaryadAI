import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './auth'
import { supabase } from './supabase'

export interface Notice { id: number; kind: string; text: string; order_id: number | null; created_at: string; read_at: string | null }

interface State { items: Notice[]; unread: number; toasts: Notice[]; dismiss: (id: number) => void; markAllRead: () => void }
const Ctx = createContext<State>(null!)

// Короткий сигнал: аварийный — тройной высокий тон (п. 5.3.1 «push со звуком»)
function beep(urgent: boolean) {
  try {
    const ac = new AudioContext()
    const times = urgent ? [0, 0.25, 0.5] : [0]
    for (const t of times) {
      const o = ac.createOscillator(), g = ac.createGain()
      o.frequency.value = urgent ? 1046 : 784
      g.gain.setValueAtTime(0.25, ac.currentTime + t)
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.2)
      o.connect(g).connect(ac.destination)
      o.start(ac.currentTime + t)
      o.stop(ac.currentTime + t + 0.22)
    }
  } catch { /* звук недоступен до первого касания — не критично */ }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { employee } = useAuth()
  const [items, setItems] = useState<Notice[]>([])
  const [toasts, setToasts] = useState<Notice[]>([])
  const first = useRef(true)

  const load = useCallback(async () => {
    if (!employee) return
    const { data } = await supabase.from('notifications').select('*').eq('employee_id', employee.id)
      .order('created_at', { ascending: false }).limit(50)
    setItems((data as Notice[]) ?? [])
  }, [employee])

  useEffect(() => {
    if (!employee) return
    first.current = true
    load()
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission() } catch { /* нет API */ }
    const ch = supabase.channel(`notif-${employee.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `employee_id=eq.${employee.id}` },
        (p) => {
          const n = p.new as Notice
          setItems((xs) => [n, ...xs].slice(0, 50))
          setToasts((xs) => [n, ...xs].slice(0, 3))
          const urgent = /АВАРИЙН|просрочен/i.test(n.text)
          beep(urgent)
          navigator.vibrate?.(urgent ? [300, 100, 300, 100, 300] : 200)
          try {
            if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
              new Notification('НарядAI', { body: n.text, tag: String(n.id) })
            }
          } catch { /* мобильный Chrome без service worker */ }
          if (!urgent) setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== n.id)), 8000)
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [employee, load])

  const dismiss = (id: number) => setToasts((xs) => xs.filter((x) => x.id !== id))
  const markAllRead = async () => {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id)
    if (!ids.length) return
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
    setItems((xs) => xs.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
  }

  return (
    <Ctx.Provider value={{ items, unread: items.filter((n) => !n.read_at).length, toasts, dismiss, markAllRead }}>
      {children}
    </Ctx.Provider>
  )
}

export const useNotifications = () => useContext(Ctx)
