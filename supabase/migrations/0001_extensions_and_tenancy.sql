-- 0001 · Extensions, tenancy root, shared helpers
--
-- Tenancy strategy: single shared schema, `tenant_id` on every tenant-scoped
-- table from day one. We run with exactly one tenant row today; going
-- multi-tenant later is then a matter of onboarding rows and turning on the
-- RLS policies in 0010, not a migration of every table in the system.
--
-- The API server sets `app.tenant_id` and `app.user_id` per transaction
-- (SET LOCAL). Those GUCs drive both the audit trigger and the RLS policies.

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive email

-- ---------------------------------------------------------------- helpers

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Current request context. `true` = missing GUC returns NULL rather than
-- raising, so migrations and maintenance jobs can run without a context.
create or replace function app_current_tenant() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create or replace function app_current_user() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------- tenant

create table tenant (
  id          uuid primary key default gen_random_uuid(),
  slug        citext not null unique,
  name        text not null,
  timezone    text not null default 'Asia/Kolkata',
  locale      text not null default 'en-IN',
  currency    char(3) not null default 'INR',
  status      text not null default 'active'
                check (status in ('active', 'suspended', 'archived')),
  -- DPDP: the school is the Data Fiduciary, we are the Data Processor.
  -- Retention is enforced by the purge job against this value.
  data_retention_years int not null default 7 check (data_retention_years between 1 and 25),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger tenant_set_updated_at
  before update on tenant
  for each row execute function set_updated_at();

comment on table tenant is
  'Root of tenancy. One row today; the column exists on every child table so multi-tenant is an onboarding step, not a rewrite.';

-- ---------------------------------------------------- gapless doc numbers
--
-- Receipt and invoice numbers must be gapless for audit. A Postgres sequence
-- is NOT suitable: it does not roll back, so a failed transaction burns a
-- number and leaves a hole an auditor will ask about. Instead we lock a
-- counter row inside the same transaction as the document insert.

create table document_sequence (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  scope         text not null,          -- 'receipt' | 'invoice' | 'admission' | ...
  scope_key     text not null default '', -- e.g. session id or branch id, '' for tenant-wide
  prefix        text not null default '',
  next_number   bigint not null default 1 check (next_number > 0),
  padding       int not null default 5 check (padding between 1 and 12),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, scope, scope_key)
);

create trigger document_sequence_set_updated_at
  before update on document_sequence
  for each row execute function set_updated_at();

-- Returns the next formatted document number, e.g. 'RCT/2026-27/00042'.
-- Callers MUST invoke this inside the same transaction as the insert so a
-- rollback returns the number to the pool.
create or replace function next_document_number(
  p_tenant_id uuid,
  p_scope     text,
  p_scope_key text default ''
) returns text
language plpgsql as $$
declare
  v_prefix  text;
  v_number  bigint;
  v_padding int;
begin
  update document_sequence
     set next_number = next_number + 1
   where tenant_id = p_tenant_id
     and scope     = p_scope
     and scope_key = p_scope_key
  returning prefix, next_number - 1, padding
       into v_prefix, v_number, v_padding;

  if not found then
    raise exception 'No document_sequence for tenant % scope % key %',
      p_tenant_id, p_scope, p_scope_key
      using errcode = 'no_data_found';
  end if;

  return v_prefix || lpad(v_number::text, v_padding, '0');
end $$;

comment on function next_document_number is
  'Gapless document numbering. Locks the counter row for the caller''s transaction; a rollback releases the number.';
