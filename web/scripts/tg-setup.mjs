// Перерегистрация Telegram-бота: вебхук, меню команд, описание. То же, что кнопка в «Настройках».
// Запуск:  cd web && node --env-file=.env scripts/tg-setup.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const accounts = JSON.parse(fs.readFileSync(new URL('../../data/demo_accounts.json', import.meta.url), 'utf8'))
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const { error } = await sb.auth.signInWithPassword({ email: '1001@narad.local', password: accounts.find((a) => a.tab_no === '1001').pin })
if (error) throw error
const { data, error: e } = await sb.functions.invoke('tg-setup')
console.log(e ? `FAIL ${e.message}` : data)
