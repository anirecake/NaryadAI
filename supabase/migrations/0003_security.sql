-- НарядAI — доступы (RLS), Realtime, хранилище фото, расписание ИИ-контроля сроков.
-- Принцип: читать можно по роли, а менять наряды — только через функции из 0002 (они пишут журнал).

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees where auth_user_id = auth.uid() and role in ('master','manager','admin'))
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees where auth_user_id = auth.uid() and role = 'admin')
$$;

create or replace function my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from employees where auth_user_id = auth.uid()
$$;

-- ───── RLS ─────
alter table sites              enable row level security;
alter table brigades           enable row level security;
alter table equipment          enable row level security;
alter table employees          enable row level security;
alter table fault_codes        enable row level security;
alter table materials          enable row level security;
alter table material_norms     enable row level security;
alter table time_norms         enable row level security;
alter table settings           enable row level security;
alter table orders             enable row level security;
alter table order_events       enable row level security;
alter table photos             enable row level security;
alter table material_writeoffs enable row level security;
alter table ai_reviews         enable row level security;
alter table notifications      enable row level security;

-- справочники: читают все вошедшие, меняет администратор
do $$ declare t text; begin
  foreach t in array array['sites','brigades','equipment','fault_codes','materials','material_norms','time_norms','settings'] loop
    execute format('create policy "%1$s_read"  on %1$s for select to authenticated using (true)', t);
    execute format('create policy "%1$s_admin" on %1$s for all    to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

-- сотрудники: список видят все (нужен для выбора исполнителя), меняют мастер/админ (выход на смену)
create policy employees_read  on employees for select to authenticated using (true);
create policy employees_staff on employees for update to authenticated using (is_staff()) with check (is_staff());

-- наряды: мастер/руководитель/админ — все; исполнитель — только свои
create policy orders_read on orders for select to authenticated
  using (is_staff() or assignee_id = my_employee_id());

-- всё, что висит на наряде, видно тем, кто видит наряд
create policy events_read on order_events       for select to authenticated using (exists (select 1 from orders o where o.id = order_id));
create policy photos_read on photos             for select to authenticated using (exists (select 1 from orders o where o.id = order_id));
create policy writeoffs_read on material_writeoffs for select to authenticated using (exists (select 1 from orders o where o.id = order_id));
create policy reviews_read on ai_reviews        for select to authenticated using (exists (select 1 from orders o where o.id = order_id));

-- фото добавляет автор к видимому ему наряду
create policy photos_insert on photos for insert to authenticated
  with check (author_id = my_employee_id() and exists (select 1 from orders o where o.id = order_id));

-- уведомления: только свои
create policy notif_read   on notifications for select to authenticated using (employee_id = my_employee_id());
create policy notif_update on notifications for update to authenticated using (employee_id = my_employee_id());

-- ───── Функции: анониму — ничего ─────
revoke execute on all functions in schema public from public, anon;
grant execute on function
  current_employee(), status_ru(order_status), short_name(text), setting(text), local_hhmi(timestamptz),
  is_open(order_status), suggest_assignees(int, text, int), create_order(jsonb),
  transition_order(bigint, text, text, text, jsonb), reassign_order(bigint, uuid, text),
  order_headline(orders), overdue_text(orders), is_staff(), is_admin(), my_employee_id()
to authenticated;
-- check_deadlines и notify вызывают только cron и service_role
grant execute on function check_deadlines(), notify(uuid, bigint, text, text) to service_role;

-- ───── Realtime: статусы у мастера обновляются за ≤5 с ─────
alter publication supabase_realtime add table orders, order_events, notifications, employees;

-- ───── Хранилище фото (приватное) ─────
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy photos_bucket_read   on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy photos_bucket_insert on storage.objects for insert to authenticated with check (bucket_id = 'photos');

-- ───── ИИ-контроль сроков каждые 30 секунд ─────
create extension if not exists pg_cron;
select cron.schedule('narad-check-deadlines', '30 seconds', $$select public.check_deadlines()$$);
