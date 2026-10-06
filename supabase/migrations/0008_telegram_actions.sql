-- НарядAI — действия мастера из Telegram: переназначение «от имени» мастера (только service_role).
create or replace function reassign_as(p_actor uuid, p_order_id bigint, p_assignee uuid)
returns orders language plpgsql security definer set search_path = public as $$
begin
  perform set_config('narad.actor', p_actor::text, true);
  return reassign_order(p_order_id, p_assignee, 'переназначено из Telegram');
end $$;
revoke execute on function reassign_as(uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function reassign_as(uuid, bigint, uuid) to service_role;
grant execute on function reassign_order(bigint, uuid, text) to service_role;
