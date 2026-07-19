# EduNova School ERP

A Vue 3 + TypeScript school management workspace inspired by the strongest common patterns in OneSchool, eSchool SaaS, and modern Adminex-style dashboards.

## Included in this foundation

- Four switchable role experiences: administrator, teacher, student, and guardian
- Role-aware navigation and dashboard content
- Responsive desktop/mobile application shell
- Academic, attendance, timetable, assignment, exam, fee, communication, transport, library, HR, reporting, and settings module map
- Dashboard KPIs, attendance analytics, daily schedule, tasks, and announcements
- Shared design tokens and reusable panel/card patterns

## Run locally

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

## Product architecture

The current release is the frontend product foundation. A production ERP should connect these screens to an API with tenant isolation, audited RBAC, PostgreSQL, object storage, background jobs, notification providers, payment gateways, and automated backups. Recommended implementation order: identity/RBAC, academic master data, people/admissions, attendance/timetable, assignments/exams, fees, communications, then operational modules and reports.
