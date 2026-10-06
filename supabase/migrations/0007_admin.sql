-- НарядAI — кабинет администратора предприятия (п. 3 ТЗ: администратор ведёт справочники и сотрудников).
-- Сотрудника не удаляем (на нём история нарядов) — увольняем: active = false, вход блокируется.

alter table employees add column if not exists active boolean not null default true;

-- В живых статусах и подборе исполнителя — только работающие сотрудники
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
where e.role = 'worker' and e.active;

-- Уволенный сотрудник не может действовать, даже если сессия ещё жива
create or replace function current_employee() returns employees
language sql stable security definer set search_path = public as $$
  select * from employees
  where active and (auth_user_id = auth.uid()
     or (auth.uid() is null and coalesce(auth.role(), '') = 'service_role'
         and id::text = nullif(current_setting('narad.actor', true), '')))
$$;

-- Менять сотрудников напрямую может только администратор (мастер — только «на смене»)
drop policy if exists employees_staff on employees;
create policy employees_admin on employees for update to authenticated using (is_admin()) with check (is_admin());

create or replace function set_on_shift(p_employee uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Только мастер или администратор'; end if;
  update employees set on_shift = p_on where id = p_employee and role = 'worker';
end $$;
revoke execute on function set_on_shift(uuid, boolean) from public, anon;
grant execute on function set_on_shift(uuid, boolean) to authenticated;
