-- НарядAI — отчёты и рейтинг только для мастера/руководителя/админа.
-- Раньше рабочий мог вызвать их напрямую через API (/rest/v1/rpc/worker_rating) и увидеть рейтинг всех.
-- Проверяются только запросы из приложения (роль anon/authenticated); Edge Functions (service_role)
-- и прямые подключения к БД (cron) проходят.

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees where auth_user_id = auth.uid() and active and role in ('master','manager','admin'))
$$;

create or replace function require_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not is_staff() then
    raise exception 'Отчёты доступны только мастеру и руководителю' using errcode = '42501';
  end if;
end $$;
revoke execute on function require_staff() from public, anon;
grant execute on function require_staff() to authenticated, service_role;

-- Первой строкой тела каждого отчёта — проверка доступа
do $$
declare f regprocedure; def text;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('worker_rating','dashboard_kpis','shift_report','materials_report','downtime_report')
  loop
    def := pg_get_functiondef(f);
    if def not like '%require_staff()%' then
      execute regexp_replace(def, 'AS \$function\$', E'AS $function$\n  select require_staff();');
    end if;
  end loop;
end $$;
