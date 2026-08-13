-- 0008 · Notices
--
-- Audience targeting is a separate table rather than columns on `notice`, so
-- one notice can go to (say) two sections plus all teachers without either
-- duplicating the notice or encoding a list in a text column.

create table notice (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  session_id    uuid not null references academic_session(id) on delete cascade,
  title         text not null,
  body          text not null,
  category      text default 'general',
  priority      text not null default 'normal'
                  check (priority in ('low', 'normal', 'high', 'urgent')),
  attachment_path text,
  publish_at    timestamptz not null default now(),
  expires_at    timestamptz,
  status        text not null default 'draft'
                  check (status in ('draft', 'published', 'archived')),
  created_by    uuid not null references app_user(id) on delete restrict,
  published_by  uuid references app_user(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint notice_expiry check (expires_at is null or expires_at > publish_at)
);
create trigger notice_set_updated_at before update on notice
  for each row execute function set_updated_at();

create index notice_feed_idx on notice (tenant_id, session_id, status, publish_at desc);

create table notice_audience (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  notice_id      uuid not null references notice(id) on delete cascade,
  audience_type  text not null
                   check (audience_type in ('everyone', 'role', 'class_level', 'section', 'student')),
  role_id        uuid references role(id) on delete cascade,
  class_level_id uuid references class_level(id) on delete cascade,
  section_id     uuid references section(id) on delete cascade,
  student_id     uuid references student(id) on delete cascade,
  -- the target column must match the declared audience_type
  constraint notice_audience_target check (
    (audience_type = 'everyone'    and role_id is null and class_level_id is null
                                   and section_id is null and student_id is null) or
    (audience_type = 'role'        and role_id is not null) or
    (audience_type = 'class_level' and class_level_id is not null) or
    (audience_type = 'section'     and section_id is not null) or
    (audience_type = 'student'     and student_id is not null)
  )
);

create index notice_audience_notice_idx on notice_audience (notice_id);
create index notice_audience_section_idx on notice_audience (section_id) where section_id is not null;

create table notice_read (
  notice_id  uuid not null references notice(id) on delete cascade,
  user_id    uuid not null references app_user(id) on delete cascade,
  tenant_id  uuid not null references tenant(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (notice_id, user_id)
);

create index notice_read_user_idx on notice_read (user_id);
