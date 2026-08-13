-- 0012 · Make the erp_app role usable, and unblock pre-context lookups
--
-- Two things surfaced while building the API request-context layer in Phase 1.
--
-- 1. `SET LOCAL ROLE erp_app` requires the connecting user to be a member of
--    erp_app. On Supabase you connect as `postgres`, so grant the membership.
--    In production you may instead give erp_app LOGIN and connect as it
--    directly; both paths work with the API's DB_APP_ROLE setting.
--
-- 2. Resolving which tenant a request belongs to happens BEFORE
--    app.tenant_id can be set — it is the query that determines it. The
--    original `tenant_self` policy made that lookup return zero rows, so the
--    API could never bootstrap a request. The tenant table holds no personal
--    data, so allowing a read while context is unset is safe; every table
--    that does hold personal data keeps the strict policy.

grant erp_app to current_user;

drop policy if exists tenant_self on tenant;
create policy tenant_self on tenant
  using (app_current_tenant() is null or id = app_current_tenant())
  with check (id = app_current_tenant());

comment on policy tenant_self on tenant is
  'Readable while app.tenant_id is unset so a request can resolve its own tenant; writes still require matching context.';
