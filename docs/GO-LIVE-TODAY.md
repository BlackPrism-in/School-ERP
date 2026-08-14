# Go live today — step by step

A demo at **schooldemo.blackprism.in** with invented data. Roughly 60–90
minutes, most of it waiting for DNS.

You need: a Supabase account, a Render account, a Vercel account, and DNS
control for `blackprism.in`. Everything runs from your laptop plus three
dashboards.

> **This is for demo data only.** The moment real student records go in, the
> gates in [DEPLOYMENT.md](DEPLOYMENT.md) apply — DPDP paperwork, a tested
> restore, and a parallel run. A subdomain called "demo" does not change that.

---

## Before you start

Check your tools:

```bash
node --version    # must be 22 or higher
psql --version    # any recent version
git status        # should be on main, clean
```

Push, so Render and Vercel can see it:

```bash
git push origin main
```

> Deploy from **`main`**. Render and Vercel both default to it, and Vercel's
> production branch is awkward to change after a project is created.

---

## Step 1 · Supabase (15 min)

### 1.1 Create the project

1. supabase.com → **New project**
2. Name `edunova-schooldemo`
3. Region **South Asia (Mumbai)** — closest to the school
4. Generate a database password and **save it now**; it is shown once

Wait for provisioning (~2 min).

### 1.2 Get the right connection string — this matters

Project → **Connect** → you will see three. They are not interchangeable:

| Shown as | Port | Use it? |
|---|---|---|
| Direct connection | 5432 | **Only from your laptop**, and only if your ISP has IPv6 |
| Session pooler | 5432 | ✅ **This is the one Render uses** |
| Transaction pooler | 6543 | ❌ Never — see below |

**Why the session pooler.** Render has no outbound IPv6, and Supabase direct
connections are IPv6-only unless you buy the IPv4 add-on. The session pooler is
IPv4 and behaves like a real connection.

**Why not the transaction pooler.** Our API uses `postgres.js` with prepared
statements enabled. Transaction mode does not support them, and the failures
are intermittent under load — the worst way to discover a problem.

Copy the **session pooler** string. It looks like:

```
postgresql://postgres.abcdefgh:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
```

Substitute your real password for `[PASSWORD]`, then keep it somewhere for the
next steps:

```bash
export SUPA="postgresql://postgres.abcdefgh:YOURPASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
psql "$SUPA" -c "select version()"
```

If that prints a PostgreSQL version, you are connected.

### 1.3 Run the migrations

```bash
cd ~/Desktop/Sandy/School-ERP

for f in supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 "$SUPA" -f "$f" || { echo "FAILED at $f"; break; }
done
```

All 14 must apply. If one fails, stop and read the error — do not continue.

### 1.4 The one check you must not skip

```bash
psql "$SUPA" -f supabase/tests/schema_smoke.sql
```

You need **both** of these lines:

```
NOTICE:  ALL SCHEMA ASSERTIONS PASSED
NOTICE:  ALL TENANT ISOLATION ASSERTIONS PASSED
```

The second one runs as the restricted `erp_app` role and proves it cannot
bypass row-level security. If it fails, tenant isolation is not working and
nothing else in the app will tell you. Stop and fix it before deploying.

---

## Step 2 · Create the school and its demo data (10 min)

Still on your laptop, pointed at Supabase.

```bash
cd api
cat > .env.supabase <<EOF
DATABASE_URL=$SUPA
TENANT_SLUG=schooldemo
DB_APP_ROLE=erp_app
COOKIE_SECURE=false
MAIL_DRIVER=console
LOG_LEVEL=warn
EOF
```

> Leave `NODE_ENV` unset here. Setting it to `production` makes the app demand
> real SMTP settings, which you do not have yet.

### 2.1 Create the school

```bash
npx tsx --env-file=.env.supabase scripts/bootstrap.ts \
  --name "Greenwood International School" \
  --email principal@greenwood.edu \
  --admin-name "Olivia Martin" \
  --slug schooldemo
```

**Copy the password it prints.** It is shown once and never stored anywhere
readable. Put it in your notes for the demo.

### 2.2 Fill it with a school

```bash
npx tsx --env-file=.env.supabase scripts/seed-demo.ts \
  --email principal@greenwood.edu \
  --slug schooldemo
```

You should see roughly:

```
3 classes, 6 sections, 6 subjects
5 staff · 4 with logins
91 students enrolled, most with a guardian and recorded consent
1547 attendance records across the last ~3 weeks
91 invoices raised, 66 with payments recorded
1 exam open for mark entry · 3 papers · 27 students marked
1 exam published with ranked results
4 published notices
```

Demo logins, all with password `DemoSchool2026!`:

| Role | Email |
|---|---|
| Administrator | `principal@greenwood.edu` (uses the bootstrap password) |
| Teacher | `maya@demo.school` |
| Teacher | `ethan@demo.school` |
| Accountant | `accounts@demo.school` |

```bash
rm .env.supabase   # it holds your database password
cd ..
```

---

## Step 3 · Deploy the API to Render (20 min)

**The API goes first.** The frontend's security policy names the API hostname,
so if the API is not live the app loads and every request is silently blocked —
which looks like a broken app rather than a missing service.

### 3.1 Create the service

1. Render → **New** → **Blueprint**
2. Connect the repo (branch **`main`**)
3. It reads [`render.yaml`](../render.yaml) and proposes `edunova-api`
4. **Apply**

### 3.2 Fill in the six secrets

Render will prompt for these (they are deliberately not in the repo):

| Key | Value |
|---|---|
| `DATABASE_URL` | your **session pooler** string, with the real password |
| `TENANT_SLUG` | `schooldemo` |
| `SMTP_HOST` | e.g. `smtp.resend.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your SMTP username |
| `SMTP_PASSWORD` | your SMTP password |

**No SMTP yet?** Resend or Brevo both give a free tier in about five minutes.
The app **refuses to start in production without SMTP** — deliberately, because
a school that cannot reset a password is stuck. If you truly must skip it for
today, set `NODE_ENV=development` and `MAIL_DRIVER=console` in Render and treat
password reset as not working. Say so if anyone asks.

### 3.3 Custom domain

1. Render → your service → **Settings** → **Custom Domain**
2. Add `api.schooldemo.blackprism.in`
3. Render shows a target hostname. In your DNS add:

```
Type: CNAME    Name: api.schooldemo    Value: <the render hostname>
```

TLS is issued automatically once DNS resolves (2–15 min).

### 3.4 Check it

```bash
curl https://api.schooldemo.blackprism.in/health
# {"status":"ok","at":"..."}
```

Do not go on until this returns ok.

---

## Step 4 · Deploy the frontend to Vercel (15 min)

### 4.1 Import

1. Vercel → **Add New** → **Project** → import the repo
3. Framework is detected as Vite; [`vercel.json`](../vercel.json) supplies the
   rest — including the SPA rewrite that stops a refresh on `/app/students`
   returning 404. Leave **Root Directory** as `./`: the frontend is at the repo
   root and `api/` is ignored.
4. Add one environment variable:

```
VITE_API_URL = https://api.schooldemo.blackprism.in
```

5. **Deploy**

### 4.2 Custom domain

1. Vercel → project → **Settings** → **Domains**
2. Add `schooldemo.blackprism.in`
3. In your DNS:

```
Type: CNAME    Name: schooldemo    Value: cname.vercel-dns.com
```

---

## Step 5 · Smoke test (10 min)

By hand, in this order. Each step depends on the one before.

- [ ] `https://schooldemo.blackprism.in` loads the landing page
- [ ] Sign in as `principal@greenwood.edu` with the bootstrap password
- [ ] It **forces a password change** — set something you will remember
- [ ] Dashboard shows real numbers (91 students, 5 staff, 6 sections)
- [ ] **Students** → the list loads, search for "Aarav"
- [ ] **Attendance** → pick Grade 10 A → three weeks of history is there
- [ ] **Fees** → search a student → take a ₹500 payment → balance drops by
      exactly ₹500 and a receipt number appears
- [ ] **Exams** → "Unit Test I" shows published results with ranks
- [ ] Sign out, sign in as `maya@demo.school` → **no Fees, no School setup** in
      her sidebar
- [ ] Refresh on a deep link like `/app/students` → stays there, no 404

If the fee payment works and the teacher cannot see Fees, the two hardest parts
are working.

---

## If something breaks

| What you see | Cause | Fix |
|---|---|---|
| Render logs: `ENETUNREACH` or connection timeout | Using the direct (IPv6) connection string | Switch `DATABASE_URL` to the **session pooler** |
| Random `prepared statement ... already exists` | Using the transaction pooler (6543) | Switch to session pooler (5432) |
| App loads, every request fails, console shows CSP errors | API not live yet, or `VITE_API_URL` wrong | Confirm `/health`, then redeploy the frontend |
| Blocked by CORS | `CORS_ORIGIN` does not match exactly | Must be `https://schooldemo.blackprism.in`, no trailing slash |
| Signed out immediately after signing in | Cookie domain mismatch | `COOKIE_DOMAIN` must be `.schooldemo.blackprism.in` |
| Render won't start: "COOKIE_SECURE must be true" | Working as intended | Set it to `true` |
| Render won't start: "MAIL_DRIVER must be smtp" | Working as intended | Add SMTP settings, or see 3.2 |
| Render build: `Cannot find name 'process'` / `Buffer` / `node:crypto` | `npm ci` omitted devDependencies because `NODE_ENV=production` | Fixed by `api/.npmrc` (`include=dev`), which applies whatever build command Render runs |
| Render log shows a build command you already changed | Render stores the build command when the blueprint is first applied and does **not** re-read `render.yaml` on later pushes | Settings → Build Command, edit by hand; or delete the service and re-apply the blueprint |
| Vercel is stuck on the wrong branch | Production branch is fixed at project creation | Deploy from `main`; or Settings → Git → Production Branch, then redeploy |
| Refreshing a page gives 404 | SPA rewrite missing | Confirm `vercel.json` is in the deployed commit |
| Vercel: `should NOT have additional property …` | `vercel.json` has a key outside Vercel's schema — it validates strictly and JSON has no comments | Remove the key; keep explanations in the docs |
| `bootstrap` says the tenant exists | Already ran it | Either reuse it, or `psql "$SUPA" -c "delete from tenant where slug='schooldemo'"` and start over |
| `seed-demo` refuses to run | The tenant already has students | Intended safety. Same delete as above to reset |

**Full reset**, if you want a clean slate:

```bash
psql "$SUPA" -c "delete from tenant where slug = 'schooldemo'"
```

Everything cascades. Then re-run Step 2.

---

## Demoing it well

**Say this up front:** everything they can click is real software on a real
database. Four modules show a lock — Timetable, Library, Transport, Hostel —
and those are honestly marked as not built rather than filled with sample data.

Suggested order, about ten minutes:

1. **Dashboard** — real figures, and the 2FA prompt showing security is built in
2. **Attendance** — pick a class, three weeks of history, mark today, save.
   Then change a settled record to show it demands a written reason.
3. **Fees** — search a student, take a payment, watch the exact balance change.
   Try to overpay and get refused.
4. **Exams** — published results with ranks and grades.
5. **Sign in as Maya the teacher** — she sees only her own classes and has no
   Fees or School setup at all. This is the point that lands with a principal.

**Be ready for "can it do X?"** The honest answer for payroll, library,
transport, hostel, timetable and SMS is *not yet, and here is the roadmap* —
the locked pages say exactly that.

---

## After they approve

Do not simply start entering real students into this deployment. Go back to
[DEPLOYMENT.md](DEPLOYMENT.md) and work Stages 4–6:

1. Backups with a **restore you have actually performed**
2. Monitoring and alerts
3. The DPDP data-processing agreement and privacy notice
4. Their real data imported and **reconciled** against their records
5. A two-week parallel run before anything is switched off

That is the difference between a demo they liked and a system their school can
depend on.
