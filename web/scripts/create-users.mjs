// Создаёт учётки Supabase Auth для всех сотрудников из data/demo_accounts.json
// и привязывает их к employees.auth_user_id. Запускать один раз после сида:
//   npm run create-users      (нужен web/.env.server с SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в web/.env.server')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const accounts = JSON.parse(fs.readFileSync(new URL('../../data/demo_accounts.json', import.meta.url), 'utf8'))

for (const a of accounts) {
  const email = `${a.tab_no}@narad.local`
  let { data, error } = await admin.auth.admin.createUser({ email, password: a.pin, email_confirm: true })
  if (error?.message?.includes('already')) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
    data = { user: list.users.find((u) => u.email === email) }
    error = null
  }
  if (error) { console.error(a.tab_no, error.message); continue }
  const { error: linkErr } = await admin.from('employees').update({ auth_user_id: data.user.id }).eq('tab_no', a.tab_no)
  console.log(linkErr ? `✗ ${a.tab_no} ${linkErr.message}` : `✓ ${a.tab_no} ${a.full_name} (${a.role})`)
}
