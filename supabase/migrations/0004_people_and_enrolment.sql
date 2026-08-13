-- 0004 · Students, guardians, staff, enrolment
--
-- The key design decision: `student` holds the person (stable for life),
-- `enrolment` holds their placement in one academic session. Attendance,
-- fees, marks and results all reference the ENROLMENT, never the student
-- directly. That is what makes year-on-year history correct and promotion a
-- matter of inserting a new row rather than mutating the old one.
--
-- Guardians are modelled now even though the parent portal is a later phase:
-- a student record is incomplete without contacts, and retrofitting the
-- link table after fee invoices exist would be painful.

-- ---------------------------------------------------------------- student

create table student (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  user_id        uuid references app_user(id) on delete set null,  -- portal login
  admission_no   text not null,
  first_name     text not null,
  last_name      text,
  date_of_birth  date,
  gender         text check (gender in ('male', 'female', 'other', 'undisclosed')),
  blood_group    text,
  nationality    text,
  religion       text,
  category       text,                    -- reservation category, statutory reporting
  photo_path     text,                    -- object storage key, not a public URL
  address_line   text,
  city           text,
  state          text,
  postal_code    text,
  admission_date date,
  status         text not null default 'active'
                   check (status in ('active', 'transferred', 'withdrawn', 'alumni')),
  -- DPDP: sensitive fields kept minimal and separately auditable
  medical_notes  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (tenant_id, admission_no)
);
create trigger student_set_updated_at before update on student
  for each row execute function set_updated_at();

create index student_name_idx on student (tenant_id, last_name, first_name);
create index student_status_idx on student (tenant_id, status) where deleted_at is null;

comment on column student.medical_notes is
  'Sensitive personal data under DPDP. Read access is permission-gated and every read is audit-logged.';

-- ---------------------------------------------------------------- guardian

create table guardian (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  user_id      uuid references app_user(id) on delete set null,  -- parent portal, later phase
  first_name   text not null,
  last_name    text,
  phone        text not null,
  alt_phone    text,
  email        citext,
  occupation   text,
  address_line text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create trigger guardian_set_updated_at before update on guardian
  for each row execute function set_updated_at();

create index guardian_phone_idx on guardian (tenant_id, phone);

create table student_guardian (
  student_id           uuid not null references student(id) on delete cascade,
  guardian_id          uuid not null references guardian(id) on delete cascade,
  tenant_id            uuid not null references tenant(id) on delete cascade,
  relation             text not null
                         check (relation in ('father', 'mother', 'guardian', 'other')),
  is_primary_contact   boolean not null default false,
  is_emergency_contact boolean not null default false,
  -- DPDP: the guardian who consented on the child's behalf
  is_consent_giver     boolean not null default false,
  created_at           timestamptz not null default now(),
  primary key (student_id, guardian_id)
);

-- At most one primary contact per student.
create unique index student_guardian_one_primary
  on student_guardian (student_id) where is_primary_contact;

-- ---------------------------------------------------------------- staff

create table staff (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  user_id         uuid references app_user(id) on delete set null,
  branch_id       uuid references branch(id) on delete set null,
  employee_no     text not null,
  first_name      text not null,
  last_name       text,
  date_of_birth   date,
  gender          text check (gender in ('male', 'female', 'other', 'undisclosed')),
  designation     text,
  department      text,
  is_teaching     boolean not null default true,
  phone           text,
  email           citext,
  photo_path      text,
  join_date       date,
  exit_date       date,
  employment_type text default 'permanent'
                    check (employment_type in ('permanent', 'contract', 'part_time', 'visiting')),
  status          text not null default 'active'
                    check (status in ('active', 'on_leave', 'resigned', 'terminated')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (tenant_id, employee_no),
  constraint staff_exit_after_join check (exit_date is null or join_date is null or exit_date >= join_date)
);
create trigger staff_set_updated_at before update on staff
  for each row execute function set_updated_at();

-- Deferred FK from 0003 now that staff exists.
alter table section
  add constraint section_class_teacher_fkey
  foreign key (class_teacher_id) references staff(id) on delete set null;

-- Which teacher teaches which subject to which section. This is the row-level
-- scope for a teacher's access: they see the sections they appear in here,
-- plus any section where they are class_teacher_id.
create table teaching_assignment (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  session_id  uuid not null references academic_session(id) on delete cascade,
  staff_id    uuid not null references staff(id) on delete cascade,
  section_id  uuid not null references section(id) on delete cascade,
  subject_id  uuid not null references subject(id) on delete restrict,
  created_at  timestamptz not null default now(),
  unique (tenant_id, session_id, staff_id, section_id, subject_id)
);

create index teaching_assignment_staff_idx on teaching_assignment (tenant_id, staff_id, session_id);
create index teaching_assignment_section_idx on teaching_assignment (tenant_id, section_id);

-- ---------------------------------------------------------------- enrolment

create table enrolment (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  student_id      uuid not null references student(id) on delete restrict,
  session_id      uuid not null references academic_session(id) on delete restrict,
  branch_id       uuid not null references branch(id) on delete restrict,
  class_level_id  uuid not null references class_level(id) on delete restrict,
  section_id      uuid not null references section(id) on delete restrict,
  roll_no         text,
  enrolled_on     date not null default current_date,
  status          text not null default 'enrolled'
                    check (status in ('enrolled', 'promoted', 'retained', 'transferred', 'withdrawn')),
  -- set when this enrolment is superseded by promotion, for a clean audit trail
  promoted_to_id  uuid references enrolment(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A student has exactly one enrolment per session. This single constraint
  -- prevents the most common class of ERP data corruption.
  unique (student_id, session_id)
);
create trigger enrolment_set_updated_at before update on enrolment
  for each row execute function set_updated_at();

create unique index enrolment_roll_no_key
  on enrolment (tenant_id, session_id, section_id, roll_no) where roll_no is not null;

create index enrolment_section_idx on enrolment (tenant_id, session_id, section_id);
create index enrolment_student_idx on enrolment (student_id);

comment on table enrolment is
  'A student''s placement in one academic session. Attendance, fees and marks reference this, never student directly.';
