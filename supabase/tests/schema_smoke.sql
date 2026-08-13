-- Schema smoke test. Asserts the invariants the ERP depends on.
-- Run: psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/schema_smoke.sql
-- Every assertion raises on failure, so a clean run means all checks passed.

\set QUIET on
set client_min_messages = notice;

do $$
declare
  v_tenant   uuid; v_other_tenant uuid;
  v_session  uuid; v_branch uuid; v_class uuid; v_section uuid; v_subject uuid;
  v_admin    uuid; v_student uuid; v_enrol uuid; v_enrol2 uuid;
  v_head     uuid; v_invoice uuid; v_payment uuid;
  v_exam     uuid; v_exam_subject uuid;
  v_rcpt1    text; v_rcpt2 text; v_rcpt3 text;
  v_count    int;  v_balance numeric;
  v_ok       boolean;
begin
  -- ------------------------------------------------------------ fixtures
  insert into tenant (slug, name) values ('smoke-school', 'Smoke Test School') returning id into v_tenant;
  insert into tenant (slug, name) values ('other-school', 'Other School') returning id into v_other_tenant;
  perform seed_system_roles(v_tenant);
  perform set_config('app.tenant_id', v_tenant::text, false);

  insert into app_user (tenant_id, email, password_hash, display_name)
    values (v_tenant, 'admin@smoke.test', '$argon2id$dummy', 'Admin') returning id into v_admin;
  perform set_config('app.user_id', v_admin::text, false);

  insert into branch (tenant_id, code, name) values (v_tenant, 'MAIN', 'Main Campus') returning id into v_branch;
  insert into academic_session (tenant_id, name, start_date, end_date, is_current, status)
    values (v_tenant, '2026-27', '2026-04-01', '2027-03-31', true, 'active') returning id into v_session;
  insert into class_level (tenant_id, name, sort_order) values (v_tenant, 'Grade 10', 10) returning id into v_class;
  insert into section (tenant_id, branch_id, class_level_id, session_id, name)
    values (v_tenant, v_branch, v_class, v_session, 'A') returning id into v_section;
  insert into subject (tenant_id, name) values (v_tenant, 'Mathematics') returning id into v_subject;

  insert into student (tenant_id, admission_no, first_name, last_name, admission_date)
    values (v_tenant, 'ADM-0001', 'Aarav', 'Mehta', '2026-04-05') returning id into v_student;
  insert into enrolment (tenant_id, student_id, session_id, branch_id, class_level_id, section_id, roll_no)
    values (v_tenant, v_student, v_session, v_branch, v_class, v_section, '01') returning id into v_enrol;

  -- ============================================================ 1. RBAC
  select count(*) into v_count from role where tenant_id = v_tenant;
  assert v_count = 6, format('expected 6 system roles, got %s', v_count);

  select count(*) into v_count
    from role_permission rp join role r on r.id = rp.role_id
   where r.tenant_id = v_tenant and r.key = 'teacher';
  assert v_count = 8, format('teacher should have 8 permissions, got %s', v_count);

  -- a teacher must not be able to collect money
  select exists (
    select 1 from role_permission rp join role r on r.id = rp.role_id
     where r.tenant_id = v_tenant and r.key = 'teacher' and rp.permission_key = 'fee.collect'
  ) into v_ok;
  assert not v_ok, 'teacher role must not hold fee.collect';

  -- seeding twice must not duplicate
  perform seed_system_roles(v_tenant);
  select count(*) into v_count from role where tenant_id = v_tenant;
  assert v_count = 6, 'seed_system_roles is not idempotent';

  -- ====================================================== 2. one enrolment
  insert into student (tenant_id, admission_no, first_name) values (v_tenant, 'ADM-0002', 'Diya');
  begin
    insert into enrolment (tenant_id, student_id, session_id, branch_id, class_level_id, section_id)
      values (v_tenant, v_student, v_session, v_branch, v_class, v_section);
    assert false, 'a student must not have two enrolments in one session';
  exception when unique_violation then null;
  end;

  -- ================================================ 3. one current session
  begin
    insert into academic_session (tenant_id, name, start_date, end_date, is_current)
      values (v_tenant, '2027-28', '2027-04-01', '2028-03-31', true);
    assert false, 'two current sessions must not be possible';
  exception when unique_violation then null;
  end;

  -- ================================================== 4. attendance rules
  insert into attendance_record (tenant_id, session_id, enrolment_id, date, status, marked_by)
    values (v_tenant, v_session, v_enrol, '2026-07-01', 'present', v_admin);
  begin
    insert into attendance_record (tenant_id, session_id, enrolment_id, date, status, marked_by)
      values (v_tenant, v_session, v_enrol, '2026-07-01', 'absent', v_admin);
    assert false, 'duplicate daily attendance must be rejected';
  exception when unique_violation then null;
  end;

  begin
    insert into attendance_record (tenant_id, session_id, enrolment_id, date, status, marked_by)
      values (v_tenant, v_session, v_enrol, '2026-07-02', 'teleported', v_admin);
    assert false, 'invalid attendance status must be rejected';
  exception when check_violation then null;
  end;

  -- ============================================ 5. gapless receipt numbers
  insert into document_sequence (tenant_id, scope, scope_key, prefix, padding)
    values (v_tenant, 'receipt', v_session::text, 'RCT/2026-27/', 5);

  v_rcpt1 := next_document_number(v_tenant, 'receipt', v_session::text);
  v_rcpt2 := next_document_number(v_tenant, 'receipt', v_session::text);
  assert v_rcpt1 = 'RCT/2026-27/00001', format('unexpected first receipt %s', v_rcpt1);
  assert v_rcpt2 = 'RCT/2026-27/00002', format('unexpected second receipt %s', v_rcpt2);

  -- a rolled-back transaction must NOT burn a number
  begin
    perform next_document_number(v_tenant, 'receipt', v_session::text);
    raise exception 'deliberate rollback';
  exception when others then
    if sqlerrm <> 'deliberate rollback' then raise; end if;
  end;
  v_rcpt3 := next_document_number(v_tenant, 'receipt', v_session::text);
  assert v_rcpt3 = 'RCT/2026-27/00003',
    format('receipt numbering left a gap after rollback: got %s, expected 00003', v_rcpt3);

  -- ================================================= 6. invoice arithmetic
  insert into fee_head (tenant_id, name) values (v_tenant, 'Tuition Fee') returning id into v_head;
  insert into invoice (tenant_id, session_id, enrolment_id, invoice_no, due_date,
                       gross_amount, concession_amount, fine_amount, created_by)
    values (v_tenant, v_session, v_enrol, 'INV-00001', '2026-07-15',
            12500.00, 2500.00, 150.00, v_admin)
    returning id into v_invoice;

  select net_amount into v_balance from invoice where id = v_invoice;
  assert v_balance = 10150.00, format('net_amount should be 10150.00, got %s', v_balance);

  -- ============================================ 7. payment + derived balance
  insert into payment (tenant_id, session_id, enrolment_id, receipt_no, amount, method, collected_by)
    values (v_tenant, v_session, v_enrol, v_rcpt1, 6000.00, 'upi', v_admin)
    returning id into v_payment;
  insert into payment_allocation (tenant_id, payment_id, invoice_id, amount)
    values (v_tenant, v_payment, v_invoice, 6000.00);

  select balance_amount into v_balance from invoice_balance where invoice_id = v_invoice;
  assert v_balance = 4150.00, format('balance should be 4150.00, got %s', v_balance);

  -- zero and negative payments are nonsense
  begin
    insert into payment (tenant_id, session_id, enrolment_id, receipt_no, amount, method, collected_by)
      values (v_tenant, v_session, v_enrol, 'RCT/BAD/1', 0, 'cash', v_admin);
    assert false, 'a zero-amount payment must be rejected';
  exception when check_violation then null;
  end;

  -- ================================================ 8. payment immutability
  begin
    update payment set amount = 99999 where id = v_payment;
    assert false, 'payment amount must be immutable';
  exception when restrict_violation then null;
  end;

  begin
    delete from payment where id = v_payment;
    assert false, 'payments must not be deletable';
  exception when restrict_violation then null;
  end;

  -- the one legal transition
  update payment set status = 'reversed' where id = v_payment;
  insert into payment_reversal (tenant_id, payment_id, reversal_receipt_no, reason, reversed_by)
    values (v_tenant, v_payment, 'REV-00001', 'Duplicate entry at counter', v_admin);

  -- a reversed payment stops counting toward the invoice
  select balance_amount into v_balance from invoice_balance where invoice_id = v_invoice;
  assert v_balance = 10150.00, format('reversal should restore balance to 10150.00, got %s', v_balance);

  -- ==================================================== 9. mark validation
  insert into exam (tenant_id, session_id, class_level_id, name, created_by)
    values (v_tenant, v_session, v_class, 'Term I', v_admin) returning id into v_exam;
  insert into exam_subject (tenant_id, exam_id, subject_id, theory_max, practical_max, pass_marks)
    values (v_tenant, v_exam, v_subject, 80, 20, 33) returning id into v_exam_subject;

  select total_max into v_balance from exam_subject where id = v_exam_subject;
  assert v_balance = 100, format('total_max should be 100, got %s', v_balance);

  begin
    insert into mark (tenant_id, exam_subject_id, enrolment_id, theory_marks, entered_by)
      values (v_tenant, v_exam_subject, v_enrol, 95, v_admin);
    assert false, 'theory marks above the maximum must be rejected';
  exception when check_violation then null;
  end;

  begin
    insert into mark (tenant_id, exam_subject_id, enrolment_id, is_absent, theory_marks, entered_by)
      values (v_tenant, v_exam_subject, v_enrol, true, 50, v_admin);
    assert false, 'an absent student must not carry component marks';
  exception when check_violation then null;
  end;

  insert into mark (tenant_id, exam_subject_id, enrolment_id, theory_marks, practical_marks, entered_by)
    values (v_tenant, v_exam_subject, v_enrol, 68, 18, v_admin);
  select total_marks into v_balance from mark where exam_subject_id = v_exam_subject and enrolment_id = v_enrol;
  assert v_balance = 86, format('total_marks should be 86, got %s', v_balance);

  -- a locked exam rejects mark changes
  update exam set status = 'locked' where id = v_exam;
  begin
    update mark set theory_marks = 70 where exam_subject_id = v_exam_subject and enrolment_id = v_enrol;
    assert false, 'a locked exam must reject mark changes';
  exception when restrict_violation then null;
  end;

  -- =================================================== 10. notice audience
  begin
    insert into notice (tenant_id, session_id, title, body, created_by)
      values (v_tenant, v_session, 'T', 'B', v_admin);
    insert into notice_audience (tenant_id, notice_id, audience_type)
      select v_tenant, id, 'section' from notice where tenant_id = v_tenant limit 1;
    assert false, 'a section-targeted notice must name a section';
  exception when check_violation then null;
  end;

  -- ================================================= 11. audit log capture
  select count(*) into v_count
    from audit_log where tenant_id = v_tenant and entity_type = 'payment';
  assert v_count >= 2, format('payment insert and reversal should both be audited, got %s rows', v_count);

  select count(*) into v_count
    from audit_log where tenant_id = v_tenant and entity_type = 'student' and action = 'insert';
  assert v_count = 2, format('two student inserts should be audited, got %s', v_count);

  select exists (
    select 1 from audit_log
     where entity_type = 'payment' and action = 'update'
       and before_data ->> 'status' = 'completed'
       and after_data  ->> 'status' = 'reversed'
  ) into v_ok;
  assert v_ok, 'the reversal should be captured with before/after state';

  begin
    delete from audit_log where tenant_id = v_tenant;
    assert false, 'audit_log must be append-only';
  exception when restrict_violation then null;
  end;

  -- ============================================== 12. guardian constraints
  declare v_g1 uuid; v_g2 uuid;
  begin
    insert into guardian (tenant_id, first_name, phone) values (v_tenant, 'Priya', '9990001111') returning id into v_g1;
    insert into guardian (tenant_id, first_name, phone) values (v_tenant, 'Rohit', '9990002222') returning id into v_g2;
    insert into student_guardian (tenant_id, student_id, guardian_id, relation, is_primary_contact)
      values (v_tenant, v_student, v_g1, 'mother', true);
    begin
      insert into student_guardian (tenant_id, student_id, guardian_id, relation, is_primary_contact)
        values (v_tenant, v_student, v_g2, 'father', true);
      assert false, 'a student must have only one primary contact';
    exception when unique_violation then null;
    end;
  end;

  raise notice 'ALL SCHEMA ASSERTIONS PASSED';
end $$;

-- ==================================================== 13. tenant isolation
-- Exercised as the real application role, which cannot bypass RLS.
set role erp_app;

do $$
declare
  v_a uuid; v_b uuid; v_count int;
begin
  select id into v_a from tenant where slug = 'smoke-school';

  perform set_config('app.tenant_id', v_a::text, false);
  select count(*) into v_count from student;
  assert v_count = 2, format('tenant A should see its 2 students, saw %s', v_count);

  -- switch context to the other school: the same unfiltered query must be blind
  select id into v_b from tenant where slug = 'other-school';
  perform set_config('app.tenant_id', v_b::text, false);
  select count(*) into v_count from student;
  assert v_count = 0, format('tenant B must not see tenant A students, saw %s', v_count);

  select count(*) into v_count from payment;
  assert v_count = 0, format('tenant B must not see tenant A payments, saw %s', v_count);

  -- and must not be able to write into another tenant
  begin
    insert into student (tenant_id, admission_no, first_name)
      values (v_a, 'ADM-9999', 'Injected');
    assert false, 'cross-tenant insert must be blocked by RLS';
  exception when insufficient_privilege then null;
  end;

  raise notice 'ALL TENANT ISOLATION ASSERTIONS PASSED';
end $$;

reset role;
