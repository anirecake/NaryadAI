import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

// Перезагрузить данные при любом изменении в таблицах (Supabase Realtime, задержка < 1–2 с)
export function useRealtimeRefresh(channel: string, tables: string[], refresh: () => void, filter?: string) {
  // актуальные refresh/tables без пересоздания подписки на каждый рендер
  const refreshRef = useRef(refresh)
  const tablesKey = tables.join(',')
  useEffect(() => { refreshRef.current = refresh })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const debounced = () => {
      clearTimeout(timer)
      timer = setTimeout(() => refreshRef.current(), 300)
    }
    const ch = supabase.channel(channel)
    for (const table of tablesKey.split(',')) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, debounced)
    }
    ch.subscribe()
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(ch)
    }
  }, [channel, tablesKey, filter])
}
