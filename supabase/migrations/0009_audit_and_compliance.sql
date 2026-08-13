-- 0009 · Audit log, documents, DPDP compliance
--
-- India's Digital Personal Data Protection Act 2023 treats children's data as
-- a special category: processing requires verifiable parental consent, and
-- tracking/behavioural monitoring and targeted advertising directed at
-- children are prohibited outright. The school is the Data Fiduciary; we are
-- the Data Processor acting on their instructions.
--
-- These tables are what let the school actually answer a parent who asks
-- "what do you hold on my child, who has looked at it, and please delete it."

-- ---------------------------------------------------------------- audit

create table audit_log (
  id            bigserial primary key,
  tenant_id     uuid references tenant(id) on delete set null,
  actor_user_id uuid references app_user(id) on delete set null,
  actor_label   text,                    -- denormalised: survives user deletion
  action        text not null,           -- 'create' | 'update' | 'delete' | 'read' | 'login' | ...
  entity_type   text not null,           -- table name
  entity_id     text,
  before_data   jsonb,
  after_data    jsonb,
  ip            inet,
  user_agent    text,
  request_id    text,                    -- correlates with API logs
  created_at    timestamptz not null default now()
);

create index audit_log_entity_idx on audit_log (tenant_id, entity_type, entity_id, created_at desc);
create index audit_log_actor_idx  on audit_log (tenant_id, actor_user_id, created_at desc);
create index audit_log_time_idx   on audit_log (tenant_id, created_at desc);

comment on table audit_log is
  'Append-only. Financial and mark records are defended with this; do not permit UPDATE or DELETE.';

create or replace function block_audit_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only.' using errcode = 'restrict_violation';
end $$;

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function block_audit_mutation();

-- Generic row auditor. Attach to any table whose writes must be traceable.
-- Reads are logged by the API (a SELECT trigger does not exist in Postgres).
create or replace function audit_row_change() returns trigger
language plpgsql as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_after := to_jsonb(new);
  else
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    -- skip no-op updates
    if v_before = v_after then
      return new;
    end if;
  end if;

  insert into audit_log (tenant_id, actor_user_id, action, entity_type, entity_id,
                         before_data, after_data)
  values (
    app_current_tenant(),
    app_current_user(),
    lower(tg_op),
    tg_table_name,
    coalesce((v_after ->> 'id'), (v_before ->> 'id')),
    v_before,
    v_after
  );

  return coalesce(new, old);
end $$;

-- Tables where every write must be traceable. Extend this list as modules land.
create trigger audit_student        after insert or update or delete on student
  for each row execute function audit_row_change();
create trigger audit_enrolment      after insert or update or delete on enrolment
  for each row execute function audit_row_change();
create trigger audit_staff          after insert or update or delete on staff
  for each row execute function audit_row_change();
create trigger audit_invoice        after insert or update or delete on invoice
  for each row execute function audit_row_change();
create trigger audit_payment        after insert or update or delete on payment
  for each row execute function audit_row_change();
create trigger audit_student_concession after insert or update or delete on student_concession
  for each row execute function audit_row_change();
create trigger audit_mark           after insert or update or delete on mark
  for each row execute function audit_row_change();
create trigger audit_exam           after insert or update or delete on exam
  for each row execute function audit_row_change();
create trigger audit_user_role      after insert or update or delete on user_role
  for each row execute function audit_row_change();
create trigger audit_app_user       after insert or update or delete on app_user
  for each row execute function audit_row_change();

-- ---------------------------------------------------------------- documents

create table document (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  owner_type    text not null,           -- 'student' | 'staff' | 'notice' | ...
  owner_id      uuid not null,
  category      text,                    -- 'birth_certificate' | 'transfer_certificate' | ...
  file_name     text not null,
  storage_path  text not null,           -- Supabase Storage key; bucket is private
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes >= 0),
  is_sensitive  boolean not null default false,
  uploaded_by   uuid not null references app_user(id) on delete restrict,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index document_owner_idx on document (tenant_id, owner_type, owner_id)
  where deleted_at is null;

comment on column document.storage_path is
  'Private bucket key. Never expose directly; serve via short-lived signed URLs issued after an authorisation check.';

-- ------------------------------------------------------------ DPDP records

create table consent_record (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  student_id    uuid not null references student(id) on delete cascade,
  guardian_id   uuid references guardian(id) on delete set null,
  purpose       text not null,           -- 'core_academic_records' | 'photography' | 'sms_updates' | ...
  is_granted    boolean not null,
  notice_version text not null,          -- which privacy notice they saw
  granted_at    timestamptz,
  withdrawn_at  timestamptz,
  evidence      jsonb,                   -- signed form reference, IP, channel
  recorded_by   uuid references app_user(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index consent_record_student_idx on consent_record (student_id, purpose);

comment on table consent_record is
  'DPDP s.9: processing a child''s data requires verifiable parental consent, per purpose, and withdrawal must be as easy as granting.';

create table data_subject_request (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  subject_type  text not null check (subject_type in ('student', 'guardian', 'staff')),
  subject_id    uuid not null,
  request_type  text not null check (request_type in ('access', 'correction', 'erasure', 'grievance')),
  details       text,
  status        text not null default 'received'
                  check (status in ('received', 'in_progress', 'fulfilled', 'rejected')),
  received_at   timestamptz not null default now(),
  due_by        timestamptz,
  fulfilled_at  timestamptz,
  handled_by    uuid references app_user(id) on delete set null,
  resolution    text,
  export_path   text                     -- object storage key of the generated export
);

create index data_subject_request_open_idx on data_subject_request (tenant_id, status, due_by);

comment on table data_subject_request is
  'Tracks parent/staff access, correction and erasure requests so the school can evidence compliance.';
