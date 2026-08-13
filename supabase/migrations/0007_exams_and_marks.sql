-- 0007 · Exams, marks, results
--
-- Marks move through an explicit state machine:
--   draft -> submitted -> moderated -> published -> locked
-- Only `exam.moderate` can move past submitted, only `exam.publish` past
-- moderated, and a locked exam rejects writes at the database level. Mark
-- disputes are the second most common thing (after fees) that a school will
-- need to defend with records, so every transition is audit-logged.

create table grading_scheme (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create unique index grading_scheme_one_default
  on grading_scheme (tenant_id) where is_default;

create table grade_band (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  grading_scheme_id uuid not null references grading_scheme(id) on delete cascade,
  grade             text not null,        -- 'A1'
  min_percent       numeric(5,2) not null check (min_percent >= 0 and min_percent <= 100),
  max_percent       numeric(5,2) not null check (max_percent >= 0 and max_percent <= 100),
  grade_point       numeric(4,2),
  remark            text,
  is_failing        boolean not null default false,
  unique (grading_scheme_id, grade),
  constraint grade_band_range check (max_percent >= min_percent)
);

create table exam_term (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  session_id     uuid not null references academic_session(id) on delete cascade,
  name           text not null,           -- 'Term I'
  sequence       int not null,
  weight_percent numeric(5,2) check (weight_percent between 0 and 100),
  unique (tenant_id, session_id, name)
);

create table exam (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  session_id        uuid not null references academic_session(id) on delete restrict,
  exam_term_id      uuid references exam_term(id) on delete set null,
  class_level_id    uuid not null references class_level(id) on delete restrict,
  grading_scheme_id uuid references grading_scheme(id) on delete set null,
  name              text not null,
  status            text not null default 'draft'
                      check (status in ('draft', 'scheduled', 'mark_entry',
                                        'moderation', 'published', 'locked')),
  published_at      timestamptz,
  published_by      uuid references app_user(id) on delete set null,
  created_by        uuid not null references app_user(id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, session_id, class_level_id, name)
);
create trigger exam_set_updated_at before update on exam
  for each row execute function set_updated_at();

create table exam_subject (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  exam_id       uuid not null references exam(id) on delete cascade,
  subject_id    uuid not null references subject(id) on delete restrict,
  exam_date     date,
  start_time    time,
  duration_min  int check (duration_min is null or duration_min > 0),
  -- component maxima; a component with max 0 is simply not used
  theory_max    numeric(6,2) not null default 0 check (theory_max >= 0),
  practical_max numeric(6,2) not null default 0 check (practical_max >= 0),
  objective_max numeric(6,2) not null default 0 check (objective_max >= 0),
  total_max     numeric(6,2) not null generated always as
                  (theory_max + practical_max + objective_max) stored,
  pass_marks    numeric(6,2) not null default 0 check (pass_marks >= 0),
  unique (exam_id, subject_id)
);

create index exam_subject_exam_idx on exam_subject (exam_id);

create table mark (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenant(id) on delete cascade,
  exam_subject_id  uuid not null references exam_subject(id) on delete cascade,
  enrolment_id     uuid not null references enrolment(id) on delete cascade,
  is_absent        boolean not null default false,
  theory_marks     numeric(6,2) check (theory_marks >= 0),
  practical_marks  numeric(6,2) check (practical_marks >= 0),
  objective_marks  numeric(6,2) check (objective_marks >= 0),
  total_marks      numeric(6,2) not null generated always as
                     (coalesce(theory_marks, 0) + coalesce(practical_marks, 0)
                      + coalesce(objective_marks, 0)) stored,
  grade            text,
  remarks          text,
  status           text not null default 'draft'
                     check (status in ('draft', 'submitted', 'moderated', 'published')),
  entered_by       uuid not null references app_user(id) on delete restrict,
  entered_at       timestamptz not null default now(),
  moderated_by     uuid references app_user(id) on delete set null,
  moderated_at     timestamptz,
  updated_at       timestamptz not null default now(),
  unique (exam_subject_id, enrolment_id)
);
create trigger mark_set_updated_at before update on mark
  for each row execute function set_updated_at();

create index mark_enrolment_idx on mark (enrolment_id);

-- An absent student has no component marks; a present one must not exceed the
-- configured maxima. The maxima check needs the parent row, so it lives in a
-- trigger rather than a CHECK constraint.
create or replace function validate_mark() returns trigger
language plpgsql as $$
declare
  s exam_subject%rowtype;
  e_status text;
begin
  select * into s from exam_subject where id = new.exam_subject_id;
  select status into e_status from exam where id = s.exam_id;

  if e_status = 'locked' then
    raise exception 'Exam is locked; marks cannot be changed.'
      using errcode = 'restrict_violation';
  end if;

  if new.is_absent then
    if coalesce(new.theory_marks, new.practical_marks, new.objective_marks) is not null then
      raise exception 'An absent student cannot have component marks.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if coalesce(new.theory_marks, 0) > s.theory_max
     or coalesce(new.practical_marks, 0) > s.practical_max
     or coalesce(new.objective_marks, 0) > s.objective_max then
    raise exception 'Marks exceed the configured maximum for this exam subject.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger mark_validate
  before insert or update on mark
  for each row execute function validate_mark();

-- Per-student consolidated result for an exam, produced by the publish step.
create table exam_result (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  exam_id        uuid not null references exam(id) on delete cascade,
  enrolment_id   uuid not null references enrolment(id) on delete cascade,
  obtained_marks numeric(8,2) not null,
  max_marks      numeric(8,2) not null check (max_marks > 0),
  percentage     numeric(5,2) not null,
  grade          text,
  grade_point    numeric(4,2),
  rank_in_class  int,
  outcome        text not null check (outcome in ('pass', 'fail', 'compartment', 'absent')),
  published_at   timestamptz not null default now(),
  unique (exam_id, enrolment_id)
);

create index exam_result_exam_idx on exam_result (exam_id, rank_in_class);
