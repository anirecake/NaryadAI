-- НарядAI — демо-учётки Supabase Auth для всех сотрудников (после data/seed.sql).
-- Логин: <табельный №>@narad.local, пароль = тестовый ПИН по роли (см. data/demo_accounts.json).
-- id учётки = id сотрудника, поэтому привязка employees.auth_user_id тривиальна.
-- Альтернатива через Admin API: web/scripts/create-users.mjs.

with acc as (
  select e.id, e.tab_no || '@narad.local' as email,
         case e.role when 'master' then '111111' when 'manager' then '222222'
                     when 'admin' then '999999' else '333333' end as pin
  from employees e
  where not exists (select 1 from auth.users u where u.id = e.id)
), u as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
         extensions.crypt(pin, extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  from acc
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text,
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
from u;

update employees set auth_user_id = id where auth_user_id is null;
