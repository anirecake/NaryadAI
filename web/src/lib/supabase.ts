import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)

// Без .env приложение показывает экран настройки, а не падает
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-key')

// Логин сотрудника = табельный номер; в Supabase Auth он хранится как email-заглушка
export const tabToEmail = (tab: string) => `${tab.trim()}@narad.local`
