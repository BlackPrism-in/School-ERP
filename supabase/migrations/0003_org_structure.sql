-- 0003 · Organisation structure
--
-- Branch → academic session → class level → section is the spine everything
-- else hangs off. Sessions are first-class: almost every operational record
-- is scoped to one, which is what makes year-end promotion and historical
-- reporting work instead of silently mixing years together.

create table branch (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  code        text not null,
  name        text not null,
  address     text,
  phone       text,
  email       citext,
  is_primary  boolean not null default false,
  status      text not null default 'active' check (status in ('active', 'inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (tenant_id, code)
);
create trigger branch_set_updated_at before update on branch
  for each row execute function set_updated_at();

create table academic_session (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  name        text not null,             -- '2026-27'
  start_date  date not null,
  end_date    date not null,
  is_current  boolean not null default false,
  status      text not null default 'planned'
                check (status in ('planned', 'active', 'closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, name),
  constraint academic_session_dates check (end_date > start_date)
);
create trigger academic_session_set_updated_at before update on academic_session
  for each row execute function set_updated_at();

-- Exactly one current session per tenant. Enforced here rather than in the
-- API because "which year are we in" is read by nearly every query.
create unique index academic_session_one_current
  on academic_session (tenant_id) where is_current;

create table class_level (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  name          text not null,           -- 'Grade 10'
  code          text,
  sort_order    int not null default 0,  -- drives promotion ordering
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (tenant_id, name)
);
create trigger class_level_set_updated_at before update on class_level
  for each row execute function set_updated_at();

create table section (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  branch_id       uuid not null references branch(id) on delete restrict,
  class_level_id  uuid not null references class_level(id) on delete restrict,
  session_id      uuid not null references academic_session(id) on delete restrict,
  name            text not null,         -- 'A'
  capacity        int check (capacity is null or capacity > 0),
  -- class_teacher_id FK added in 0004 once staff exists
  class_teacher_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (tenant_id, session_id, branch_id, class_level_id, name)
);
create trigger section_set_updated_at before update on section
  for each row execute function set_updated_at();

create index section_session_idx on section (tenant_id, session_id);

create table subject (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  name        text not null,
  code        text,
  kind        text not null default 'theory'
                check (kind in ('theory', 'practical', 'both', 'non_academic')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (tenant_id, name)
);
create trigger subject_set_updated_at before update on subject
  for each row execute function set_updated_at();

-- Which subjects a class studies in a given session.
create table class_subject (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  session_id      uuid not null references academic_session(id) on delete cascade,
  class_level_id  uuid not null references class_level(id) on delete cascade,
  subject_id      uuid not null references subject(id) on delete restrict,
  is_optional     boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (tenant_id, session_id, class_level_id, subject_id)
);

-- Timetable periods. Attendance can be per-day (period_id null) or per-period.
create table period (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  name        text not null,             -- 'Period 1'
  start_time  time not null,
  end_time    time not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name),
  constraint period_times check (end_time > start_time)
);
