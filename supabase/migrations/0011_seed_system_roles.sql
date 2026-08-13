-- 0011 · System roles and their permission grants
--
-- Seeds the five system roles for every existing tenant and keeps the grant
-- matrix in one readable place. MVP ships staff-side roles plus the student
-- portal; `guardian` is seeded now with read-only grants so the parent portal
-- is a UI project later, not a permissions project.
--
-- Re-runnable: safe to execute again after adding a permission.

create or replace function seed_system_roles(p_tenant_id uuid) returns void
language plpgsql as $$
declare
  r record;
  v_role_id uuid;
  grants jsonb := jsonb_build_object(
    'superadmin', jsonb_build_array('*'),

    'admin', jsonb_build_array(
      'student.read','student.write','student.delete','student.import',
      'staff.read','staff.write','enrolment.manage',
      'attendance.read','attendance.mark','attendance.correct',
      'fee.read','fee.configure','fee.collect','fee.concession',
      'exam.read','exam.configure','exam.publish',
      'notice.read','notice.write','report.read',
      'user.manage','settings.manage'
    ),

    'accountant', jsonb_build_array(
      'student.read','fee.read','fee.configure','fee.collect',
      'fee.concession','report.read','notice.read'
    ),

    -- Teachers are additionally scoped in the API to their own sections:
    -- these permissions say WHAT, teaching_assignment says WHOSE.
    'teacher', jsonb_build_array(
      'student.read','attendance.read','attendance.mark',
      'exam.read','exam.mark','notice.read','notice.write','report.read'
    ),

    -- student.read here means "read a student record", scoped by
    -- resolve_access_scope to their own enrolment only. Without it a pupil
    -- cannot load their own profile page.
    'student', jsonb_build_array(
      'student.read','attendance.read','fee.read','exam.read','notice.read'
    ),

    'guardian', jsonb_build_array(
      'student.read','attendance.read','fee.read','exam.read','notice.read'
    )
  );
  names jsonb := jsonb_build_object(
    'superadmin','Super Admin', 'admin','Administrator', 'accountant','Accountant',
    'teacher','Teacher', 'student','Student', 'guardian','Guardian'
  );
begin
  for r in select key, value from jsonb_each(grants) loop
    insert into role (tenant_id, key, name, is_system)
    values (p_tenant_id, r.key, names ->> r.key, true)
    on conflict (tenant_id, key) do update set name = excluded.name
    returning id into v_role_id;

    delete from role_permission where role_id = v_role_id;

    if r.value ? '*' then
      insert into role_permission (role_id, permission_key)
      select v_role_id, key from permission;
    else
      insert into role_permission (role_id, permission_key)
      select v_role_id, jsonb_array_elements_text(r.value);
    end if;
  end loop;
end $$;

comment on function seed_system_roles is
  'Idempotent. Call after adding a permission so every tenant picks up the new grant matrix.';

-- Apply to any tenants that already exist.
do $$
declare t uuid;
begin
  for t in select id from tenant loop
    perform seed_system_roles(t);
  end loop;
end $$;
