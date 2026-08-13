-- 0005 · Attendance (student and staff)
--
-- Supports both per-day and per-period marking in one table: `period_id` is
-- NULL for daily attendance. Schools change their mind about this, and
-- migrating between two separate tables mid-year is not something anyone
-- should have to do.
--
-- Corrections are never silent overwrites. The edit window is enforced in the
-- API (default 48h); beyond it, `attendance.correct` permission is required
-- and the change is recorded in attendance_correction as well as audit_log.

create table holiday (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  session_id  uuid not null references academic_session(id) on delete cascade,
  date        date not null,
  name        text not null,
  applies_to  text not null default 'all'
                check (applies_to in ('all', 'students', 'staff')),
  created_at  timestamptz not null default now(),
  unique (tenant_id, session_id, date, applies_to)
);

create table attendance_record (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  session_id    uuid not null references academic_session(id) on delete cascade,
  enrolment_id  uuid not null references enrolment(id) on delete cascade,
  date          date not null,
  period_id     uuid references period(id) on delete restrict,  -- NULL = whole day
  status        text not null
                  check (status in ('present', 'absent', 'late', 'half_day', 'leave', 'excused')),
  remarks       text,
  marked_by     uuid not null references app_user(id) on delete restrict,
  marked_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger attendance_record_set_updated_at before update on attendance_record
  for each row execute function set_updated_at();

-- One record per enrolment per date per period. Two partial unique indexes
-- because NULL period_id would otherwise defeat a plain unique constraint.
create unique index attendance_record_daily_key
  on attendance_record (enrolment_id, date) where period_id is null;
create unique index attendance_record_period_key
  on attendance_record (enrolment_id, date, period_id) where period_id is not null;

create index attendance_record_date_idx on attendance_record (tenant_id, session_id, date);
create index attendance_record_enrolment_idx on attendance_record (enrolment_id, date desc);

create table attendance_correction (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenant(id) on delete cascade,
  attendance_record_id  uuid not null references attendance_record(id) on delete cascade,
  previous_status       text not null,
  new_status            text not null,
  reason                text not null,
  corrected_by          uuid not null references app_user(id) on delete restrict,
  corrected_at          timestamptz not null default now()
);

create index attendance_correction_record_idx on attendance_correction (attendance_record_id);

-- ---------------------------------------------------------------- staff

create table staff_attendance (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  session_id  uuid not null references academic_session(id) on delete cascade,
  staff_id    uuid not null references staff(id) on delete cascade,
  date        date not null,
  status      text not null
                check (status in ('present', 'absent', 'late', 'half_day', 'leave', 'holiday')),
  check_in    time,
  check_out   time,
  remarks     text,
  marked_by   uuid not null references app_user(id) on delete restrict,
  marked_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (staff_id, date),
  constraint staff_attendance_times check (check_out is null or check_in is null or check_out >= check_in)
);
create trigger staff_attendance_set_updated_at before update on staff_attendance
  for each row execute function set_updated_at();

create index staff_attendance_date_idx on staff_attendance (tenant_id, date);

-- ---------------------------------------------------------------- leave

create table leave_request (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  session_id    uuid not null references academic_session(id) on delete cascade,
  subject_type  text not null check (subject_type in ('student', 'staff')),
  enrolment_id  uuid references enrolment(id) on delete cascade,
  staff_id      uuid references staff(id) on delete cascade,
  from_date     date not null,
  to_date       date not null,
  reason        text not null,
  attachment_path text,
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid references app_user(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  requested_by  uuid not null references app_user(id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint leave_request_dates check (to_date >= from_date),
  -- exactly one subject, matching subject_type
  constraint leave_request_subject check (
    (subject_type = 'student' and enrolment_id is not null and staff_id is null) or
    (subject_type = 'staff'   and staff_id is not null and enrolment_id is null)
  )
);
create trigger leave_request_set_updated_at before update on leave_request
  for each row execute function set_updated_at();

create index leave_request_status_idx on leave_request (tenant_id, status, from_date);
