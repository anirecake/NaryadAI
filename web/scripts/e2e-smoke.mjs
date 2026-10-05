// Сквозной смоук-тест против живого Supabase (демо-учётки из data/demo_accounts.json).
// Запуск:  cd web && node --env-file=.env scripts/e2e-smoke.mjs
// ВНИМАНИЕ: создаёт настоящие наряды в демо-базе.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const SB_URL = process.env.VITE_SUPABASE_URL, KEY = process.env.VITE_SUPABASE_ANON_KEY
const accounts = JSON.parse(fs.readFileSync(new URL('../../data/demo_accounts.json', import.meta.url), 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${extra}`); if (!ok) failed++ }

async function login(tab) {
  const sb = createClient(SB_URL, KEY, { auth: { persistSession: false } })
  const pin = accounts.find((a) => a.tab_no === tab).pin
  const { error } = await sb.auth.signInWithPassword({ email: `${tab}@narad.local`, password: pin })
  if (error) throw new Error(`${tab}: ${error.message}`)
  return sb
}

const master = await login('1001')
const worker = await login('3001')
const { data: me } = await worker.rpc('current_employee')

// 1. Живая смена
const { data: n } = await master.rpc('demo_reset_shift')
check('demo_reset_shift', n === 5, `создано ${n}`)

// 2. Подсказки ИИ при выдаче
const { data: sugg } = await master.functions.invoke('ai-insights', { body: { kind: 'suggest_code', description: 'Течь масла из-под уплотнения насоса', equipment_id: 9 } })
check('suggest_code', sugg?.suggestion?.code === 'Г-01', JSON.stringify(sugg?.suggestion))
const { data: cand } = await master.rpc('suggest_assignees', { p_equipment_id: 9, p_specialty: 'слесарь', p_limit: 3 })
check('suggest_assignees', cand?.length > 0, cand?.map((c) => c.full_name).join(', '))

// 3. Наряд без фото и с лишними материалами → «требует доработки» (сценарий 11.7)
const { data: o, error: e1 } = await master.rpc('create_order', { p: { type: 'unplanned', priority: 'high',
  description: 'Шум подшипника привода, нагрев', site_id: 1, equipment_id: 6, assignee_id: me.id, norm_hours: 3 } })
check('create_order', !e1, e1?.message ?? `№${o?.number}`)
for (const a of ['accept', 'start']) {
  const { error } = await worker.rpc('transition_order', { p_order_id: o.id, p_action: a })
  check(`worker ${a}`, !error, error?.message ?? '')
}
const { error: e2 } = await worker.rpc('transition_order', { p_order_id: o.id, p_action: 'complete', p_payload: {
  work_done: 'Заменён подшипник', fault_code: 'М-02', materials: [{ material_id: 1, qty: 6 }, { material_id: 15, qty: 0.5 }] } })
check('worker complete (без фото, 6 подшипников при норме 1)', !e2, e2?.message ?? '')

let review = null
for (let i = 0; i < 30 && !review; i++) {
  await sleep(2000)
  const { data } = await master.from('ai_reviews').select('verdict, score, explanation, checks').eq('order_id', o.id).maybeSingle()
  review = data
}
check('ИИ-проверка сработала по триггеру', Boolean(review), review ? `${review.verdict} ${review.score} (Claude: ${review.checks.ai})` : 'нет ответа за 60 с')
check('вердикт «требует доработки»', review?.verdict === 'rework', review?.explanation ?? '')
const { data: after } = await master.from('orders').select('status').eq('id', o.id).single()
check('наряд вернулся исполнителю', after?.status === 'rework', after?.status)

// 4. Аналитика и отчёты
const { data: an } = await master.functions.invoke('ai-insights', { body: { kind: 'anomalies' } })
check('аномалии: найдено ≥ 6', an?.findings?.length >= 6, an?.findings?.map((f) => f.kind).join(', '))
const day = new Date(Date.now() - 86400e3).toISOString(), now = new Date(Date.now() + 60e3).toISOString()
const { data: sum } = await master.functions.invoke('ai-insights', { body: { kind: 'shift_summary', from: day, to: now } })
check('сводка смены', sum?.text?.length > 50, sum?.text?.slice(0, 120))
const { data: asst } = await master.functions.invoke('ai-insights', { body: { kind: 'assistant', question: 'Кто сейчас свободен из электриков?' } })
check('ассистент мастера', Boolean(asst?.text), asst?.text?.slice(0, 120))
const { data: rating } = await master.rpc('worker_rating', { p_from: '2026-07-01', p_to: now })
check('рейтинг', rating?.length >= 10, `${rating?.[0]?.full_name} ${rating?.[0]?.total}`)

// 5. Права: исполнитель не видит аналитику
const { error: e3 } = await worker.functions.invoke('ai-insights', { body: { kind: 'anomalies' } })
check('исполнителю аналитика запрещена', Boolean(e3))

console.log(failed ? `\n${failed} проверок не прошли` : '\nВсе проверки прошли')
process.exit(failed ? 1 : 0)
