# TalentFlow — Phase 3 Verification

**Phase 3 — CRM & Submissions** · status: **complete** · verified on 2026-11-24

This document is the verification record for Phase 3. **All six modules** are delivered and
verified: clients & contacts, submissions, interviews, offers & placements, activities / tasks /
notes / My Day, and email. The record also covers the §9 verification work (e2e suites, seed
top-up, docs). Every number below is observed command output, not an expectation.

Related documents: [`PHASE-3-PLAN.md`](./PHASE-3-PLAN.md) (plan) · [`PHASE-2-VERIFICATION.md`](./PHASE-2-VERIFICATION.md) (Phase 2) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) (design) · [`ROADMAP.md`](./ROADMAP.md) (phases).

---

## 1. Quick start

Unchanged from Phase 2. See [`PHASE-2-VERIFICATION.md`](./PHASE-2-VERIFICATION.md) §1–§2 for
setup, service URLs and demo credentials (`admin@acme-demo.test` / `Passw0rd!23`; recruiter
`priya.nair@acme-demo.test`; viewer `tom.reyes@acme-demo.test`).

```bash
pnpm infra:up && pnpm --filter @talentflow/api test:db:setup   # infra + test database
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

> Run `pnpm build` and `pnpm test:e2e` **one after the other, not in parallel.** The Playwright
> step of `test:e2e` starts `next dev` in `apps/web`, which writes to the same `.next` directory
> as `next build`. Running both at once fails the build with
> `Invariant: no direct app page entry found for /_not-found` (see §6.2).

---

## 2. Module status

| # | Module | Verified scope | Status |
|---|---|---|---|
| 1 | Clients & contacts | list / stats / CRUD, nested contacts with primary demotion, open-job delete guards, `/clients`, `/clients/new`, `/clients/[id]` | `[x]` |
| 2 | Submissions | submit (hide-contact resume), status transitions, client feedback, `/submissions`, submit dialog + panel | `[x]` |
| 3 | Interviews | schedule / reschedule / cancel, panel with lead, scorecard 1–5, calendar window, `/interviews` | `[x]` |
| 4 | Offers & placements | offer lifecycle, accept → placement, margin gated by `placement:view_margin`, `/placements` | `[x]` |
| 5 | Activities, tasks, notes & My Day | activity log / correct / delete with type/date/`mine` filters; tasks with `task:assign` guard, complete, subtasks; author-owned notes; `GET /tasks/my-day`; `/tasks`, My Day panel on `/dashboard`, Log-activity dialog, notes panel | `[x]` |
| 6 | Email | template CRUD with system-template guard and merge-field whitelist; preview; send → `EmailMessage` + timeline `Activity` → `email-outbound` worker; message log; compose dialog; `Settings → Email templates` | `[x]` |
| 9 | Verification | e2e suite per module, seed top-up, this doc, `ROADMAP.md`, `ARCHITECTURE.md` | `[x]` |

---

## 3. What was built

### 3.1 Schema & permissions

- **No new models or columns.** Phase 1 already modelled the CRM surface. The only migrations
  are the two Module 4 rate-period fixes (`20261101211618`,
  `20261101213000_backfill_rate_period_vocabulary`); see `PHASE-3-PLAN.md` §1. Totals are
  unchanged at **56 models / 42 enums**, across **6 migrations**.
- **No new permissions.** The catalogue stays at **101**. Phase 3 consumes `client:*`,
  `contact:*`, `submission:send`, `interview:*`, `offer:*`, `placement:*`, `activity:*`,
  `task:*`, `note:*` and `email:*`.

### 3.2 API: 196 endpoints across 29 controllers

Phase 3 grew the API from 146 endpoints / 20 controllers to **196 endpoints / 29 controllers**:
**49 endpoints in 9 new controllers**, plus `PATCH /activities/:id` on the existing one.

| Controller | Endpoints |
|---|---|
| `clients` | 8 |
| `client-contacts` | 2 |
| `submissions` | 5 |
| `interviews` | 7 |
| `offers` | 5 |
| `placements` | 4 |
| `tasks` | 6 |
| `notes` | 4 |
| `email` | 8 |
| `activities` | 3 → 4 |

The per-endpoint breakdown is in [`ARCHITECTURE.md`](./ARCHITECTURE.md) §6a.

### 3.3 Web: 35 routes, 100 components

New or replaced routes:

- `/clients`, `/clients/new`, `/clients/[id]`
- `/submissions`
- `/interviews`
- `/placements`
- `/tasks`
- `/settings/email-templates`

`/dashboard` now hosts the **My Day** panel. Shared Phase 3 components:

- `activity/log-activity-dialog`
- `tasks/{task-list, task-dialog, my-day-panel}`
- `notes/notes-panel`
- `email/{compose-email-dialog, email-template-dialog}`

The compose dialog is reachable from the candidate, client and application detail pages. The
activity timeline and its Log-activity dialog appear on candidate, client, job and application
detail pages.

---

## 4. Verification

### 4.1 Static & automated gates

| Gate | Command | Observed result |
|---|---|---|
| Typecheck | `pnpm typecheck` | `Tasks: 5 successful, 5 total` |
| Lint | `pnpm lint` | `Tasks: 5 successful, 5 total`; **0 errors** (151 `consistent-type-imports` warnings, all pre-existing house style; Nest DI needs value imports) |
| Build | `pnpm build` | `Tasks: 3 successful, 3 total`; 103 kB shared First Load JS, 34.5 kB middleware |
| Unit | `pnpm --filter @talentflow/api test` | **1 suite / 6 tests passed** (`email.service.spec.ts`, new) |
| E2E | `pnpm test:e2e` | exit 0; **20 API suites / 354 tests passed** (Phase 2: 14 / 197) + Playwright |

Route sizes for the Phase 3 surface, as emitted by `pnpm build`:

```
├ ○ /clients                             6.21 kB         243 kB
├ ƒ /clients/[id]                        9.29 kB         251 kB
├ ○ /clients/new                         1.22 kB         220 kB
├ ○ /dashboard                           8.58 kB         215 kB
├ ○ /interviews                          14.9 kB         239 kB
├ ○ /placements                          9.93 kB         229 kB
├ ○ /settings/email-templates            6.71 kB         230 kB
├ ○ /submissions                         5.92 kB         236 kB
├ ○ /tasks                               9.73 kB         240 kB
```

### 4.2 E2E suites added in Phase 3

All suites run against `talentflow_test` through the Phase 2 harness. Phase 3 contributes
**6 suites / 157 tests** (197 + 157 = the 354 observed). The last two were written and first run
during this verification:

| Suite | Tests | Covers |
|---|---|---|
| `clients.e2e-spec.ts` | 25 | Module 1: client and contact CRUD, filters, primary-contact demotion, open-job delete guards |
| `submissions.e2e-spec.ts` | 21 | Module 2: submit, hide-contact resume, status transitions, feedback, list filters |
| `interviews.e2e-spec.ts` | 27 | Module 3: schedule, reschedule, panel, scorecard, cancel, list filters, calendar |
| `offers-placements.e2e-spec.ts` | 32 | Module 4: offer lifecycle, accept → placement, margin gating, stats |
| `tasks.e2e-spec.ts` **(new)** | 31 | **Tasks:** permissions per role; create defaults and explicit-null assignee; entity links + subtask counts; half-specified links and stale or cross-tenant references → 422; `task:assign` guard (ACCOUNT_MANAGER → 403); idempotent complete; soft delete; status/priority/assignee/`me`/overdue filters; undated-last sort; tenant isolation. **My Day:** UTC buckets, stats, interviewer-only interviews. **Activities:** log, type/date/`mine` filters, correct, delete permissions, stale link. **Notes:** pinned-first, author edit, **non-author edit → 403**, moderator edit/delete, viewer read-only |
| `email.e2e-spec.ts` **(new)** | 21 | **Permissions:** recruiter vs viewer. **Templates:** derived merge fields; non-whitelisted field → 422; duplicate key → 409 even after soft delete; malformed key; immutable key; category/active filters; system template delete → 409 but deactivatable; tenant isolation. **Preview:** all merge groups, `missingFields` + `mergeData`, **whitelist holds even when `mergeData` supplies a forbidden key**, interview-derived context. **Send:** template render + `EmailMessage` + `EMAIL` activity on the timeline; ad-hoc client email; unlinked message makes no activity; validation before any write. **Message log:** ordering, filters, detail, 404, tenant isolation |

### 4.3 Database & seed

`pnpm db:seed` re-run after the seed fix in §6.1. Phase 3 row counts in the demo workspace:

```
clients 10   contacts 20   interviews 32   offers 7   placements 7
activities 320   tasks 45   notes 70   email_templates 5 (all isSystem)   email_messages 45
applications with client feedback 11
```

Submission feedback consistency, checked with SQL after re-seeding:

| Check | Rows |
|---|---|
| feedback text without a timestamp | 0 |
| timestamp without feedback text | 0 |
| feedback on a `DRAFT` (never-submitted) application | 0 |
| feedback dated before `submittedAt` | 0 |

### 4.4 Live API (Modules 5–6)

`pnpm dev:api` was run against the seeded database and probed with a cookie- and
CSRF-aware client. Admin = `admin@acme-demo.test`, recruiter = `priya.nair@acme-demo.test`.

| Probe | Observed |
|---|---|
| `GET /tasks/my-day` | 200; `stats={"open":3,"inProgress":2,"dueToday":0,"overdue":0,"completedToday":0}` |
| `GET /tasks` · `?overdue=true` | 200; total 45 · 2 |
| `POST /tasks` → `/complete` → `DELETE` | 201 (assignee defaults to Amelia Grant) → 201 `COMPLETED` with `completedAt` → 200 |
| `GET /activities?type=CALL` | 200; total 51 |
| `POST` → `PATCH` → `DELETE /activities` | 201 → 200 (`outcome=Left voicemail`) → 200 |
| `PATCH /notes/:id`: recruiter on admin's note | **403** |
| `PATCH /notes/:id`: recruiter on own note · admin on recruiter's note | 200 · 200 |
| `GET /email/templates` | 200; 5 templates, 5 system |
| `DELETE` a system template | **409** |
| `POST /email/preview` (sourcing template, candidate only) | 201; `missingFields=["job.title","job.locationCity"]` (no job linked) |
| `POST /email/send` → `GET /email/messages/:id` 4 s later | 201 `QUEUED` → 200 **`SENT`**, `sentAt` set |
| Candidate timeline `type=EMAIL` | newest entry is the sent subject |
| Mailpit `to:verify-phase3@example.test` | **1 message delivered** |

The probe's own task, activity and notes were deleted afterwards. The probe email remains in the
log (`email_messages` 46) and in Mailpit.

---

## 5. Module 5–6 surfaces in the web app

- **Tasks** (`/tasks`): list with filters, a create/edit dialog (assignee picker gated on
  `task:assign`) and a complete checkbox.
- **My Day** (`/dashboard`): overdue tasks, today's tasks and today's interviews.
- **Log activity** dialog: opens from the activity timeline on candidate, client, job and
  application pages.
- **Notes panel**: Edit / Pin now appear only on notes the caller may change (their own, or any
  note if they hold `note:delete`), matching the API rule.
- **Compose email** dialog: template picker, a merge-field preview that flags unresolved
  fields, and to/cc. It opens from candidate, client and application pages.
- **Settings → Email templates**: CRUD; system templates can be deactivated but not deleted.

---

## 6. Defects found and fixed

### 6.1 Fixed

| # | Defect | Root cause | Fix |
|---|---|---|---|
| 1 | **Any recruiter could edit anyone's note.** The permission is described as "Edit own notes". | `NotesService.update` used `note:update` as the author-check override. The route guard already requires `note:update`, so the override always applied and the author check could never fail. | The override is now the moderator-tier `note:delete` (Tenant Admin / Recruiter Manager). The notes panel hides Edit/Pin to match. Pinned by `tasks.e2e-spec.ts`: "refuses to let a non-author … edit someone else's note". |
| 2 | **The outbound worker could deliver the same email twice.** | In `runOutboundJob`, a failure *after* a successful SMTP send (e.g. the `SENT` status update) was caught and rethrown. BullMQ retries thrown jobs (3 attempts), so the message was re-sent. Retries also never checked whether the message had already gone out. | Only `mailer.sendRaw` can fail the job. Status writes go through `markDelivery` (`updateMany`, logged, never thrown). Messages not in `QUEUED`/`FAILED` are skipped. Pinned by the new `email.service.spec.ts` (6 tests). |
| 3 | **Seeded submission feedback was inconsistent.** | `seed.ts` rolled `chance(0.25)` separately for `clientFeedback` and `clientFeedbackAt`, and did not skip `DRAFT` applications. | One roll decides both fields; only submitted applications get feedback; the timestamp is never before submission. Varied feedback text. Verified in §4.3. |

### 6.2 Findings that were **not** defects

- **`pnpm build` failed with `Invariant: no direct app page entry found for /_not-found`.**
  This happened only while `pnpm test:e2e` ran at the same time: Playwright's `next dev` and
  `next build` were writing to the same `apps/web/.next` directory. Run on its own (after
  clearing `.next`), the build passes. `app/not-found.tsx` exists and is correct.
- **`prisma:error … No record was found for an update` during `email.e2e-spec.ts`.** The
  outbound worker was still processing a message when the next test truncated the database.
  These lines led to defect 2. After the fix, a vanished row is tolerated by `updateMany`.
- **Template sent without a linked job renders blank `{{job.title}}`.** This is by design. The
  preview returns the key in `missingFields`, and the compose dialog shows a destructive
  "Missing merge fields" alert before sending.
- **`VIEWER` has no email access at all.** `email:template_read` does not end in a read-only
  suffix, so the read-only role template does not include it. Viewers get 403 on templates and on
  the message log. This is consistent with the permission design and is asserted in
  `email.e2e-spec.ts`.

---

## 7. Known limitations

1. **My Day uses the UTC day, not the user's timezone.** Near midnight, a user far from UTC can
   see "today" shift. Bucketing by the tenant/user timezone is a Phase 4 dashboard concern.
2. **Activity and task entity links are not validated against the target record.** `entityId`
   is stored as given. `candidateId` / `jobId` / `assigneeId` / `parentTaskId` *are* validated
   (422).
3. **Task reminders are stored but not dispatched.** `reminderAt` is persisted and shown. A
   reminder worker is not part of Phase 3.
4. **Email merge dates use the server's local time.** `today` and `interview.scheduledStart` are
   formatted in the API process's timezone, not the recipient's.
5. **No inbound email.** `EmailMessage` threading fields exist, but two-way sync is Phase 6.
6. Phase 2 limitations still apply (RLS dormant in local dev, no Dockerfiles). See
   `PHASE-2-VERIFICATION.md` §7.

---

## 8. Exit criteria

| Criterion | Status |
|---|---|
| Every Phase 3 endpoint in the plan is implemented, permission-checked, validated and tenant-scoped | met (196 endpoints / 29 controllers) |
| One e2e suite per module, running under the RLS-active harness | met (clients, submissions, interviews, offers-placements, tasks, email) |
| Seed covers every Phase 3 surface, with consistent submission feedback | met (§4.3) |
| `typecheck`, `lint`, `build`, `test`, `test:e2e` all green | met (§4.1) |
| Modules exercised against the running app | met (§4.4) |
| `ROADMAP.md` ticked; `ARCHITECTURE.md` updated | met |

---

## 9. Next

Phase 3 is **complete**. The next phase is **Phase 4: Dashboards & Reports** (recruiter,
manager and admin dashboards; reports for submissions, interviews and placements; time-to-fill,
funnel, source effectiveness, revenue/margin; date-range filters and CSV export). It will open
with `docs/PHASE-4-PLAN.md`.
