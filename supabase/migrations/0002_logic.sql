-- НарядAI — бизнес-логика в БД.
-- Все изменения наряда идут ТОЛЬКО через функции ниже: так каждый переход
-- гарантированно попадает в журнал order_events (п. 4 и 5.5 ТЗ).

-- ───────────── Вспомогательное ─────────────

create or replace function current_employee() returns employees
language sql stable security definer set search_path = public as $$
  select * from employees where auth_user_id = auth.uid()
$$;

create or replace function status_ru(s order_status) returns text
language sql immutable as $$
  select case s
    when 'issued'      then 'выдан'
    when 'accepted'    then 'принят'
    when 'queued'      then 'в очереди'
    when 'rejected'    then 'отклонён'
    when 'in_progress' then 'в работе'
    when 'paused'      then 'приостановлен'
    when 'done'        then 'исполнено'
    when 'ai_review'   then 'проверка ИИ'
    when 'rework'      then 'на доработке'
    when 'closed'      then 'закрыт'
    when 'cancelled'   then 'отменён'
  end
$$;

-- «Ахметов Ерлан Болатович» → «Ахметов Е.»
create or replace function short_name(full_name text) returns text
language sql immutable as $$
  select split_part(full_name, ' ', 1) ||
         case when split_part(full_name, ' ', 2) <> '' then ' ' || left(split_part(full_name, ' ', 2), 1) || '.' else '' end
$$;

create or replace function setting(k text) returns numeric
language sql stable as $$ select value from settings where key = k $$;

create or replace function local_hhmi(t timestamptz) returns text
language sql stable as $$ select to_char(t at time zone 'Asia/Qostanay', 'HH24:MI') $$;

-- Статусы, при которых наряд «висит» на исполнителе и ИИ следит за сроком
create or replace function is_open(s order_status) returns boolean
language sql immutable as $$
  select s in ('issued','accepted','queued','in_progress','paused','rework')
$$;

-- ───────────── Живой статус людей (панель мастера, п. 5.2) ─────────────
-- free = зелёный, busy = жёлтый, queue = синий, off_shift = серый

create or replace view employee_live_status
with (security_invoker = true) as
select
  e.id, e.tab_no, e.full_name, e.specialty, e.grade, e.brigade_id, e.role, e.on_shift,
  cur.id     as current_order_id,
  cur.number as current_order_number,
  coalesce(q.cnt, 0) as queue_count,
  case
    when not e.on_shift      then 'off_shift'
    when cur.id is not null  then 'busy'
    when coalesce(q.cnt,0)>0 then 'queue'
    else 'free'
  end as live_status
from employees e
left join lateral (
  select o.id, o.number from orders o
  where o.assignee_id = e.id and o.status = 'in_progress'
  order by o.started_at desc limit 1
) cur on true
left join lateral (
  select count(*) as cnt from orders o
  where o.assignee_id = e.id and o.status in ('issued','accepted','queued','paused','rework')
) q on true
where e.role = 'worker';

-- ───────────── ИИ-подбор исполнителя (п. 5.1.3) ─────────────
-- Прозрачный скоринг: на смене, специальность, свободен/очередь, рейтинг по этому типу оборудования.

create or replace function suggest_assignees(p_equipment_id int, p_specialty text default null, p_limit int default 3)
returns table (employee_id uuid, full_name text, specialty text, live_status text, queue_count bigint,
               avg_score numeric, score numeric, reason text)
language sql stable security definer set search_path = public as $$
  with eq as (select type from equipment where id = p_equipment_id),
  hist as (
    select o.assignee_id, avg(coalesce(r.master_score, r.score)) as avg_score, count(*) as n
    from orders o
    join equipment e2 on e2.id = o.equipment_id
    join ai_reviews r on r.order_id = o.id
    where e2.type = (select type from eq)
    group by o.assignee_id
  )
  select s.id, s.full_name, s.specialty, s.live_status, s.queue_count,
         round(h.avg_score, 2),
         round(
           (case s.live_status when 'free' then 3 when 'queue' then 1.5 - least(s.queue_count, 3) * 0.3 else 0.5 end)
           + (case when p_specialty is null or s.specialty = p_specialty then 2 else 0 end)
           + coalesce(h.avg_score, 3.5) * 0.6
         , 2) as score,
         concat_ws(', ',
           case s.live_status when 'free' then 'свободен' when 'queue' then 'в очереди ' || s.queue_count
                              else 'выполняет наряд №' || s.current_order_number end,
           s.specialty || coalesce(' ' || s.grade || ' разряда', ''),
           case when h.avg_score is not null then 'оценка ' || round(h.avg_score,1) || ' по типу «' || (select type from eq) || '»' end
         ) as reason
  from employee_live_status s
  left join hist h on h.assignee_id = s.id
  where s.on_shift
  order by score desc
  limit p_limit
$$;

-- ───────────── Уведомления ─────────────

create or replace function notify(p_employee uuid, p_order bigint, p_kind text, p_text text)
returns void language sql security definer set search_path = public as $$
  insert into notifications(employee_id, order_id, kind, text) values (p_employee, p_order, p_kind, p_text)
$$;

create or replace function order_headline(o orders) returns text
language sql stable security definer set search_path = public as $$
  select format('Наряд №%s. %s, участок «%s»', o.number, e.name, s.name)
  from equipment e, sites s where e.id = o.equipment_id and s.id = o.site_id
$$;

-- ───────────── Создание наряда (п. 5.1) ─────────────

create or replace function create_order(p jsonb) returns orders
language plpgsql security definer set search_path = public as $$
declare
  me orders%rowtype;
  actor employees;
  v_norm numeric := nullif(p->>'norm_hours','')::numeric;
  v_due  timestamptz := nullif(p->>'due_at','')::timestamptz;
begin
  actor := current_employee();
  if actor.id is null or actor.role not in ('master','admin') then
    raise exception 'Выдавать наряды может только мастер';
  end if;
  if v_due is null then
    v_due := now() + make_interval(mins => (coalesce(v_norm, 2) * 60)::int);
  end if;

  insert into orders(type, priority, description, site_id, equipment_id, assignee_id, brigade_id,
                     master_id, due_at, norm_hours, comment)
  values ((p->>'type')::order_type, (p->>'priority')::order_priority, p->>'description',
          (p->>'site_id')::int, (p->>'equipment_id')::int, nullif(p->>'assignee_id','')::uuid,
          nullif(p->>'brigade_id','')::int, actor.id, v_due, v_norm, p->>'comment')
  returning * into me;

  insert into order_events(order_id, actor_id, action, to_status, comment)
  values (me.id, actor.id, 'issue', 'issued', me.description);

  if me.assignee_id is not null then
    perform notify(me.assignee_id, me.id, 'new_order',
      case when me.priority = 'emergency' then '🔴 АВАРИЙНЫЙ. ' else '' end
      || order_headline(me) || '. ' || me.description
      || '. Срок: ' || local_hhmi(me.due_at));
  end if;
  return me;
end $$;

-- ───────────── Переходы статусов (кнопки исполнителя и мастера) ─────────────
-- p_action:
--   исполнитель: accept, queue, reject*, start, pause*, complete      (* — нужна причина)
--   мастер:      approve, return*, cancel, priority
--   система/ИИ:  ai_verdict  (вызывается Edge Function с service_role)
-- p_payload для complete: {work_done, fault_code, close_comment, materials:[{material_id, qty}]}
-- p_payload для ai_verdict: {verdict}; для approve: {master_score}; для priority: {priority}

create or replace function transition_order(
  p_order_id bigint, p_action text,
  p_comment text default null, p_reason text default null, p_payload jsonb default '{}'::jsonb
) returns orders
language plpgsql security definer set search_path = public as $$
declare
  o orders;
  actor employees;
  v_from order_status;
  v_to order_status;
  -- service_role (Edge Function ИИ) или postgres (SQL-редактор/сид); anon сюда не пускаем
  v_is_system boolean := auth.uid() is null and (coalesce(auth.role(), '') = 'service_role' or current_user = 'postgres');
  v_other bigint;
  m jsonb;
begin
  select * into o from orders where id = p_order_id for update;
  if o.id is null then raise exception 'Наряд не найден'; end if;
  v_from := o.status;
  actor := current_employee();

  -- права
  if p_action in ('accept','queue','reject','start','pause','complete') then
    if actor.id is null or actor.id is distinct from o.assignee_id then
      raise exception 'Это действие доступно только исполнителю наряда';
    end if;
  elsif p_action in ('approve','return','cancel','priority') then
    if actor.id is null or actor.role not in ('master','admin') then
      raise exception 'Это действие доступно только мастеру';
    end if;
  elsif p_action = 'ai_verdict' then
    if not v_is_system then raise exception 'Вердикт выносит только ИИ-сервис'; end if;
  else
    raise exception 'Неизвестное действие: %', p_action;
  end if;

  if p_action in ('reject','pause','return') and coalesce(trim(p_reason), '') = '' then
    raise exception 'Укажите причину';
  end if;

  -- машина состояний (схема из ТЗ)
  v_to := case p_action
    when 'accept'     then case when v_from = 'issued' then 'accepted' end
    when 'queue'      then case when v_from = 'issued' then 'queued' end
    when 'reject'     then case when v_from in ('issued','accepted','queued') then 'rejected' end
    when 'start'      then case when v_from in ('accepted','queued','paused','rework') then 'in_progress' end
    when 'pause'      then case when v_from = 'in_progress' then 'paused' end
    when 'complete'   then case when v_from = 'in_progress' then 'done' end
    when 'ai_verdict' then case when v_from = 'done' then
                             case when p_payload->>'verdict' = 'rework' then 'rework' else 'ai_review' end end
    when 'approve'    then case when v_from in ('done','ai_review') then 'closed' end
    when 'return'     then case when v_from in ('done','ai_review') then 'rework' end
    when 'cancel'     then case when v_from not in ('closed','cancelled') then 'cancelled' end
    when 'priority'   then v_from::text
  end::order_status;

  if v_to is null then
    raise exception 'Нельзя выполнить «%» из статуса «%»', p_action, status_ru(v_from);
  end if;

  -- одно «в работе» на человека: остальные — в очередь/пауза
  if p_action = 'start' then
    select number into v_other from orders
    where assignee_id = o.assignee_id and status = 'in_progress' and id <> o.id limit 1;
    if v_other is not null then
      raise exception 'Сначала приостановите или завершите наряд №%', v_other;
    end if;
  end if;

  update orders set
    status       = v_to,
    priority     = case when p_action = 'priority' then (p_payload->>'priority')::order_priority else priority end,
    accepted_at  = case when p_action in ('accept','queue') then now() else accepted_at end,
    started_at   = case when p_action = 'start' and started_at is null then now() else started_at end,
    done_at      = case when p_action = 'complete' then now() else done_at end,
    closed_at    = case when v_to in ('closed','cancelled') then now() else closed_at end,
    queue_pos    = case when p_action = 'queue' then
                     (select coalesce(max(queue_pos),0)+1 from orders where assignee_id = o.assignee_id and status = 'queued')
                   when v_to <> 'queued' then null else queue_pos end,
    rework_count = rework_count + case when v_to = 'rework' then 1 else 0 end,
    work_done     = case when p_action = 'complete' then p_payload->>'work_done' else work_done end,
    fault_code    = case when p_action = 'complete' then nullif(p_payload->>'fault_code','') else fault_code end,
    close_comment = case when p_action = 'complete' then p_payload->>'close_comment' else close_comment end,
    last_comment  = coalesce(nullif(p_comment,''), nullif(p_reason,''), last_comment)
  where id = o.id
  returning * into o;

  if p_action = 'complete' then
    delete from material_writeoffs where order_id = o.id;   -- повторное закрытие после доработки
    for m in select * from jsonb_array_elements(coalesce(p_payload->'materials','[]'::jsonb)) loop
      insert into material_writeoffs(order_id, material_id, qty)
      values (o.id, (m->>'material_id')::int, (m->>'qty')::numeric);
    end loop;
  end if;

  if p_action = 'approve' and p_payload ? 'master_score' then
    update ai_reviews set master_score = (p_payload->>'master_score')::numeric, master_comment = p_comment
    where id = (select max(id) from ai_reviews where order_id = o.id);
  end if;

  insert into order_events(order_id, actor_id, action, from_status, to_status, comment, reason)
  values (o.id, actor.id, p_action, v_from, v_to, p_comment, p_reason);

  -- уведомления
  if p_action = 'reject' then
    perform notify(o.master_id, o.id, 'rejected',
      order_headline(o) || ' отклонён: ' || p_reason || '. Нужно переназначить.');
  elsif v_to = 'rework' then
    perform notify(o.assignee_id, o.id, 'rework',
      order_headline(o) || ' возвращён на доработку: ' || coalesce(p_reason, p_payload->>'explanation', ''));
  end if;

  return o;
end $$;

-- Переназначение (после отказа или эскалации)
create or replace function reassign_order(p_order_id bigint, p_assignee uuid, p_comment text default null)
returns orders language plpgsql security definer set search_path = public as $$
declare o orders; actor employees; v_from order_status;
begin
  actor := current_employee();
  if actor.id is null or actor.role not in ('master','admin') then
    raise exception 'Переназначать может только мастер';
  end if;
  select * into o from orders where id = p_order_id for update;
  v_from := o.status;
  if v_from not in ('issued','accepted','queued','rejected','paused') then
    raise exception 'Нельзя переназначить наряд в статусе «%»', status_ru(v_from);
  end if;
  update orders set assignee_id = p_assignee, status = 'issued', issued_at = now(),
         accepted_at = null, queue_pos = null, accept_escalated_at = null, reminded_at = null
  where id = o.id returning * into o;
  insert into order_events(order_id, actor_id, action, from_status, to_status, comment)
  values (o.id, actor.id, 'reassign', v_from, 'issued', p_comment);
  perform notify(p_assignee, o.id, 'new_order',
    case when o.priority = 'emergency' then '🔴 АВАРИЙНЫЙ. ' else '' end || order_headline(o) || '. ' || o.description);
  return o;
end $$;

-- ───────────── ИИ-контроль сроков (п. 6.1, MVP) ─────────────
-- Вызывается pg_cron каждые 30 секунд (см. 0003_security.sql).

create or replace function overdue_text(o orders) returns text
language sql stable security definer set search_path = public as $$
  -- формат из ТЗ: «Наряд №147 просрочен на 45 мин. Дробилка КМД-1750, участок дробления.
  --  Исполнитель: Ахметов Е. Статус: в работе с 09:20. Последний комментарий: “…”»
  select format('Наряд №%s просрочен на %s мин. %s, участок «%s». Исполнитель: %s Статус: %s%s.%s',
    o.number,
    floor(extract(epoch from now() - o.due_at) / 60)::int,
    e.name, s.name,
    coalesce(short_name(w.full_name), 'не назначен.'),
    status_ru(o.status),
    case when o.status = 'in_progress' and o.started_at is not null then ' с ' || local_hhmi(o.started_at) else '' end,
    case when o.last_comment is not null then ' Последний комментарий: «' || o.last_comment || '».' else '' end)
  from equipment e
  join sites s on s.id = o.site_id
  left join employees w on w.id = o.assignee_id
  where e.id = o.equipment_id
$$;

create or replace function check_deadlines() returns int
language plpgsql security definer set search_path = public as $$
declare
  o orders;
  n int := 0;
  cand record;
  mgr uuid;
begin
  for o in select * from orders where is_open(status) loop

    -- 1. Напоминание за N минут до срока
    if o.reminded_at is null and o.due_at > now()
       and o.due_at - now() <= make_interval(mins => setting('remind_before_min')::int)
       and o.assignee_id is not null then
      perform notify(o.assignee_id, o.id, 'remind',
        format('⏰ Через %s мин истекает срок. %s', ceil(extract(epoch from o.due_at - now())/60)::int, order_headline(o)));
      update orders set reminded_at = now() where id = o.id;
      n := n + 1;
    end if;

    -- 2. Просрочка → исполнителю и мастеру, с повтором через интервал
    if now() > o.due_at and (o.overdue_notified_at is null
        or now() - o.overdue_notified_at >= make_interval(mins => setting('repeat_interval_min')::int)) then
      update orders set is_overdue = true, overdue_notified_at = now() where id = o.id;
      if o.assignee_id is not null then perform notify(o.assignee_id, o.id, 'overdue', '❗ ' || overdue_text(o)); end if;
      perform notify(o.master_id, o.id, 'overdue', '❗ ' || overdue_text(o));
      n := n + 1;
    end if;

    -- 3. Длительная просрочка → руководителю
    if o.manager_notified_at is null
       and now() - o.due_at >= make_interval(mins => setting('manager_escalation_min')::int) then
      for mgr in select id from employees where role = 'manager' loop
        perform notify(mgr, o.id, 'manager_overdue', '⚠️ ' || overdue_text(o));
      end loop;
      update orders set manager_notified_at = now() where id = o.id;
    end if;

    -- 4. Не принят вовремя → эскалация мастеру с кандидатом на замену
    if o.status = 'issued' and o.accept_escalated_at is null
       and now() - o.issued_at >= make_interval(mins =>
           (case when o.priority = 'emergency' then setting('emergency_accept_timeout_min')
                 else setting('accept_timeout_min') end)::int) then
      select * into cand from suggest_assignees(o.equipment_id,
        (select specialty from employees where id = o.assignee_id), 5) s
      where s.employee_id is distinct from o.assignee_id limit 1;
      perform notify(o.master_id, o.id, 'accept_timeout',
        format('%s не принят за %s мин.%s', order_headline(o),
               floor(extract(epoch from now() - o.issued_at)/60)::int,
               case when cand.employee_id is not null
                    then ' Предлагаем: ' || short_name(cand.full_name) || ' (' || cand.reason || ').' else '' end));
      update orders set accept_escalated_at = now() where id = o.id;
      n := n + 1;
    end if;

  end loop;
  return n;
end $$;
