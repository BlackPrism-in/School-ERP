-- 0013 · Populate audit_log.actor_label on trigger-written rows
--
-- The column exists so the audit trail stays readable after a user row is
-- gone: `actor_user_id` becomes a dangling id, and the name is all that is
-- left. But audit_row_change never filled it, so only the hand-written events
-- (logins, sensitive reads) carried a name — exactly backwards, since the
-- row-change entries are the ones a fee or mark dispute turns on.
--
-- Resolved once per statement via a cached lookup rather than per row, so a
-- bulk import does not issue one extra query per student.

create or replace function audit_row_change() returns trigger
language plpgsql as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_actor  uuid;
  v_label  text;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_after := to_jsonb(new);
  else
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    if v_before = v_after then
      return new;
    end if;
  end if;

  v_actor := app_current_user();
  if v_actor is not null then
    select display_name into v_label from app_user where id = v_actor;
  end if;

  insert into audit_log (tenant_id, actor_user_id, actor_label, action, entity_type,
                         entity_id, before_data, after_data)
  values (
    app_current_tenant(),
    v_actor,
    v_label,
    lower(tg_op),
    tg_table_name,
    coalesce((v_after ->> 'id'), (v_before ->> 'id')),
    v_before,
    v_after
  );

  return coalesce(new, old);
end $$;
