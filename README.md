# EduNova School ERP

A school management system built in phases. Vue 3 + TypeScript frontend, Fastify
API, PostgreSQL (Supabase).

> **Status: in development.** Two modules are live end-to-end (dashboard and
> students); the rest are designed, with database schema and permissions in
> place, but not yet connected. The application shows nothing it cannot back
> with real data — modules that are not ready say so rather than displaying
> sample records. Not yet suitable for a school's live data; see
> [docs/PRODUCTION-PLAN.md](docs/PRODUCTION-PLAN.md) for what remains.

## What works today

| Area | Status |
|---|---|
| Authentication | Argon2id passwords, hashed opaque sessions, lockout, per-IP throttling, password reset, TOTP two-factor with recovery codes |
| Authorization | 26 permissions across 6 roles, enforced server-side, plus row-level scope (teachers see their sections, students see themselves) |
| Students | List with search and pagination, detail, create, edit, withdraw |
| Dashboard | Real counts, scoped to what the signed-in user may see |
| Audit trail | Before/after JSON on every write, attributed to the acting user; logins and sensitive reads recorded |
| Tenant isolation | Row Level Security, verified through the real application path |
| Compliance | DPDP consent and data-request tables; sensitive fields gated and their reads logged |

## Repository layout

```
├── src/              Vue 3 frontend
├── api/              Fastify API server  — see api/README.md
├── supabase/
│   ├── migrations/   13 SQL migrations, the source of truth for the schema
│   └── tests/        schema assertion suite
├── scripts/db-test.sh
└── docs/
    ├── PRODUCTION-PLAN.md   phased plan and honest status
    └── ARCHITECTURE.md      decisions, ERD, invariants
```

## Running it locally

You need Node 22+ and PostgreSQL.

**1. Database**

```bash
createdb edunova_dev
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d edunova_dev -f "$f"; done
```

**2. API**

```bash
cd api
cp .env.example .env        # set DATABASE_URL and TENANT_SLUG
npm install
npm run bootstrap -- --name "Your School" --email admin@yourschool.edu --admin-name "Your Name"
npm run dev
```

Bootstrap prints a generated password **once** and forces a change at first
sign-in. No account in this project ever ships with a known password.

**3. Frontend**

```bash
npm install
echo "VITE_API_URL=http://localhost:3000" > .env.local
npm run dev
```

## Testing

```bash
./scripts/db-test.sh      # schema invariants: 13 assertion groups
cd api && npm test        # API: 65 tests across 7 files
```

Both rebuild a throwaway database from `supabase/migrations`, so a broken
migration fails immediately rather than in production.

## Architecture in one paragraph

The browser talks only to the Fastify API — there is no Supabase key in the
frontend. Every request opens one transaction that downgrades to a role which
cannot bypass Row Level Security, then sets the tenant and acting user as
transaction-local settings. Those settings drive the RLS policies and the audit
triggers, so a query that forgets its tenant filter returns nothing rather than
another school's children, and every write records who made it. Business rules
that must never be violated — gapless receipt numbers, immutable payments,
marks bounded by their paper's maximum, an append-only audit log — are enforced
in the database, not just in application code.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture.

## Licence

See [LICENSE](LICENSE).
