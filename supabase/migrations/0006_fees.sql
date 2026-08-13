-- 0006 · Fees
--
-- The highest-risk module in the system. Design rules, all enforced here
-- rather than trusted to application code:
--
--   1. Payments are IMMUTABLE. No UPDATE, no DELETE. A mistake is corrected
--      by a reversal row that points at the original. Auditors and parents
--      both need the original receipt to remain exactly as issued.
--   2. Receipt numbers are gapless (see next_document_number in 0001).
--   3. Money is `numeric(12,2)`, never float. Never float.
--   4. An invoice's paid amount is derived from allocations, not stored and
--      hoped to stay in sync.

-- ---------------------------------------------------------------- config

create table fee_head (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  name          text not null,           -- 'Tuition Fee', 'Transport Fee'
  code          text,
  is_recurring  boolean not null default true,
  is_refundable boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (tenant_id, name)
);
create trigger fee_head_set_updated_at before update on fee_head
  for each row execute function set_updated_at();

create table fee_structure (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  session_id      uuid not null references academic_session(id) on delete restrict,
  class_level_id  uuid references class_level(id) on delete restrict,  -- NULL = applies to all
  name            text not null,
  status          text not null default 'draft'
                    check (status in ('draft', 'published', 'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, session_id, name)
);
create trigger fee_structure_set_updated_at before update on fee_structure
  for each row execute function set_updated_at();

-- Instalments give the structure its due-date schedule ('Term I', 'Term II').
create table fee_instalment (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  fee_structure_id  uuid not null references fee_structure(id) on delete cascade,
  name              text not null,
  due_date          date not null,
  sequence          int not null,
  unique (fee_structure_id, sequence)
);

create table fee_structure_item (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  fee_structure_id  uuid not null references fee_structure(id) on delete cascade,
  fee_instalment_id uuid references fee_instalment(id) on delete cascade,
  fee_head_id       uuid not null references fee_head(id) on delete restrict,
  amount            numeric(12,2) not null check (amount >= 0),
  unique (fee_structure_id, fee_instalment_id, fee_head_id)
);

-- Late-fee rules. Evaluated by the API at invoice generation and on demand.
create table fine_rule (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  fee_head_id  uuid references fee_head(id) on delete cascade,  -- NULL = all heads
  name         text not null,
  grace_days   int not null default 0 check (grace_days >= 0),
  charge_type  text not null check (charge_type in ('per_day', 'fixed', 'percent')),
  charge_value numeric(12,2) not null check (charge_value >= 0),
  max_amount   numeric(12,2) check (max_amount is null or max_amount >= 0),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table concession (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  name         text not null,            -- 'Sibling', 'Staff ward', 'Merit'
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  value        numeric(12,2) not null check (value >= 0),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (tenant_id, name)
);

-- ------------------------------------------------------------ assignment

create table fee_assignment (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  enrolment_id      uuid not null references enrolment(id) on delete cascade,
  fee_structure_id  uuid not null references fee_structure(id) on delete restrict,
  assigned_by       uuid not null references app_user(id) on delete restrict,
  assigned_at       timestamptz not null default now(),
  unique (enrolment_id, fee_structure_id)
);

create table student_concession (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  enrolment_id  uuid not null references enrolment(id) on delete cascade,
  concession_id uuid not null references concession(id) on delete restrict,
  fee_head_id   uuid references fee_head(id) on delete cascade,  -- NULL = all heads
  reason        text,
  approved_by   uuid not null references app_user(id) on delete restrict,
  approved_at   timestamptz not null default now(),
  unique (enrolment_id, concession_id, fee_head_id)
);

-- ---------------------------------------------------------------- invoice

create table invoice (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  session_id        uuid not null references academic_session(id) on delete restrict,
  enrolment_id      uuid not null references enrolment(id) on delete restrict,
  fee_instalment_id uuid references fee_instalment(id) on delete set null,
  invoice_no        text not null,
  issue_date        date not null default current_date,
  due_date          date not null,
  gross_amount      numeric(12,2) not null default 0 check (gross_amount >= 0),
  concession_amount numeric(12,2) not null default 0 check (concession_amount >= 0),
  fine_amount       numeric(12,2) not null default 0 check (fine_amount >= 0),
  net_amount        numeric(12,2) not null generated always as
                      (gross_amount - concession_amount + fine_amount) stored,
  status            text not null default 'issued'
                      check (status in ('draft', 'issued', 'partly_paid', 'paid', 'cancelled')),
  cancelled_reason  text,
  cancelled_by      uuid references app_user(id) on delete set null,
  cancelled_at      timestamptz,
  created_by        uuid not null references app_user(id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, invoice_no)
);
create trigger invoice_set_updated_at before update on invoice
  for each row execute function set_updated_at();

create index invoice_enrolment_idx on invoice (enrolment_id, due_date);
create index invoice_outstanding_idx on invoice (tenant_id, session_id, status)
  where status in ('issued', 'partly_paid');

create table invoice_line (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  invoice_id        uuid not null references invoice(id) on delete cascade,
  fee_head_id       uuid not null references fee_head(id) on delete restrict,
  description       text not null,
  gross_amount      numeric(12,2) not null check (gross_amount >= 0),
  concession_amount numeric(12,2) not null default 0 check (concession_amount >= 0),
  fine_amount       numeric(12,2) not null default 0 check (fine_amount >= 0),
  net_amount        numeric(12,2) not null generated always as
                      (gross_amount - concession_amount + fine_amount) stored
);

create index invoice_line_invoice_idx on invoice_line (invoice_id);

-- ---------------------------------------------------------------- payment

create table payment (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  session_id    uuid not null references academic_session(id) on delete restrict,
  enrolment_id  uuid not null references enrolment(id) on delete restrict,
  receipt_no    text not null,
  paid_on       date not null default current_date,
  amount        numeric(12,2) not null check (amount > 0),
  method        text not null
                  check (method in ('cash', 'upi', 'card', 'cheque', 'bank_transfer', 'online')),
  reference_no  text,                    -- UTR, cheque no, gateway txn id
  bank_name     text,
  notes         text,
  status        text not null default 'completed'
                  check (status in ('completed', 'reversed')),
  collected_by  uuid not null references app_user(id) on delete restrict,
  created_at    timestamptz not null default now(),
  unique (tenant_id, receipt_no)
);

create index payment_enrolment_idx on payment (enrolment_id, paid_on desc);
create index payment_daybook_idx on payment (tenant_id, paid_on, method);

comment on table payment is
  'IMMUTABLE. Blocked from UPDATE/DELETE by trigger; correct mistakes with a payment_reversal row.';

create table payment_allocation (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  payment_id   uuid not null references payment(id) on delete restrict,
  invoice_id   uuid not null references invoice(id) on delete restrict,
  amount       numeric(12,2) not null check (amount > 0),
  created_at   timestamptz not null default now()
);

create index payment_allocation_payment_idx on payment_allocation (payment_id);
create index payment_allocation_invoice_idx on payment_allocation (invoice_id);

create table payment_reversal (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenant(id) on delete cascade,
  payment_id          uuid not null references payment(id) on delete restrict unique,
  reversal_receipt_no text not null,
  reason              text not null,
  reversed_by         uuid not null references app_user(id) on delete restrict,
  reversed_at         timestamptz not null default now(),
  unique (tenant_id, reversal_receipt_no)
);

-- Enforce immutability at the database level. Application bugs, a rogue
-- migration and a careless psql session all hit this.
create or replace function block_payment_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payment % cannot be deleted. Record a payment_reversal instead.', old.receipt_no
      using errcode = 'restrict_violation';
  end if;

  -- The ONLY permitted update is the status flip completed -> reversed, which
  -- the reversal flow performs alongside inserting payment_reversal. Every
  -- other column must be byte-identical.
  if row(new.id, new.tenant_id, new.session_id, new.enrolment_id, new.receipt_no,
         new.paid_on, new.amount, new.method, new.reference_no, new.bank_name,
         new.notes, new.collected_by, new.created_at)
     is distinct from
     row(old.id, old.tenant_id, old.session_id, old.enrolment_id, old.receipt_no,
         old.paid_on, old.amount, old.method, old.reference_no, old.bank_name,
         old.notes, old.collected_by, old.created_at)
  then
    raise exception 'Payment % is immutable. Record a payment_reversal instead.', old.receipt_no
      using errcode = 'restrict_violation';
  end if;

  if not (old.status = 'completed' and new.status = 'reversed') then
    raise exception 'Payment % status may only change from completed to reversed (got % -> %).',
      old.receipt_no, old.status, new.status
      using errcode = 'restrict_violation';
  end if;

  return new;
end $$;

create trigger payment_immutable
  before update or delete on payment
  for each row execute function block_payment_mutation();

-- Derived balance. A view, not a stored column, so it can never drift.
create view invoice_balance as
select
  i.id                as invoice_id,
  i.tenant_id,
  i.enrolment_id,
  i.invoice_no,
  i.due_date,
  i.net_amount,
  coalesce(sum(pa.amount) filter (where p.status = 'completed'), 0) as paid_amount,
  i.net_amount - coalesce(sum(pa.amount) filter (where p.status = 'completed'), 0) as balance_amount
from invoice i
left join payment_allocation pa on pa.invoice_id = i.id
left join payment p on p.id = pa.payment_id
where i.status <> 'cancelled'
group by i.id;

comment on view invoice_balance is
  'Authoritative outstanding balance. Never store this on invoice; derive it.';
