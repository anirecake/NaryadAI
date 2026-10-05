-- НарядAI — ИИ-сервисы, Telegram, отчёты, рейтинг, дашборд.
-- Требует pg_net (0004_pg_net.sql).

-- ───────────── Служебные секреты (схема private не видна через API) ─────────────
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_secrets (key text primary key, value text not null);
-- hook_secret — общий секрет «БД → Edge Function»; functions_url и anon_key — куда и с чем стучаться
insert into private.app_secrets(key, value) values
  ('hook_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- Edge Function проверяет, что вызов пришёл из нашей БД (доступно только service_role)
create or replace function hook_secret_ok(p text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.app_secrets where key = 'hook_secret' and value = p)
$$;
revoke execute on function hook_secret_ok(text) from public, anon, authenticated;
grant execute on function hook_secret_ok(text) to service_role;

-- Асинхронный вызов Edge Function из БД
create or replace function call_function(p_name text, p_body jsonb) returns void
language plpgsql security definer set search_path = public, private as $$
declare v_url text; v_key text; v_secret text;
begin
  select value into v_url    from private.app_secrets where key = 'functions_url';
  select value into v_key    from private.app_secrets where key = 'anon_key';
  select value into v_secret from private.app_secrets where key = 'hook_secret';
  if v_url is null then return; end if;   -- функции ещё не настроены
  perform net.http_post(
    url := v_url || '/' || p_name,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key,
                                  'x-narad-hook', v_secret),
    timeout_milliseconds := 60000);
end $$;
revoke execute on function call_function(text, jsonb) from public, anon, authenticated;

-- Наряд перешёл в «Исполнено» → ИИ-проверка (п. 6.2)
create or replace function trg_order_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    perform call_function('ai-review', jsonb_build_object('order_id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists order_done_ai_review on orders;
create trigger order_done_ai_review after update of status on orders
  for each row execute function trg_order_done();

-- Новое уведомление → push в Telegram
create or replace function trg_notification_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from employees where id = new.employee_id and telegram_chat_id is not null) then
    perform call_function('tg-notify', jsonb_build_object('notification_id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists notification_push on notifications;
create trigger notification_push after insert on notifications
  for each row execute function trg_notification_push();

-- ───────────── Публичные настройки приложения (имя бота и т.п.) ─────────────
create table if not exists app_config (key text primary key, value text);
alter table app_config enable row level security;
create policy app_config_read on app_config for select to authenticated using (true);

-- ───────────── Telegram: привязка по одноразовому коду ─────────────
create table if not exists telegram_links (
  code        text primary key,
  employee_id uuid not null references employees(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table telegram_links enable row level security;   -- доступ только через функции

create or replace function telegram_link_code() returns text
language plpgsql security definer set search_path = public as $$
declare v_code text := encode(extensions.gen_random_bytes(6), 'hex'); me employees;
begin
  me := current_employee();
  if me.id is null then raise exception 'Не авторизован'; end if;
  delete from telegram_links where employee_id = me.id or created_at < now() - interval '1 day';
  insert into telegram_links(code, employee_id) values (v_code, me.id);
  return v_code;
end $$;

-- Действие «от имени» сотрудника (кнопки в Telegram). Только service_role.
create or replace function current_employee() returns employees
language sql stable security definer set search_path = public as $$
  select * from employees
  where auth_user_id = auth.uid()
     or (auth.uid() is null and coalesce(auth.role(), '') = 'service_role'
         and id::text = nullif(current_setting('narad.actor', true), ''))
$$;

create or replace function act_as(p_actor uuid, p_order_id bigint, p_action text, p_reason text default null)
returns orders language plpgsql security definer set search_path = public as $$
begin
  perform set_config('narad.actor', p_actor::text, true);
  return transition_order(p_order_id, p_action, null, p_reason);
end $$;
revoke execute on function act_as(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function act_as(uuid, bigint, text, text) to service_role;

-- ───────────── Рейтинг исполнителей (п. 6.6) ─────────────
-- Веса: качество 35%, в срок 25%, без доработок и повторных поломок 20%, объём×сложность 15%, дисциплина 5%.
create or replace function worker_rating(p_from timestamptz, p_to timestamptz)
returns table (employee_id uuid, full_name text, specialty text, brigade_id int,
               orders int, avg_score numeric, on_time numeric, clean numeric, volume numeric,
               unjustified_rejects int, total numeric)
language sql stable security definer set search_path = public as $$
  with base as (
    select o.*, coalesce(r.master_score, r.score) as q,
           exists (select 1 from orders u
                   where u.type = 'unplanned' and u.equipment_id = o.equipment_id
                     and u.fault_code is not distinct from o.fault_code and u.id <> o.id
                     and u.issued_at > o.done_at and u.issued_at <= o.done_at + interval '7 days') as repeated
    from orders o
    left join lateral (select score, master_score from ai_reviews r
                       where r.order_id = o.id order by r.id desc limit 1) r on true
    where o.status = 'closed' and o.closed_at >= p_from and o.closed_at < p_to and o.assignee_id is not null
  ),
  rej as (
    select actor_id, count(*) filter (where lower(coalesce(reason,'')) not similar to
             '%(нет материалов|нет допуска|занят аварийным|ждёт)%') as unjust
    from order_events where action = 'reject' and at >= p_from and at < p_to group by actor_id
  ),
  agg as (
    select assignee_id, count(*)::int as n, avg(q) as q,
           avg(case when done_at <= due_at then 1 else 0 end) as on_time,
           avg(case when rework_count > 0 or repeated then 0 else 1 end) as clean,
           sum(coalesce(norm_hours, 2) * case priority when 'emergency' then 1.5 when 'high' then 1.2 else 1 end) as load
    from base group by assignee_id
  )
  select e.id, e.full_name, e.specialty, e.brigade_id, a.n,
         round(a.q, 2), round(a.on_time, 3), round(a.clean, 3),
         round(a.load / nullif(max(a.load) over (), 0), 3),
         coalesce(rj.unjust, 0)::int,
         round(100 * (0.35 * coalesce(a.q, 3) / 5 + 0.25 * a.on_time + 0.20 * a.clean
                      + 0.15 * a.load / nullif(max(a.load) over (), 0)
                      + 0.05 * greatest(0, 1 - coalesce(rj.unjust, 0)::numeric / a.n * 5)), 1)
  from agg a
  join employees e on e.id = a.assignee_id
  left join rej rj on rj.actor_id = a.assignee_id
  order by 11 desc
$$;

-- ───────────── Отчёт за смену / период (п. 7) ─────────────
create or replace function shift_report(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with o as (select * from orders where issued_at >= p_from and issued_at < p_to),
  ev as (select * from order_events where at >= p_from and at < p_to)
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'issued',    (select count(*) from o),
    'done',      (select count(*) from orders where done_at >= p_from and done_at < p_to),
    'closed',    (select count(*) from orders where closed_at >= p_from and closed_at < p_to and status = 'closed'),
    'overdue',   (select count(*) from o where is_overdue),
    'rejected',  (select count(*) from ev where action = 'reject'),
    'rework',    (select count(*) from ev where to_status = 'rework'),
    'emergency', (select count(*) from o where priority = 'emergency'),
    'open_now',  (select count(*) from orders where is_open(status)),
    'downtime_h', (select round(coalesce(sum(extract(epoch from (coalesce(done_at, now()) - issued_at)) / 3600), 0)::numeric, 1)
                   from o where type = 'unplanned'),
    'avg_reaction_min', (select round(avg(extract(epoch from (accepted_at - issued_at)) / 60)::numeric, 1) from o where accepted_at is not null),
    'avg_exec_h', (select round(avg(extract(epoch from (done_at - started_at)) / 3600)::numeric, 2) from o where done_at is not null and started_at is not null),
    'load', (select coalesce(jsonb_agg(x order by x->>'hours' desc), '[]') from (
              select jsonb_build_object('employee', e.full_name, 'orders', count(*),
                       'hours', round(sum(extract(epoch from (coalesce(o2.done_at, now()) - coalesce(o2.started_at, o2.issued_at))) / 3600)::numeric, 1)) x
              from orders o2 join employees e on e.id = o2.assignee_id
              where coalesce(o2.started_at, o2.issued_at) < p_to and coalesce(o2.done_at, now()) >= p_from
                and o2.status <> 'cancelled'
              group by e.full_name) t),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from o group by status) s),
    'top_equipment', (select coalesce(jsonb_agg(x), '[]') from (
              select jsonb_build_object('equipment', eq.name, 'unplanned', count(*)) x
              from o join equipment eq on eq.id = o.equipment_id
              where o.type = 'unplanned' group by eq.name order by count(*) desc limit 5) t)
  )
$$;

-- ───────────── Дашборд руководителя ─────────────
create or replace function dashboard_kpis(p_days int default 30) returns jsonb
language sql stable security definer set search_path = public as $$
  with o as (select * from orders where issued_at >= now() - make_interval(days => p_days))
  select jsonb_build_object(
    'in_work',  (select count(*) from orders where status in ('accepted','in_progress','paused','rework')),
    'open',     (select count(*) from orders where is_open(status)),
    'overdue_now', (select count(*) from orders where is_open(status) and (is_overdue or due_at < now())),
    'issued',   (select count(*) from o),
    'unplanned_share', (select round(avg(case when type = 'unplanned' then 1 else 0 end)::numeric, 2) from o),
    'avg_reaction_min', (select round(avg(extract(epoch from (accepted_at - issued_at)) / 60)::numeric, 1) from o where accepted_at is not null),
    'avg_exec_h', (select round(avg(extract(epoch from (done_at - started_at)) / 3600)::numeric, 2) from o where done_at is not null and started_at is not null),
    'on_time', (select round(avg(case when done_at <= due_at then 1 else 0 end)::numeric, 2) from o where done_at is not null),
    'downtime_h', (select round(coalesce(sum(extract(epoch from (coalesce(done_at, now()) - issued_at)) / 3600), 0)::numeric, 0) from o where type = 'unplanned'),
    'top_equipment', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('equipment_id', eq.id, 'equipment', eq.name, 'site', s.name, 'unplanned', count(*),
               'downtime_h', round(sum(extract(epoch from (coalesce(o.done_at, now()) - o.issued_at)) / 3600)::numeric, 1)) x
        from o join equipment eq on eq.id = o.equipment_id join sites s on s.id = eq.site_id
        where o.type = 'unplanned' group by eq.id, eq.name, s.name order by count(*) desc limit 5) t),
    'weekly', (select coalesce(jsonb_agg(x order by x->>'week'), '[]') from (
        select jsonb_build_object('week', to_char(date_trunc('week', issued_at), 'YYYY-MM-DD'),
               'planned', count(*) filter (where type = 'planned'),
               'unplanned', count(*) filter (where type = 'unplanned')) x
        from o group by date_trunc('week', issued_at)) t)
  )
$$;

-- ───────────── Материалы и простои (желательные отчёты) ─────────────
create or replace function materials_report(p_from timestamptz, p_to timestamptz)
returns table (material text, unit text, qty numeric, norm_qty numeric, ratio numeric, orders bigint,
               top_brigade text, brigade_ratio numeric)
language sql stable security definer set search_path = public as $$
  with w as (
    select m.name, m.unit, w.qty, mn.typical_qty, o.brigade_id, o.id as order_id
    from material_writeoffs w
    join orders o on o.id = w.order_id
    join materials m on m.id = w.material_id
    left join material_norms mn on mn.fault_code = o.fault_code and mn.material_id = w.material_id
    where o.done_at >= p_from and o.done_at < p_to
  ),
  b as (
    select name, brigade_id, sum(qty) / nullif(sum(typical_qty) filter (where typical_qty is not null), 0) as r
    from w where typical_qty is not null group by name, brigade_id
  )
  select w.name, w.unit, round(sum(w.qty), 1), round(sum(w.typical_qty), 1),
         round(sum(w.qty) filter (where w.typical_qty is not null) / nullif(sum(w.typical_qty), 0), 2),
         count(distinct w.order_id),
         (select 'Бригада №' || b.brigade_id from b where b.name = w.name order by b.r desc nulls last limit 1),
         (select round(b.r, 2) from b where b.name = w.name order by b.r desc nulls last limit 1)
  from w group by w.name, w.unit order by sum(w.qty) desc
$$;

create or replace function downtime_report(p_from timestamptz, p_to timestamptz)
returns table (equipment text, site text, unplanned bigint, planned bigint, downtime_h numeric,
               top_category text, top_code text)
language sql stable security definer set search_path = public as $$
  select eq.name, s.name,
         count(*) filter (where o.type = 'unplanned'),
         count(*) filter (where o.type = 'planned'),
         round(coalesce(sum(extract(epoch from (coalesce(o.done_at, now()) - o.issued_at)) / 3600)
               filter (where o.type = 'unplanned'), 0)::numeric, 1),
         (select fc.category from orders x join fault_codes fc on fc.code = x.fault_code
          where x.equipment_id = eq.id and x.issued_at >= p_from and x.issued_at < p_to
          group by fc.category order by count(*) desc limit 1),
         (select x.fault_code from orders x where x.equipment_id = eq.id and x.fault_code is not null
            and x.issued_at >= p_from and x.issued_at < p_to
          group by x.fault_code order by count(*) desc limit 1)
  from orders o join equipment eq on eq.id = o.equipment_id join sites s on s.id = eq.site_id
  where o.issued_at >= p_from and o.issued_at < p_to
  group by eq.id, eq.name, s.name
  order by 5 desc
$$;

-- ───────────── Демо: «живая» смена для репетиций и защиты ─────────────
-- Закрывает висящие демо-наряды и создаёт состояние смены «прямо сейчас»:
-- кто-то в работе, у кого-то очередь, один наряд почти просрочен.
create or replace function demo_reset_shift() returns int
language plpgsql security definer set search_path = public as $$
declare
  me employees; n int := 0;
  m1 uuid; w record;
begin
  me := current_employee();
  if me.id is null or me.role not in ('master','admin','manager') then raise exception 'Только мастер или админ'; end if;
  select id into m1 from employees where tab_no = '1001';

  update orders set status = 'cancelled', closed_at = now()
  where is_open(status) or status in ('done','ai_review','rejected');
  delete from notifications where true;   -- pg_safeupdate требует WHERE
  update employees set on_shift = (role <> 'worker') or brigade_id in (1, 3) where true;

  -- в работе
  for w in select * from (values
      ('3002', 4,  'Сход ленты, износ роликов на хвостовом барабане', 'high',   interval '50 minutes', 3::numeric),
      ('3012', 23, 'Подтекает гидроцилиндр пресса',                    'normal', interval '30 minutes', 4),
      ('3013', 1,  'Наплавка брони конуса',                            'high',   interval '90 minutes', 6)
    ) as t(tab, eq, descr, prio, ago, norm) loop
    insert into orders(type, priority, description, site_id, equipment_id, assignee_id, master_id,
                       due_at, norm_hours, status, issued_at, accepted_at, started_at)
    select 'unplanned', w.prio::order_priority, w.descr, e.site_id, e.id, emp.id, m1,
           now() - w.ago + make_interval(mins => (w.norm * 60)::int), w.norm, 'in_progress',
           now() - w.ago - interval '10 minutes', now() - w.ago - interval '5 minutes', now() - w.ago
    from equipment e, employees emp where e.id = w.eq and emp.tab_no = w.tab;
    n := n + 1;
  end loop;

  -- очередь у электрика
  insert into orders(type, priority, description, site_id, equipment_id, assignee_id, master_id,
                     due_at, norm_hours, status, issued_at, accepted_at, queue_pos)
  select 'planned', 'planned', 'Плановая проверка датчиков положения', e.site_id, e.id, emp.id, m1,
         now() + interval '5 hours', 1.5, 'queued', now() - interval '40 minutes', now() - interval '35 minutes', 1
  from equipment e, employees emp where e.id = 17 and emp.tab_no = '3014';
  insert into orders(type, priority, description, site_id, equipment_id, assignee_id, master_id,
                     due_at, norm_hours, status, issued_at, accepted_at, started_at)
  select 'unplanned', 'normal', 'Не срабатывает автомат вентилятора', e.site_id, e.id, emp.id, m1,
         now() + interval '50 minutes', 1, 'in_progress', now() - interval '20 minutes', now() - interval '18 minutes', now() - interval '15 minutes'
  from equipment e, employees emp where e.id = 14 and emp.tab_no = '3014';
  n := n + 2;

  -- журнал для созданных нарядов
  insert into order_events(order_id, actor_id, action, to_status, at, comment)
  select id, master_id, 'issue', 'issued', issued_at, description from orders
  where issued_at > now() - interval '3 hours' and status in ('in_progress','queued')
    and not exists (select 1 from order_events ev where ev.order_id = orders.id);
  return n;
end $$;

grant execute on function telegram_link_code(), worker_rating(timestamptz, timestamptz), shift_report(timestamptz, timestamptz),
  dashboard_kpis(int), materials_report(timestamptz, timestamptz), downtime_report(timestamptz, timestamptz),
  demo_reset_shift() to authenticated;
grant execute on function current_employee() to authenticated, service_role;
grant execute on function transition_order(bigint, text, text, text, jsonb), notify(uuid, bigint, text, text),
  suggest_assignees(int, text, int), worker_rating(timestamptz, timestamptz), shift_report(timestamptz, timestamptz)
  to service_role;

alter publication supabase_realtime add table ai_reviews;
