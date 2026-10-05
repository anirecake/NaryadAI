-- НарядAI — ужесточение прав по итогам Supabase Security Advisor.
-- Supabase по умолчанию выдаёт EXECUTE на новые функции ролям anon и authenticated —
-- забираем всё лишнее и оставляем только то, что вызывает приложение.

-- Аноним не вызывает ничего, в том числе функции, созданные в будущем.
-- Право по умолчанию идёт через PUBLIC, поэтому отзываем у PUBLIC и выдаём явно.
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from anon, public;

grant execute on function
  current_employee(), status_ru(order_status), short_name(text), setting(text), local_hhmi(timestamptz),
  is_open(order_status), suggest_assignees(int, text, int), create_order(jsonb),
  transition_order(bigint, text, text, text, jsonb), reassign_order(bigint, uuid, text),
  is_staff(), is_admin(), my_employee_id(), telegram_link_code(),
  worker_rating(timestamptz, timestamptz), shift_report(timestamptz, timestamptz), dashboard_kpis(int),
  materials_report(timestamptz, timestamptz), downtime_report(timestamptz, timestamptz), demo_reset_shift()
to authenticated;

-- Служебные функции: только cron, триггеры и Edge Functions (service_role)
revoke execute on function check_deadlines()                       from authenticated;
revoke execute on function notify(uuid, bigint, text, text)        from authenticated;
revoke execute on function trg_order_done()                        from authenticated;
revoke execute on function trg_notification_push()                 from authenticated;
revoke execute on function order_headline(orders)                  from authenticated;
revoke execute on function overdue_text(orders)                    from authenticated;

-- Фиксированный search_path у вспомогательных функций
alter function setting(text)            set search_path = public;
alter function local_hhmi(timestamptz)  set search_path = public;
alter function is_open(order_status)    set search_path = public;
alter function status_ru(order_status)  set search_path = public;
alter function short_name(text)         set search_path = public;

-- telegram_links: RLS без политик — намеренно, доступ только через telegram_link_code() и Edge Functions
comment on table telegram_links is 'Одноразовые коды привязки Telegram. Прямого доступа нет: только через функции.';
