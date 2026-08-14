-- 0014 · Audit triggers for attendance and school structure
--
-- Migration 0009 wired the row auditor to students, staff, money and marks but
-- not to attendance. That left a real hole: `attendance_correction` records
-- amendments made *after* the edit window, but a change inside the window —
-- flipping a child from absent to present the same afternoon — left no trace
-- whatsoever. Absences are among the most disputed records a school holds, so
-- every write needs to be reconstructable, not just the late ones.
--
-- School structure is audited for a different reason: renaming a class or
-- moving a section silently reinterprets every report that references it.

create trigger audit_attendance_record
  after insert or update or delete on attendance_record
  for each row execute function audit_row_change();

create trigger audit_attendance_correction
  after insert or update or delete on attendance_correction
  for each row execute function audit_row_change();

create trigger audit_staff_attendance
  after insert or update or delete on staff_attendance
  for each row execute function audit_row_change();

create trigger audit_leave_request
  after insert or update or delete on leave_request
  for each row execute function audit_row_change();

create trigger audit_holiday
  after insert or update or delete on holiday
  for each row execute function audit_row_change();

create trigger audit_academic_session
  after insert or update or delete on academic_session
  for each row execute function audit_row_change();

create trigger audit_class_level
  after insert or update or delete on class_level
  for each row execute function audit_row_change();

create trigger audit_section
  after insert or update or delete on section
  for each row execute function audit_row_change();

create trigger audit_subject
  after insert or update or delete on subject
  for each row execute function audit_row_change();

create trigger audit_teaching_assignment
  after insert or update or delete on teaching_assignment
  for each row execute function audit_row_change();

-- Attendance is the highest-volume audited table by a wide margin: roughly
-- (students x school days) rows per year, each generating an audit entry.
-- This index keeps "show me the history of this record" fast once the log is
-- large, which is precisely when someone is disputing something.
create index if not exists audit_log_attendance_idx
  on audit_log (entity_type, entity_id, created_at desc)
  where entity_type in ('attendance_record', 'attendance_correction');
