# EduNova School ERP — Production Readiness Plan

_Assessment date: 13 Aug 2026 · Branch `main` @ `3267da3`_

---

## 1. What exists today (honest assessment)

The build is green (`npm run build` succeeds, 228 KB JS / 92 KB CSS) and the UI is
genuinely good-looking. But the codebase is **2,634 lines of Vue 3 frontend and
nothing else**. There is no server, no database, no API — not one `fetch()` call
in `src/`.

| Area | Reality |
|---|---|
| Backend | **None.** Zero network calls. |
| Database | **None.** 28 `localStorage` read/writes under `edunova:*` keys. |
| Authentication | Hardcoded demo credentials in [LoginPage.vue:11](../src/components/LoginPage.vue#L11) — `Demo@123` for all five roles, compared client-side. Session = `localStorage.setItem('edunova-session', role)`. Any user can type that key in DevTools and become superadmin. |
| Authorization | [permissions.ts](../src/permissions.ts) is a client-side lookup table. It hides buttons; it enforces nothing. |
| Data | Fabricated at runtime. `defaultRecord()` in [MightyAdminWorkflow.vue:120](../src/components/MightyAdminWorkflow.vue#L120) generates placeholder rows from field metadata. |
| The "151 routes" | 149 nav entries in [mightyNavigation.ts](../src/mightyNavigation.ts), nearly all rendered by **one** generic component that produces a searchable table + add/edit/delete modal from a field schema. Real depth exists only for ~12 flows (attendance, migration, fee collection, vouchers, routine, marks, certificates, library issue/return, question entry). |
| Multi-user | Not possible. Two staff on two laptops see two unrelated datasets. |
| Tests | None. `scripts/verify-mighty.mjs` is a hand-rolled CDP click-through script requiring a headless Edge debug session — not a test suite, and not runnable in CI as-is. |
| Deps | `vue-router` and `@vueuse/core` are installed but **never imported**. 3 npm advisories (1 moderate, 2 high) in the dev toolchain. |

### The bottom line

This is an excellent **sales demo and UI specification**. It is not software a
school can run on. Handing it over as-is would mean: student PII sitting
unencrypted in browser storage, every fee receipt lost when someone clears their
cache, no audit trail, and a login anyone can bypass in ten seconds. That is a
data-protection incident waiting to happen, not a soft launch.

**The work ahead is building the ERP behind this UI, not finishing the UI.**

---

## 2. Two viable paths

### Path A — Build the real product (recommended if this is a product bet)

Full backend, real database, real auth. Ship a **narrow MVP** to one school,
then widen. Realistic solo-developer effort: **4–6 months to a safe MVP**,
9–12 months to something covering what the current nav bar advertises.

### Path B — Reposition honestly (recommended if the school needs it now)

Give the school the demo explicitly labelled as a **pilot/preview** with a
signed understanding that no real student data goes in, and use their feedback
to drive Path A. Cost: near zero. This is the right move if their timeline is
weeks, not months.

Everything below assumes **Path A**.

---

## 3. Phase plan

### Phase 0 — Decisions and scope lock ✅ **DONE**

Decisions are locked and the data model is built and tested — see
[ARCHITECTURE.md](ARCHITECTURE.md). Summary: Supabase Postgres, custom
Lucia-style auth, Fastify API server as sole writer, `tenant_id` from day one,
MVP = attendance + fees + exams/marks + notices over student and staff records,
guardian portal deferred but modelled.

Delivered: 11 SQL migrations in [`supabase/migrations/`](../supabase/migrations/)
and a 13-group assertion suite in
[`supabase/tests/schema_smoke.sql`](../supabase/tests/schema_smoke.sql),
runnable with `./scripts/db-test.sh`.

Still owed by the school (not blocking, but needed before go-live):

1. **Confirm the MVP module list with them** — the four above are the
   recommendation, not their decision yet.
2. **Data-processing agreement** naming them Data Fiduciary and you Processor.
3. Their current-year data as a spreadsheet, for the import dry run.

<details>
<summary>Original Phase 0 checklist (retained for reference)</summary>

Before any code:

1. **Pick the MVP modules with the school.** Do not build 149 routes. A school
   can go live on six: Students, Staff, Attendance, Fees, Exams/Marks,
   Notices. Everything else is Phase 5+.
2. **Confirm the data-protection position** — India DPDP Act applies to
   children's data with parental-consent obligations. Decide on a data
   controller/processor agreement with the school before onboarding.
3. **Choose the stack.** Recommendation, optimised for one developer:
   - **Backend:** NestJS or Fastify + TypeScript (shares types with the Vue app)
   - **Database:** PostgreSQL + Prisma
   - **Auth:** self-hosted (Lucia/Auth.js) or Clerk/Supabase Auth if budget allows
   - **Files:** S3-compatible object storage (Cloudflare R2 is cheapest)
   - **Hosting:** single managed VPS or Railway/Render + managed Postgres
4. **Decide single-tenant vs multi-tenant now.** Retrofitting tenancy is
   brutal. If you plan to sell to more than one school, put `tenant_id` on every
   table from row one.

**Exit criteria:** a signed one-page scope, a stack decision, an ERD draft.

</details>

---

### Phase 1 — Foundation 🟡 **Core complete**

This is the phase that turns a demo into an application. The security spine —
1.1 through 1.5 — is built and tested; the remaining work is breadth (more
CRUD modules), not depth.

**Built so far:** [`api/`](../api/) — Fastify + TypeScript, 59 passing tests,
`npm test` in `api/`. See [api/README.md](../api/README.md).

**1.1 Data model.** ✅ **Done** — 11 migrations, 54 tables, 13 database-enforced
invariants, all green under `./scripts/db-test.sh`. See
[ARCHITECTURE.md §4](ARCHITECTURE.md#4-data-model). `enrolment` is the join that
makes sessions and promotions work, and it is now the anchor for attendance,
fees and marks alike.

**1.2 API layer.** ✅ **Done** — Fastify, Zod validation on every input,
authenticated-by-default routing (public routes opt out explicitly), typed
error handling that never leaks SQL or constraint names, per-IP login
throttling, helmet and CORS. The request-context transaction helper in
[api/src/db/context.ts](../api/src/db/context.ts) is the load-bearing piece:
`SET LOCAL ROLE erp_app` + transaction-local tenant and user settings.

**1.3 Real authentication.** ✅ **Done** — custom Lucia-style sessions.
- Argon2id at OWASP parameters; the database never sees plaintext.
- Session tokens stored SHA-256 hashed — a leaked backup yields no sessions.
- httpOnly + Secure + SameSite=Lax cookies, sliding expiry.
- Uniform failure responses; no user-enumeration oracle on login or reset.
- Account lockout after 5 failures, plus per-IP rate limiting.
- Single-use expiring reset tokens; forced password change on first login,
  enforced globally rather than by asking each route to remember.
- TOTP MFA with recovery codes, verified against the RFC 6238 test vectors.
- ⚠️ Email delivery is not wired yet — reset tokens are created but not sent.

**1.4 Server-side RBAC.** ✅ **Done** — permissions live in the database
([0002](../supabase/migrations/0002_identity_and_rbac.sql)) and are enforced in
the API. Row-level scope is separate and additive: teachers see only their own
sections, students only themselves, guardians only their children — with
`assertStudentInScope` on every single-record access, so a legitimate
permission cannot be aimed at someone else's child by editing the URL. The
client copy in [permissions.ts](../src/permissions.ts) is now for hiding UI
only.

**1.5 Audit logging.** ✅ **Done** — row changes via the triggers from
[0009](../supabase/migrations/0009_audit_and_compliance.sql), attributed to the
acting user through `app.user_id`. Events with no row to trigger on (logins,
failed logins, sign-outs, sensitive reads) are written explicitly.

**Exit criteria:** ✅ **Met** — verified end-to-end against a running server and
covered by `tests/students.test.ts`: an authorised admin creates a student, it
persists in Postgres, and the audit log records the insert attributed to them.

**Remaining before Phase 2:**
1. Wire an email provider so password reset works for real users.
2. School setup CRUD — sessions, branches, classes, sections, subjects.
3. Staff CRUD, and linking staff to user accounts.
4. CSV student import with a dry-run preview (schools onboard from a
   spreadsheet, always).
5. CI: typecheck → test → build on every push.

---

### Phase 2 — Wire the UI to the backend (3–4 weeks)

**2.1 Introduce `vue-router`.** It is already a dependency and unused. Replace
the `active`/`screen` ref-based switching in [Root.vue](../src/Root.vue) and
[App.vue](../src/App.vue) with real routes. Today the app has no URLs — staff
cannot bookmark a page, share a link, or use the back button, and a refresh
dumps them to the dashboard. That alone will generate daily complaints.

**2.2 Add a data layer.** TanStack Query (Vue Query) for caching, loading and
error states. Every screen currently assumes data is instantly available and
never fails; that assumption breaks the moment a network exists.

**2.3 Replace the generic workflow component.** `MightyAdminWorkflow.vue` is 428
lines handling seventeen different `kind`s through branching. Split it: keep a
reusable `<DataTable>` + `<RecordForm>` pair driven by schema, and give the real
transaction flows (fee collection, mark entry, attendance) their own components
with their own validation.

**2.4 Delete the fabrication layer.** `defaultRecord()`, the `examples` map, and
all `localStorage` persistence come out. Keep a seed script server-side instead.

**Exit criteria:** the six MVP modules read and write through the API; the app
still works with `localStorage` disabled.

---

### Phase 3 — Make the MVP modules actually correct (5–7 weeks)

Depth over breadth. Each of these needs real business rules the demo only mimes:

- **Students & enrolment** — admission numbers, documents, guardians, transfer,
  promotion between sessions, alumni. Bulk CSV import with validation and a
  dry-run preview (schools onboard with a spreadsheet, always).
- **Attendance** — per-period vs per-day, holidays, half-days, leave approval,
  correction window with audit, monthly and statutory reports.
- **Fees** — the highest-risk module. Fee heads, class/category-wise structures,
  concessions, instalment schedules, late fines by rule, **immutable numbered
  receipts**, partial payments, refunds, reconciliation, daily collection
  report. Money bugs destroy trust faster than anything else.
- **Exams & marks** — grading schemes, weighted components, moderation, result
  locking after publication, report-card PDF generation.
- **Staff** — records, attendance, leave. Defer payroll: it is statutory
  (PF/ESI/TDS) and a project of its own.
- **Notices** — targeted by class/section/role, read receipts.

**Exit criteria:** a term's worth of real historical data from the school
imported and reconciling against their existing records.

---

### Phase 4 — Testing and hardening (3–4 weeks, overlapping)

The project has **zero automated tests**. Build the safety net alongside Phase 3,
not after.

| Layer | Tool | Target |
|---|---|---|
| Unit | Vitest | Fee calculation, grade computation, attendance aggregation, date/session logic — every pure function that touches money or marks. 90%+ here. |
| Component | Vitest + Vue Test Utils | Forms, validation, permission-gated rendering. |
| API integration | Vitest + Supertest + test Postgres | Every endpoint × every role, **including the negative cases** — teacher cannot read another section, guardian cannot read another child. |
| E2E | Playwright | Six journeys: admit a student, mark attendance, collect a fee, enter marks, publish a result, guardian views it. Replaces `verify-mighty.mjs`, which should be deleted. |
| Load | k6 | Peak = fee-deadline day and result-publication day. Simulate 300 concurrent parents. |
| Security | `npm audit` in CI, OWASP ZAP baseline, plus a manual IDOR pass | Clear the 3 open advisories. |
| Accessibility | axe-core in Playwright | WCAG 2.1 AA. Public-sector-adjacent, and the current markup has form inputs without associated labels in places. |

Also in this phase:
- CI on every push: typecheck → lint → unit → integration → build → E2E.
- **UAT with real school staff.** Two weeks, their data, their workflows, in
  parallel with whatever they use today. Non-negotiable before go-live.

**Exit criteria:** green CI, UAT sign-off, no high/critical security findings.

---

### Phase 5 — Deployment and operations (2–3 weeks)

- Environments: dev → staging → production, separate databases.
- **Automated encrypted backups, daily, off-site — and a tested restore.** An
  untested backup is not a backup. This is the single most important item on
  this page.
- TLS, security headers, CSP.
- Error tracking (Sentry) and uptime monitoring with alerts to a phone.
- Log retention and a documented incident procedure.
- A DPDP-compliant privacy notice, consent capture, data-retention policy, and a
  documented process for parent data-access requests.

---

### Phase 6 — Handover (1–2 weeks)

- Admin manual, teacher quick-start, parent one-pager — screenshots, their
  language, printable.
- Two training sessions: admin/office staff, then teachers.
- Support agreement: response times, who to call, what "urgent" means.
- Named school-side owner for user accounts and role assignment.
- Agreed maintenance window and update cadence.

---

## 4. Immediate fixes worth doing this week

Small, cheap, and they improve the demo regardless of which path you take:

1. `npm audit fix` — clear the 3 advisories.
2. Remove `@vueuse/core` (unused) — keep `vue-router`, Phase 2 needs it.
3. Add `.env`-driven config so the demo can be pointed at an API later.
4. **Put a visible "DEMO — do not enter real student data" banner in the app.**
   If this build reaches the school in any form, that banner is what stops
   someone typing a real child's medical details into browser storage.
5. Rewrite [README.md](../README.md). It currently reads as a feature list of a
   finished product ("Permission-scoped staff/teacher access", "Search,
   filtering, create/view/edit/delete, CSV exports"). Anyone — including the
   school — would reasonably read that as production capability. State plainly
   that it is a UI prototype with browser-local storage.
6. Delete `scripts/verify-mighty.mjs` once Playwright lands.

---

## 5. Effort summary

| Phase | Scope | Solo dev |
|---|---|---|
| 0 | Decisions, scope lock | 1 week |
| 1 | Backend, DB, auth, RBAC, audit | 4–6 weeks |
| 2 | Wire UI to API, router, data layer | 3–4 weeks |
| 3 | Six MVP modules, correct | 5–7 weeks |
| 4 | Tests, security, UAT | 3–4 weeks |
| 5 | Deploy, backups, monitoring | 2–3 weeks |
| 6 | Docs, training, handover | 1–2 weeks |
| | **Total to safe MVP** | **~19–27 weeks (4.5–6 months)** |

Remaining modules (payroll, accounting, library, hostel, transport, question
bank, SMS, CMS, Zoom) — the other ~140 routes — are roughly another 6 months and
should be sequenced by what the school actually asks for after go-live. Most
schools use a fraction of what an ERP nav bar advertises.

Two developers running backend and frontend in parallel compresses this to
roughly 3 months for MVP, not less — Phase 3 correctness and Phase 4 UAT do not
parallelise well.

---

## 6. What I'd do first

1. Talk to the school about **timeline and which six modules matter**. That
   conversation changes everything below it.
2. Apply the §4 quick fixes and the demo banner today.
3. Start Phase 0: the ERD and the tenancy decision.

Ask me to start on any of these and I'll take it from the top.
