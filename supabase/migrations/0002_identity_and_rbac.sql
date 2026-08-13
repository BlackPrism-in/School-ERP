-- 0002 · Identity, sessions, RBAC
--
-- Custom auth (Lucia-style). Argon2id hashes are produced by the API server;
-- the database never sees a plaintext password. Sessions are opaque tokens
-- stored hashed, delivered as httpOnly + Secure + SameSite=Lax cookies.

-- ---------------------------------------------------------------- users

create table app_user (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenant(id) on delete restrict,
  email                 citext,
  phone                 text,
  password_hash         text not null,          -- argon2id, never plaintext
  display_name          text not null,
  status                text not null default 'active'
                          check (status in ('active', 'disabled', 'locked')),
  must_change_password  boolean not null default true,

  -- brute-force protection; the API also rate-limits at the edge
  failed_login_count    int not null default 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  last_login_ip         inet,

  -- MFA is mandatory for admin/superadmin (enforced in the API, not here,
  -- because the requirement is role-derived and roles are multi-valued)
  mfa_enabled           boolean not null default false,
  mfa_secret            text,
  mfa_recovery_codes    text[],

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,

  constraint app_user_needs_an_identifier check (email is not null or phone is not null)
);

-- Email is unique per tenant among live users. Partial index so a soft-deleted
-- user does not permanently reserve an address.
create unique index app_user_tenant_email_key
  on app_user (tenant_id, email) where deleted_at is null and email is not null;
create unique index app_user_tenant_phone_key
  on app_user (tenant_id, phone) where deleted_at is null and phone is not null;

create trigger app_user_set_updated_at
  before update on app_user
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- sessions

create table user_session (
  id            text primary key,        -- sha256 of the cookie token
  user_id       uuid not null references app_user(id) on delete cascade,
  tenant_id     uuid not null references tenant(id) on delete cascade,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  ip            inet,
  user_agent    text
);

create index user_session_user_idx on user_session (user_id);
create index user_session_expiry_idx on user_session (expires_at);

comment on column user_session.id is
  'SHA-256 of the session token. A database leak must not yield usable sessions.';

create table password_reset_token (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_user(id) on delete cascade,
  token_hash  text not null unique,      -- sha256, single use
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  requested_ip inet
);

create index password_reset_token_user_idx on password_reset_token (user_id);

-- ---------------------------------------------------------------- RBAC
--
-- Permissions are global constants (code-defined). Roles are per-tenant so a
-- school can eventually add its own, but the system roles are seeded and
-- cannot be deleted.

create table permission (
  key         text primary key,          -- 'student.read', 'fee.collect', ...
  module      text not null,             -- 'student' | 'fee' | 'exam' | ...
  description text not null
);

create table role (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  key         text not null,             -- 'admin', 'teacher', 'accountant', ...
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, key)
);

create trigger role_set_updated_at
  before update on role
  for each row execute function set_updated_at();

create table role_permission (
  role_id        uuid not null references role(id) on delete cascade,
  permission_key text not null references permission(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table user_role (
  user_id     uuid not null references app_user(id) on delete cascade,
  role_id     uuid not null references role(id) on delete cascade,
  granted_by  uuid references app_user(id),
  granted_at  timestamptz not null default now(),
  primary key (user_id, role_id)
);

-- ------------------------------------------------------------ seed data

insert into permission (key, module, description) values
  ('student.read',      'student',   'View student records'),
  ('student.write',     'student',   'Create and update student records'),
  ('student.delete',    'student',   'Withdraw or archive student records'),
  ('student.import',    'student',   'Bulk import students'),
  ('staff.read',        'staff',     'View staff records'),
  ('staff.write',       'staff',     'Create and update staff records'),
  ('enrolment.manage',  'student',   'Enrol, promote and transfer students'),
  ('attendance.read',   'attendance','View attendance'),
  ('attendance.mark',   'attendance','Record daily attendance'),
  ('attendance.correct','attendance','Amend attendance outside the edit window'),
  ('fee.read',          'fee',       'View fee structures, invoices and payments'),
  ('fee.configure',     'fee',       'Define fee heads, structures and fines'),
  ('fee.collect',       'fee',       'Collect payments and issue receipts'),
  ('fee.reverse',       'fee',       'Reverse a payment'),
  ('fee.concession',    'fee',       'Grant fee concessions'),
  ('exam.read',         'exam',      'View exams, marks and results'),
  ('exam.configure',    'exam',      'Create exams, subjects and grading schemes'),
  ('exam.mark',         'exam',      'Enter and submit marks'),
  ('exam.moderate',     'exam',      'Moderate submitted marks'),
  ('exam.publish',      'exam',      'Publish and lock results'),
  ('notice.read',       'notice',    'View notices'),
  ('notice.write',      'notice',    'Create and publish notices'),
  ('report.read',       'report',    'View operational reports'),
  ('audit.read',        'audit',     'Read the audit log'),
  ('user.manage',       'admin',     'Manage user accounts and role assignment'),
  ('settings.manage',   'admin',     'Manage school settings');

comment on table permission is
  'Global permission constants. Authorisation is enforced in the API; the client copy is for hiding UI only.';
