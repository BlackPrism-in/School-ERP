-- 0010 · Row Level Security — tenant isolation
--
-- The API server is the only database client and it already scopes every
-- query by tenant. RLS is the second line of defence: if a query is ever
-- written without a tenant filter, the database returns nothing rather than
-- another school's students. With a single tenant today this is invisible;
-- the day a second school is onboarded it is the thing standing between them.
--
-- Contract: the API opens each request transaction with
--     SET LOCAL app.tenant_id = '<uuid>';
--     SET LOCAL app.user_id   = '<uuid>';
-- and connects as `erp_app`, which is NOT the table owner and does NOT have
-- BYPASSRLS. Row-level scoping *within* a tenant (a teacher seeing only their
-- sections, a student seeing only themselves) stays in the API, where it can
-- produce a meaningful 403 instead of a confusing empty list.

-- ------------------------------------------------------- application role

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    create role erp_app nologin;
  end if;
end $$;

grant usage on schema public to erp_app;
grant select, insert, update, delete on all tables in schema public to erp_app;
grant usage, select on all sequences in schema public to erp_app;
grant execute on all functions in schema public to erp_app;

alter default privileges in schema public
  grant select, insert, update, delete on tables to erp_app;
alter default privileges in schema public
  grant usage, select on sequences to erp_app;

-- erp_app must never be able to sidestep the policies below.
alter role erp_app nobypassrls;

-- ---------------------------------------------------------------- policies
--
-- Applied to every table carrying a tenant_id. Written as a loop so a new
-- table cannot be forgotten: re-run this block after adding tables, or better,
-- add the equivalent two statements to that table's own migration.

do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attname = 'tenant_id'
       and not a.attisdropped
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('alter table public.%I force row level security', t.relname);

    execute format($p$
      drop policy if exists tenant_isolation on public.%I;
      create policy tenant_isolation on public.%I
        using (tenant_id = app_current_tenant())
        with check (tenant_id = app_current_tenant());
    $p$, t.relname, t.relname);
  end loop;
end $$;

-- The tenant table itself: a request may only see its own tenant row.
alter table tenant enable row level security;
alter table tenant force row level security;
drop policy if exists tenant_self on tenant;
create policy tenant_self on tenant
  using (id = app_current_tenant())
  with check (id = app_current_tenant());

-- user_session and password_reset_token are read during authentication,
-- BEFORE app.tenant_id can be known. They are looked up by an unguessable
-- token hash, and the resolved tenant is what populates the GUC.
alter table user_session no force row level security;
drop policy if exists tenant_isolation on user_session;
create policy session_lookup on user_session
  using (app_current_tenant() is null or tenant_id = app_current_tenant());

alter table password_reset_token disable row level security;

-- `permission` is a global constant table with no tenant_id — readable by all.
grant select on permission to erp_app;

comment on policy tenant_isolation on student is
  'Defence in depth. A query missing its tenant filter returns zero rows instead of another school''s children.';
