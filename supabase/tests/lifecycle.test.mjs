import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const db = new PGlite();
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');

// ── заглушки Supabase ──
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id serial primary key, bucket_id text, name text);
  alter table storage.objects enable row level security;
  create publication supabase_realtime;
  -- pgcrypto/pg_net в PGlite нет: минимальные заглушки, вызовы pg_net пишем в таблицу
  create schema extensions;
  create function extensions.gen_random_bytes(int) returns bytea language sql as $$ select decode(md5(random()::text), 'hex') $$;
  create schema net;
  create table net.calls (id serial, url text, body jsonb, headers jsonb);
  create function net.http_post(url text, body jsonb, params jsonb default '{}', headers jsonb default '{}',
    timeout_milliseconds int default 5000) returns bigint language sql as
    $$ insert into net.calls(url, body, headers) values (url, body, headers) returning id::bigint $$;
`);

const step = async (name, fn) => {
  try { const r = await fn(); console.log('OK  ', name, r ?? ''); return r; }
  catch (e) { console.log('FAIL', name, '→', e.message); process.exitCode = 1; }
};

await step('0001_schema', () => db.exec(read('supabase/migrations/0001_schema.sql')));
await step('0002_logic', () => db.exec(read('supabase/migrations/0002_logic.sql')));
// pg_cron в PGlite нет — отрезаем две последние строки
const sec = read('supabase/migrations/0003_security.sql').split('\n')
  .filter((l) => !/pg_cron|cron\.schedule/.test(l)).join('\n');
await step('0003_security (без pg_cron)', () => db.exec(sec));
await step('0005_ai_reports', () => db.exec(read('supabase/migrations/0005_ai_reports.sql')));
await step('0006_security_hardening', () => db.exec(read('supabase/migrations/0006_security_hardening.sql')));
await step('seed.sql', () => db.exec(read('data/seed.sql')));
await step('0007_admin', () => db.exec(read('supabase/migrations/0007_admin.sql')));
await step('0008_telegram_actions', () => db.exec(read('supabase/migrations/0008_telegram_actions.sql')));
await step('0009_report_access', () => db.exec(read('supabase/migrations/0009_report_access.sql')));
await db.exec(`insert into private.app_secrets values ('functions_url', 'https://x.supabase.co/functions/v1'), ('anon_key', 'anon')`);

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const as = async (uid) => db.exec(`select set_config('test.uid', '${uid ?? ''}', false)`);

await step('counts', async () => one(`select (select count(*) from orders) orders, (select count(*) from order_events) events,
  (select count(*) from employees) employees, (select count(*) from equipment) equipment,
  (select count(*) from fault_codes) codes, (select count(*) from materials) materials`));

// привязываем учётки мастера и двух слесарей
const emp = async (tab) => (await one(`select id from employees where tab_no = $1`, [tab])).id;
const master = await emp('1001'), w1 = await emp('3001'), w2 = await emp('3002');
for (const id of [master, w1, w2]) {
  await db.query(`insert into auth.users(id) values ($1)`, [id]);
  await db.query(`update employees set auth_user_id = $1 where id = $1`, [id]);
}

await step('live status', async () => (await db.query(`select live_status, count(*) from employee_live_status group by 1 order by 1`)).rows.map(r => `${r.live_status}:${r.count}`).join(' '));
await step('suggest_assignees(насос №1)', async () => (await db.query(`select full_name, score, reason from suggest_assignees(9, 'слесарь', 3)`)).rows.map(r => `${r.full_name} ${r.score} [${r.reason}]`).join(' | '));

// Сценарий демо: мастер выдаёт аварийный наряд
await as(master);
const o = await step('create_order (мастер)', async () => {
  const r = await one(`select * from create_order($1::jsonb)`, [JSON.stringify({
    type: 'unplanned', priority: 'emergency', description: 'Течь масла из-под уплотнения насоса',
    site_id: 2, equipment_id: 9, assignee_id: w1, norm_hours: 2 })]);
  return { id: r.id, number: r.number, status: r.status };
});
await step('уведомление исполнителю', async () => (await one(`select text from notifications where order_id = $1`, [o.id])).text);

// чужой исполнитель не может принять
await as(w2);
await step('w2 accept → должна быть ошибка', async () => {
  try { await one(`select status from transition_order($1, 'accept')`, [o.id]); return 'НЕ ЗАБЛОКИРОВАНО!'; }
  catch (e) { return 'заблокировано: ' + e.message; }
});

await as(w1);
await step('accept', async () => (await one(`select status from transition_order($1, 'accept')`, [o.id])).status);
await step('pause без причины → ошибка', async () => {
  try { await one(`select status from transition_order($1, 'start')`, [o.id]); await one(`select status from transition_order($1, 'pause')`, [o.id]); return 'НЕ ЗАБЛОКИРОВАНО!'; }
  catch (e) { return 'заблокировано: ' + e.message; }
});
await step('start', async () => (await one(`select status from orders where id = $1`, [o.id])).status);
await step('complete с материалами', async () => (await one(`select status from transition_order($1, 'complete', null, null, $2::jsonb)`, [o.id,
  JSON.stringify({ work_done: 'Заменены уплотнения, течь устранена', fault_code: 'Г-01', materials: [{ material_id: 28, qty: 4 }, { material_id: 14, qty: 10 }] })])).status);

await as(null); // ИИ-сервис
await step('ai_verdict accepted → ai_review', async () => (await one(`select status from transition_order($1, 'ai_verdict', null, null, '{"verdict":"accepted"}')`, [o.id])).status);
await as(master);
await step('approve мастером → closed', async () => (await one(`select status from transition_order($1, 'approve')`, [o.id])).status);
await step('журнал наряда', async () => (await db.query(`select action || ':' || coalesce(to_status::text,'') a from order_events where order_id = $1 order by id`, [o.id])).rows.map(r => r.a).join(' → '));

// Просрочка: наряд со сроком в прошлом
const o2 = await one(`select id from create_order($1::jsonb)`, [JSON.stringify({
  type: 'unplanned', priority: 'normal', description: 'Шум подшипника', site_id: 1, equipment_id: 6,
  assignee_id: w1, due_at: new Date(Date.now() - 45 * 60e3).toISOString() })]);
await db.query(`update orders set issued_at = now() - interval '20 minutes' where id = $1`, [o2.id]);
await as(null);
await step('check_deadlines', async () => (await one(`select check_deadlines() n`)).n);
await step('сообщения о просрочке/эскалации', async () => (await db.query(`select kind, text from notifications where order_id = $1 order by id`, [o2.id])).rows.map(r => `${r.kind}: ${r.text}`).join('\n      '));
await step('повторный check_deadlines не дублирует', async () => (await one(`select check_deadlines() n`)).n);

// ── 0005: ИИ-хуки, рейтинг, отчёты ──
await step('триггер ai-review на «Исполнено»', async () => (await db.query(`select url, body from net.calls where url like '%ai-review'`)).rows.map(r => r.body.order_id).join(','));
await step('рейтинг: Сапаров внизу', async () => {
  const rows = (await db.query(`select full_name, orders, avg_score, on_time, clean, total from worker_rating('2026-07-01', '2026-10-05')`)).rows;
  const idx = rows.findIndex(r => r.full_name.startsWith('Сапаров'));
  if (idx < rows.length - 3) throw new Error(`Сапаров на месте ${idx + 1} из ${rows.length}`);
  return `${rows.length} исполнителей; лучший ${rows[0].full_name} ${rows[0].total}; Сапаров ${idx + 1}-й (${rows[idx].total}, clean ${rows[idx].clean})`;
});
await step('shift_report за неделю', async () => { const r = (await one(`select shift_report('2026-09-28', '2026-10-05') r`)).r; return `выдано ${r.issued}, выполнено ${r.done}, просрочено ${r.overdue}, простой ${r.downtime_h} ч, загрузка ${r.load.length} чел`; });
await step('dashboard_kpis', async () => { const r = (await one(`select dashboard_kpis(120) r`)).r; return `топ-1 ${r.top_equipment[0].equipment} (${r.top_equipment[0].unplanned}), реакция ${r.avg_reaction_min} мин, в срок ${r.on_time}`; });
await step('materials_report: бригада №3 сверху', async () => (await db.query(`select material, ratio, top_brigade, brigade_ratio from materials_report('2026-07-01','2026-10-05') where ratio is not null limit 3`)).rows.map(r => `${r.material} ×${r.ratio} (${r.top_brigade} ×${r.brigade_ratio})`).join('; '));
await step('downtime_report', async () => (await db.query(`select equipment, unplanned, downtime_h, top_code from downtime_report('2026-07-01','2026-10-05') limit 2`)).rows.map(r => `${r.equipment}: ${r.unplanned} отказов, ${r.downtime_h} ч, ${r.top_code}`).join('; '));
await as(master);
await step('demo_reset_shift', async () => {
  await one(`select demo_reset_shift()`);
  return (await db.query(`select live_status, count(*) from employee_live_status group by 1 order by 1`)).rows.map(r => `${r.live_status}:${r.count}`).join(' ');
});
await step('telegram_link_code', async () => (await one(`select length(telegram_link_code()) n`)).n);
await as(null);
await db.exec(`select set_config('test.role', 'service_role', false)`);
const qOrder = (await one(`select id from orders where status = 'queued' limit 1`)).id;
const qWorker = (await one(`select assignee_id from orders where id = $1`, [qOrder])).assignee_id;
await step('act_as: чужое действие через Telegram запрещено', async () => {
  try { await one(`select status from act_as($1, $2, 'start')`, [w1, qOrder]); return 'НЕ ЗАБЛОКИРОВАНО!'; }
  catch (e) { return 'заблокировано: ' + e.message; }
});
await step('act_as: исполнитель из Telegram ставит на паузу текущий', async () => {
  const cur = (await one(`select id from orders where assignee_id = $1 and status = 'in_progress'`, [qWorker])).id;
  return (await one(`select status from act_as($1, $2, 'pause', 'ждёт запчасти')`, [qWorker, cur])).status;
});

// ── 0007: увольнение и «на смене» ──
await db.exec(`select set_config('test.role', '', false)`);
await as(master);
await step('мастер отмечает «на смене» через set_on_shift', async () => { await one(`select set_on_shift($1, false)`, [w2]); return (await one(`select on_shift from employees where id = $1`, [w2])).on_shift; });
await as(null);
await db.query(`update employees set active = false where id = $1`, [w2]);
await step('уволенный не виден в живых статусах', async () => (await one(`select count(*) n from employee_live_status where id = $1`, [w2])).n);
await as(w2);
await step('уволенный не может действовать', async () => (await one(`select (current_employee()).id`)).id ?? 'нет доступа');

// ── 0009: отчёты только руководителям ──
await db.exec(`select set_config('test.role', 'authenticated', false)`);
await as(w1);
await step('рабочий не видит рейтинг через API', async () => {
  try { await one(`select count(*) from worker_rating(now() - interval '90 days', now())`); return 'НЕ ЗАБЛОКИРОВАНО!'; }
  catch (e) { return 'заблокировано: ' + e.message; }
});
await as(master);
await step('мастер видит рейтинг', async () => (await one(`select count(*) n from worker_rating(now() - interval '90 days', now())`)).n);
await as(null);
await db.exec(`select set_config('test.role', 'service_role', false)`);
await step('Edge Function (service_role) видит KPI', async () => typeof (await one(`select dashboard_kpis(7) k`)).k);
