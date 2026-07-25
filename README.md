# EduNova School ERP

EduNova keeps the existing site theme while replicating Mighty School’s role navigation and operational flows in Vue 3 + TypeScript.

## Included

- The complete Mighty administration topology: 151 dashboard and workflow routes
- Permission-scoped staff/teacher access with 45 enabled routes
- Mighty’s separate 11-route parent portal and 9-route student portal
- Student/staff records, migration, attendance, academics, payroll, fees, accounting, routines, library, exams, certificates, SMS, question bank, reports, settings, Zoom, CMS, hostel, transport, and AI
- Dedicated transaction flows for attendance entry, student migration, smart fee collection, accounting vouchers, routine editing, book issue/return, mark entry, result processing, certificates, question creation, and configuration
- Parent child-switching, fee information/payment, assignments, behavior, notices, events, exam results, and account security
- Student routine, fees, library history, assignment submission, behavior, notices, events, profile, and password security
- Search, filtering, create/view/edit/delete, CSV exports, downloads, local backups, and namespaced persistent browser storage
- Responsive desktop and mobile application shell

## Run locally

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

## Data architecture

The demo is usable without a server and stores changes under namespaced `edunova:*` keys in browser storage. The implementation is independent of the temporary `mighty school code` reference folder, so that folder can be removed after review.

Run `node scripts/verify-mighty.mjs` while the app is open in a headless Edge debugging session to execute the full role-route and transaction-flow smoke matrix.

For production deployment, replace the local persistence boundary with authenticated APIs backed by tenant isolation, audited RBAC, a transactional database, object storage, background jobs, notification providers, payment gateways, and managed backups.
