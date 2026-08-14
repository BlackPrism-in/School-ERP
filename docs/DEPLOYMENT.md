# EduNova — Deployment Plan

_From the current working tree to a school using it on real data._

Everything below assumes the code as it stands: 236 automated tests green,
both packages linting clean, all six MVP modules working. What remains is
**finishing Phase 4 and doing Phases 5–6** — mostly operations, not features.

**Realistic timeline: 3–5 weeks**, of which about a week is waiting on the
school (their data, their sign-off, their training slot).

---

## Decided

| | Choice | Config |
|---|---|---|
| **Frontend** | Vercel | `schooldemo.blackprism.in` · [vercel.json](../vercel.json) |
| **API** | Render (Singapore, starter) | `api.schooldemo.blackprism.in` · [render.yaml](../render.yaml) |
| **Database** | Supabase | direct connection, port 5432 |
| **CI** | GitHub Actions | [.github/workflows/ci.yml](../.github/workflows/ci.yml) |

The API needs its own hostname, so it sits at
`api.schooldemo.blackprism.in`. That lets the session cookie be scoped to
`.schooldemo.blackprism.in` — it reaches the API, and it cannot leak to
anything else you host on `blackprism.in`.

### Is this a demo or the school's live system?

The subdomain says "demo", which changes what is mandatory:

- **Demo with invented data** — Stages 2 and 3 only. Live in about two days.
  Defer the DPDP paperwork, the tested restore and the parallel run.
- **Real children's data** — every gate below applies. A subdomain named
  "demo" holding real student records is still a DPDP obligation, and the
  school is still the Data Fiduciary.

The rest of this document assumes the second. Where you can safely skip for a
pure demo, it says so.

---

## Stage 0 — Commit the work (today, 30 min)

Four phases sit uncommitted. Before touching infrastructure there needs to be a
rollback point.

```bash
git checkout -b build/mvp
git add -A && git commit -m "Build MVP: schema, API, frontend, six modules"
```

Then protect `main` and require the CI check from Stage 1.

---

## Stage 1 — Finish Phase 4 (3–5 days)

These are the outstanding items from the plan. None needs the school.

### 1.1 Get accessibility to green — **half a day**

**Status: written but never passing.** `e2e/accessibility.spec.ts` scans 13
screens with axe against WCAG 2.1 AA. It failed on its first run; I fixed some
causes (unlabelled attendance buttons, modals missing `role="dialog"`) but
never re-ran it. Treat AA as **unknown**.

```bash
npx playwright test e2e/accessibility.spec.ts
```

Expect real findings: colour contrast on the muted greys, the status-pill
colours, and form fields whose only label is placeholder text. This matters
more than usual — school offices run old monitors at odd zoom, and some staff
and families use screen readers.

### 1.2 Finish the E2E suite — **1 hour**

13 of 14 journeys pass. The last one was mid-verification when work stopped.

```bash
npx playwright test
```

### 1.3 CI pipeline — **half a day**

Nothing runs on push today. GitHub Actions with a Postgres service container:

```
typecheck → lint → schema tests → API tests → frontend tests → build → E2E
```

Plus `npm audit --audit-level=high` in both packages. This is what stops a
regression reaching the school after go-live, so it goes in **before** deploy,
not after.

### 1.4 Load test — **half a day**

Two days a year decide whether this system embarrasses the school: **fee
deadline day** and **results publication day**. A k6 script for both:

- 300 concurrent parents hitting `/fees/student/:id`
- 40 staff saving registers simultaneously at 08:30
- Results publication for a 200-student class

Target: p95 under 500ms, no errors, no connection-pool exhaustion. If the pool
saturates, `DB_POOL_MAX` and the host's instance size are the knobs.

### 1.5 Content Security Policy — **1 hour**

The frontend CSP is set in [`vercel.json`](../vercel.json). The **API** still
registers helmet with `contentSecurityPolicy: false` in `api/src/app.ts`. It
serves only JSON so the risk is low, but turn it on before go-live rather than
leaving a known gap.

---

## Stage 2 — Supabase (1 day)

### 2.1 Create the project

Pick the region closest to the school (`ap-south-1` for India). Save the
database password immediately — Supabase shows it once.

### 2.2 Run the migrations

```bash
psql "$SUPABASE_DB_URL" -c "select version()"
for f in supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 "$SUPABASE_DB_URL" -f "$f" || break
done
```

> **The one real technical unknown.** These 14 migrations have only ever run on
> local PostgreSQL 14. Supabase is on 15/17. I expect no problems — nothing
> here uses version-specific behaviour — but it is an assumption until this
> command exits clean.

### 2.3 Verify `erp_app` actually works — **do not skip**

This is the single most important check in the whole deployment. Migration
0010 creates a role that cannot bypass RLS, and 0012 grants membership so
`SET LOCAL ROLE` works. **If that role silently fails on Supabase, tenant
isolation becomes decorative and nothing else will tell you.**

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/schema_smoke.sql
```

It must print `ALL TENANT ISOLATION ASSERTIONS PASSED`. That block runs as
`erp_app` and asserts `rolbypassrls = false`. If it fails, stop and fix the
role grant before deploying anything.

### 2.4 Connection settings — two known traps

**Use the direct connection (port 5432), not the transaction pooler (6543).**
Our API is a long-lived process with its own pool, so it does not need
Supavisor. More importantly, `postgres.js` uses named prepared statements,
which the transaction-mode pooler does not support. If you ever must use the
pooler, set `prepare: false` in `api/src/db/client.ts` — otherwise queries
fail intermittently under load, which is the worst way to find out.

**Supabase direct connections are IPv6-only on newer projects.** Several hosts
have no outbound IPv6. Check before you commit to a host; the fix is either
Supabase's IPv4 add-on or the pooler with `prepare: false`.

### 2.5 Bootstrap the school

```bash
cd api
npm run bootstrap -- \
  --name "St. Xavier's High School" \
  --email principal@school.edu \
  --admin-name "Their Real Name" \
  --slug their-school
```

Prints a generated password **once**. Hand it over directly, never by email.
They change it at first sign-in and enrol MFA immediately — that account can
read every child's record.

---

## Stage 3 — Deploy (1 day)

### 3.1 API on Render

[`render.yaml`](../render.yaml) is a blueprint — Dashboard → New → Blueprint,
point it at the repo. It sets everything except the secrets, which are entered
in the dashboard and marked `sync: false` so they never reach git.

Add the custom domain `api.schooldemo.blackprism.in` in Render, then a CNAME
in your DNS pointing at the Render hostname. TLS is automatic.

`autoDeploy` is **off** deliberately: a school should not get a new version
because someone pushed to main mid-morning. Deploy on an explicit click, out
of hours.

Environment:

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables the config guards below |
| `DATABASE_URL` | Supabase direct URI | Port 5432 |
| `TENANT_SLUG` | their slug | Must match the bootstrap |
| `APP_URL` | `https://schooldemo.blackprism.in` | Builds email links |
| `CORS_ORIGIN` | `https://schooldemo.blackprism.in` | |
| `COOKIE_SECURE` | `true` | **App refuses to boot otherwise in production** |
| `COOKIE_DOMAIN` | `.schooldemo.blackprism.in` | Scoped to this school only |
| `MAIL_DRIVER` | `smtp` | **App refuses to boot on `console` in production** |
| `SMTP_HOST/PORT/USER/PASSWORD` | provider values | |
| `MAIL_FROM` | `EduNova <no-reply@school.edu>` | |
| `DB_APP_ROLE` | `erp_app` | Leave as-is; this is what enforces RLS |
| `DB_POOL_MAX` | `10` | Raise only if the load test says so |

Everything else has a sensible default. Two guards will stop a bad deploy at
boot rather than in front of users: an insecure cookie, and a mail driver that
logs reset links instead of sending them.

### 3.2 Frontend on Vercel

Import the repo; Vercel detects Vite. [`vercel.json`](../vercel.json) already
carries the SPA fallback rewrite — without it every deep link 404s on refresh,
the exact complaint this build was designed to remove — plus the security
headers and a Content-Security-Policy that allows `connect-src` only to the
API host.

Set one environment variable:

```
VITE_API_URL = https://api.schooldemo.blackprism.in
```

Then add `schooldemo.blackprism.in` as a custom domain and point the DNS record
Vercel gives you.

> **Order matters.** Deploy the API and confirm `/health` first. The
> frontend's CSP names the API host explicitly, so if that hostname is not live
> the app loads and every request is blocked by the browser — which looks like
> a bug in the app rather than a missing DNS record.

### 3.3 Smoke test in production

Not automated, done by hand, in this order:

1. `/health` returns ok
2. Sign in as the bootstrap admin → forced password change fires
3. Enrol MFA, sign out, sign back in with a code
4. Trigger a password reset → **a real email arrives**
5. Create a class, a section, a student
6. Mark a register, save it
7. Collect a token fee → receipt number is `RCT/00001`
8. Check the audit log has all of the above attributed

---

## Stage 4 — Operations (2–3 days)

**Do not put real student data in before this stage is finished.**

### 4.1 Backups with a *tested restore* — the single most important item

Supabase takes daily backups on paid plans. An untested backup is not a backup.

1. Take a manual backup.
2. Restore it into a scratch project.
3. Run `supabase/tests/schema_smoke.sql` against the restore.
4. **Write down how long it took.** That number is your recovery time, and the
   school is entitled to know it.

Also schedule a weekly `pg_dump` to storage you control. A single vendor
holding both the system and its only backups is not a backup strategy.

### 4.2 Monitoring

- **Sentry** on API and frontend
- **Uptime check** on `/health` every minute, alerting to a phone
- **Log retention** — Supabase and the API host both default to short windows;
  the audit trail is in Postgres and safe, but request logs are what you need
  when someone reports "it did something odd this morning"

### 4.3 Alert on the things that matter

Not CPU. These:

- Login failure rate spiking (credential stuffing)
- Any 5xx on `/fees/*`
- Failed email delivery
- Database connections near `DB_POOL_MAX`

### 4.4 DPDP paperwork — blocking, and not a code task

The tables exist (`consent_record`, `data_subject_request`). The documents do
not:

1. **Data-processing agreement** naming the school Data Fiduciary and you
   Processor.
2. **Privacy notice** for parents, versioned — `consent_record.notice_version`
   records which version each family saw, so v1 needs to exist before consent
   is captured.
3. **Retention policy** — `tenant.data_retention_years` defaults to 7; confirm
   it matches their obligations.
4. **A named person at the school** who handles parent data requests.

---

## Stage 5 — Their data and UAT (1–2 weeks, mostly theirs)

### 5.1 Import

1. School exports current students to CSV.
2. Run through `/app/students/import` with **dry run** — it reports every
   problem by spreadsheet row number and writes nothing.
3. Fix the spreadsheet, repeat until clean, then commit.
4. **Reconcile**: their student count, per class, must equal ours. Their
   outstanding fee total must equal ours. If either differs, stop.

Then classes, sections, staff, fee structures, and the current term's fees.

### 5.2 Parallel run — two weeks, non-negotiable

They keep doing whatever they do today *and* use EduNova, in parallel:

- Attendance marked in both, compared weekly
- Fees collected in both, reconciled daily
- One real exam entered and published

This is where you find the things no test catches: the class they call "10-A1",
the sibling discount rule nobody mentioned, the receipt format their auditor
expects.

### 5.3 Sign-off

The school confirms in writing that a term of their data reconciles. That was
always the Phase 3 exit criterion and it is the last gate before go-live.

---

## Stage 6 — Go live and hand over (3–4 days)

1. **Freeze** the old system for a weekend; final import of anything since.
2. **Train**: office staff and admin (2h), then teachers (1h). Their data,
   their language, printable one-pagers.
3. **Support agreement**: response times, what "urgent" means, who to call.
4. **Named school-side owner** for user accounts and role assignment.
5. **Watch closely for two weeks** — daily check of the audit log, error
   tracker and fee reconciliation.

---

## Sequence and gates

```
Stage 0  Commit                      ── today
Stage 1  Finish Phase 4              ── 3–5 days   ← a11y, CI, load, CSP
Stage 2  Supabase                    ── 1 day      ← GATE: erp_app must pass
Stage 3  Deploy + smoke test         ── 1 day
Stage 4  Backups, monitoring, DPDP   ── 2–3 days   ← GATE: tested restore
Stage 5  Their data + parallel run   ── 1–2 weeks  ← GATE: reconciliation
Stage 6  Go live + handover          ── 3–4 days
```

Three hard gates. Each exists because passing it later is far more expensive
than passing it now:

- **`erp_app` verified on Supabase.** Without it, tenant isolation is theatre.
- **A restore you have actually performed.** Otherwise you find out during an
  incident.
- **The school's written reconciliation.** Otherwise you are running their fees
  on numbers nobody checked.

---

## What is still not built

Worth saying plainly before anyone promises it to the school:

- **Parent/guardian portal** — modelled in the schema, no UI
- **Fee instalments and automatic late fines** — tables exist, rules unwired;
  a single "full payment" instalment is created today
- **Staff attendance and leave**, document uploads, report-card PDFs
- **Payroll** — deliberately deferred; statutory (PF/ESI/TDS) and a project of
  its own
- **Timetable, library, transport, hostel** — the nav shows these as planned,
  which is what the school will see

None blocks go-live on the six MVP modules. All of them should be in the
support agreement as "not included" so expectations are set in writing.
