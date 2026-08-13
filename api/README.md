# EduNova API

Fastify + TypeScript. Sole writer to the database; the browser never talks to
Supabase directly and there is no anon key in the frontend.

## Running it locally

You need PostgreSQL running (`brew services start postgresql@14`).

```bash
createdb edunova_dev
for f in ../supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d edunova_dev -f "$f"; done
```

```bash
cp .env.example .env
npm install
npm run bootstrap -- --name "Your School" --email admin@yourschool.edu
npm run dev
```

`bootstrap` prints a generated password **once** and sets
`must_change_password`. Nothing in this repo ever ships a known credential.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Watch mode on `PORT` (default 3000) |
| `npm run build` | Compile `src/` to `dist/` (tests excluded) |
| `npm test` | Full suite against a throwaway `edunova_api_test` database |
| `npm run typecheck` | `tsc --noEmit` over src, scripts and tests |
| `npm run bootstrap` | Create the tenant and its first superadmin |

`npm test` recreates the test database from `../supabase/migrations` on every
run, so a broken migration fails the suite at setup rather than in production.

## Endpoints

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/health` | public | |
| POST | `/auth/login` | public | Rate limited per IP; returns `mfa_required` when enrolled |
| POST | `/auth/logout` | authenticated | |
| GET | `/auth/me` | authenticated | Roles, permissions, scope kind |
| POST | `/auth/change-password` | authenticated | Signs out all other devices |
| POST | `/auth/forgot-password` | public | Uniform response; no user enumeration |
| POST | `/auth/reset-password` | public | Single-use, expiring, hashed token |
| POST | `/auth/mfa/begin` | authenticated | Returns secret + `otpauth://` URI |
| POST | `/auth/mfa/confirm` | authenticated | Returns 10 recovery codes, shown once |
| GET | `/students` | `student.read` | Scoped list; `q`, `status`, `sectionId`, `page`, `pageSize` |
| GET | `/students/:id` | `student.read` | Medical notes gated and audit-logged |
| POST | `/students` | `student.write` | |
| PATCH | `/students/:id` | `student.write` | |
| DELETE | `/students/:id` | `student.delete` | Withdraws; never hard-deletes |

Every route is authenticated **by default**. Public routes opt out explicitly
with `config: { public: true }`, so a new route added without thinking is
protected rather than accidentally open.

## How a request works

```
cookie ──► lookupSession()            no tenant context yet — the session
           (user_session only)        row is what tells us the tenant
              │
              ▼
           withContext(tenantId, userId)
              │   SET LOCAL ROLE erp_app        ← cannot bypass RLS
              │   set_config('app.tenant_id')   ← drives RLS policies
              │   set_config('app.user_id')     ← drives audit triggers
              ▼
           load user, roles, permissions, row scope
              │
              ▼
           handler ──► request.require('student.write')
                       assertStudentInScope(...)
```

All three settings are transaction-local, so a pooled connection cannot leak
one request's tenant into the next — there is a test for exactly that.

## Configuration

See `.env.example`. Two settings matter more than the rest:

- **`DB_APP_ROLE`** (default `erp_app`) — the role every request transaction
  downgrades to. It must not own the tables and must not have `BYPASSRLS`, or
  the tenant-isolation policies become decorative. Set it empty only if you
  connect as `erp_app` directly.
- **`COOKIE_SECURE`** — must be `true` in production; the app refuses to start
  otherwise.

## Not yet wired

- **Email delivery.** `/auth/forgot-password` creates a valid reset token but
  there is no provider attached, so the token is only obtainable from the
  database. This is deliberately safer than logging it, and it is the first
  thing to connect before real users exist.
- School setup, staff and CSV import endpoints — next in the build order.
