import { supabase } from './supabase'

// Работа при плохой связи (п. 5.3.5): кнопки статуса исполнителя без сети попадают в очередь
// на телефоне и отправляются по порядку, когда сеть вернётся.
const KEY = 'narad.offlineQueue'
interface Queued { order_id: number; action: string; reason: string | null; at: string }

const read = (): Queued[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } }
const write = (q: Queued[]) => { try { localStorage.setItem(KEY, JSON.stringify(q)) } catch { /* хранилище недоступно */ } }

export const queuedCount = () => read().length

export async function transition(orderId: number, action: string, reason: string | null = null): Promise<{ queued: boolean; error?: string }> {
  if (!navigator.onLine) {
    write([...read(), { order_id: orderId, action, reason, at: new Date().toISOString() }])
    return { queued: true }
  }
  const { error } = await supabase.rpc('transition_order', { p_order_id: orderId, p_action: action, p_reason: reason })
  if (error && /fetch|network/i.test(error.message)) {
    write([...read(), { order_id: orderId, action, reason, at: new Date().toISOString() }])
    return { queued: true }
  }
  return { queued: false, error: error?.message }
}

export async function flushQueue(): Promise<number> {
  const q = read()
  let sent = 0
  while (q.length) {
    const item = q[0]
    const { error } = await supabase.rpc('transition_order', {
      p_order_id: item.order_id, p_action: item.action, p_reason: item.reason,
      p_comment: `отправлено из офлайна, нажато в ${new Date(item.at).toLocaleTimeString('ru-RU')}`,
    })
    if (error && /fetch|network/i.test(error.message)) break   // сеть снова пропала
    q.shift()
    sent++
    write(q)
  }
  return sent
}

window.addEventListener('online', () => { flushQueue() })
