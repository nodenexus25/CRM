# TalentFlow — Phase 3 Plan (CRM & Submissions)

Status: **complete** (verified 2026-11-24 — see
[`PHASE-3-VERIFICATION.md`](./PHASE-3-VERIFICATION.md)) · owner: full-stack · depends on:
Phase 2 (verified — see [`PHASE-2-VERIFICATION.md`](./PHASE-2-VERIFICATION.md))

This document is the working plan for Phase 3. It lists the modules, the endpoints, the pages and
the order of work, and it is updated as the phase progresses. Everything obeys the conventions
established in Phases 1–2 (three-layer tenancy, Zod schemas from `packages/types`, the `{ data }`
envelope, audit, CSRF, cookie auth, `@RequirePermissions`).

Legend: `[x]` done · `[~]` in progress · `[ ]` pending

---

## 0. Order of work

1. **Module 1 — clients & contacts** (the CRM anchor: jobs and submissions hang off a client).
2. **Module 2 — submissions** (candidate → client, branded resume, feedback, status).
3. **Module 3 — interviews** (schedule, interviewers, feedback & ratings).
4. **Module 4 — offers & placements** (offer lifecycle, placement, margin).
5. **Module 5 — activities, tasks, notes & My Day** (the daily workspace).
6. **Module 6 — email** (templates + merge fields + send, logged to timelines).
7. **Verification** — e2e suites, `docs/PHASE-3-VERIFICATION.md`, `ROADMAP.md`, `ARCHITECTURE.md`.

After every module: `pnpm typecheck && pnpm lint && pnpm test`, then exercise the module against
the running app; `pnpm build` before closing the module.

---

## 1. Schema — **no new models or columns**

Phase 1 already modelled the whole CRM surface, so Phase 3 is an API + web build on top of an
otherwise unchanged schema. The models it consumes:

> **Module 4 addendum** — two migrations were added while verifying offers & placements:
> `20261101211618` moves the `Job`/`Offer`/`Placement` `ratePeriod` column defaults from `'YEAR'`
> to `'ANNUAL'`, and `20261101213000_backfill_rate_period_vocabulary` rewrites the legacy
> `'HOUR'`/`'YEAR'` values already in `Job`/`Offer`/`Placement`/`Candidate` in place. The canonical
> vocabulary is `rateTypeSchema` (`HOURLY` | `DAILY` | `MONTHLY` | `ANNUAL`), which the API and
> seed now both use. No new columns.

| Concern | Model(s) | Notes |
|---|---|---|
| Clients & contacts | `Client`, `ClientContact` | `ClientStatus` (PROSPECT/ACTIVE/INACTIVE/CHURNED), commercial defaults, `ownerId`, `customFields`; contacts carry `isPrimary`, `department`, and `Job.contactId` |
| Submissions | `Application` | submission rides on the application: `submissionStatus SubmissionStatus`, `submittedAt`, `submittedById`, `clientFeedback`, `clientFeedbackAt`, `resumeId` (tailored snapshot) |
| Interviews | `Interview`, `InterviewInterviewer` | type/status/round, `scheduledStart`/`scheduledEnd`/`timezone`/`durationMinutes`, `meetingUrl`, feedback (`feedback`, `rating`, `strengths`, `concerns`, `feedbackAt`), many-to-many interviewers with `isLead` |
| Offers & placements | `Offer`, `Placement` | offer lifecycle + rates; placement with `marginCents` / `marginPercentage` / `feeCents` / `guaranteeDays` |
| Activities / tasks / notes | `Activity`, `Task`, `Note` | polymorphic `entityType` + `entityId`, denormalised candidate/job/client/contact links; tasks have `dueAt`, `reminderAt`, `assigneeId`, subtasks |
| Email | `EmailTemplate`, `EmailMessage` | `mergeFields String[]`, `htmlBody`; messages thread via `messageId` / `inReplyTo` and link to an entity |

`SUBMISSION` and `CLIENT_REVIEW` are already pipeline stage types, and the tenant-default pipeline
in `packages/types` already ships `submitted`, `client-review`, `interview`, `offer`, `placed`
stages — so a submission can advance the application's stage without inventing new vocabulary.

---

## 2. Permissions — **no changes**

Every Phase 3 action is already in the 101-permission catalogue and wired into the six role
templates: `client:*`, `contact:*`, `submission:send`, `interview:*`, `offer:*`, `placement:*`
(incl. `placement:view_margin`), `activity:*`, `task:*` (incl. `task:assign`), `note:*`,
`email:send`, `email:template_read`, `email:template_manage`, `attachment:*`.

---

## 3. Module 1 — clients & contacts  `[x]`

**API** — `modules/clients/` (+ `client-contacts` nested):

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /clients` | `client:read_all` / `read_own` | paginated, filters: `status`, `industry`, `ownerId`, `q`, `sortBy` |
| `GET /clients/stats` | `client:read_all` | counts by status, open jobs, active placements |
| `POST /clients` | `client:create` | |
| `GET /clients/:id` | `client:read_*` | with contacts, jobs, recent activity |
| `PATCH /clients/:id` | `client:update` | status transitions allowed |
| `DELETE /clients/:id` | `client:delete` | soft delete; blocked while it has open jobs (409) |
| `GET /clients/:id/contacts` | `contact:read_*` | |
| `POST /clients/:id/contacts` | `contact:create` | first contact becomes primary |
| `PATCH /contacts/:id` | `contact:update` | incl. `isPrimary` (demotes siblings) |
| `DELETE /contacts/:id` | `contact:delete` | blocked while referenced by an open job (409) |

`_own` scoping filters by `Client.ownerId = userId`.

**Web**
- `/clients` — replaces the placeholder: status tabs, search, owner filter, `DataTable`, saved views.
- `/clients/new`, `/clients/[id]` — overview (commercial terms, address, owner), contacts tab,
  jobs tab, activity timeline, status change + delete actions.

---

## 4. Module 2 — submissions  `[x]`

**API** — `modules/submissions/` (operates on `Application`):

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /submissions` | `application:read_*` | list applications where `submissionStatus != DRAFT`; filters `status`, `clientId`, `jobId`, `recruiterId`, date range |
| `POST /applications/:id/submit` | `submission:send` | sets `SUBMITTED`, `submittedAt`, `submittedById`; option `hideContact` renders a contact-free resume; optional `resumeId`; optional `contactId` to email |
| `PATCH /applications/:id/submission` | `application:update` | status transition (`CLIENT_VIEWED`/`SHORTLISTED`/`INTERVIEWING`/`OFFERED`/`REJECTED`/`WITHDRAWN`) |
| `POST /applications/:id/submission/feedback` | `application:update` | client feedback text + timestamp |
| `GET /applications/:id/submission` | `application:read_*` | submission detail incl. feedback history |

Submitting also writes a `StageHistory` move to the job's `SUBMISSION`-type stage when one exists,
plus an `Activity`.

**Web**
- `/submissions` — replaces the placeholder: list with client/status/recruiter filters, age column.
- Submit dialog on the application/candidate detail: choose client contact, tailor resume
  (hide-contact toggle), preview, send.
- Submission panel showing status timeline + feedback.

---

## 5. Module 3 — interviews  `[x]`

**API** — `modules/interviews/`:

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /interviews` | `interview:read` | filters `status`, `type`, `from`/`to`, `jobId`, `candidateId`, `interviewerId`, `upcoming` |
| `POST /interviews` | `interview:create` | application, type, round, start/end, timezone, interviewers[], meetingUrl |
| `GET /interviews/:id` | `interview:read` | |
| `PATCH /interviews/:id` | `interview:update` | reschedule (status → `RESCHEDULED` when start changes) |
| `DELETE /interviews/:id` | `interview:delete` | soft delete + status `CANCELLED` |
| `POST /interviews/:id/feedback` | `interview:feedback` | feedback, rating 1–5, strengths, concerns |
| `GET /interviews/calendar?from&to` | `interview:read` | interviewers' interviews for a range |

**Web**
- `/interviews` — replaces the placeholder: upcoming/past tabs, agenda list, status badges.
- Schedule dialog (date/time/timezone, type, round, interviewers), feedback dialog with rating.

---

## 6. Module 4 — offers & placements  `[x]`

**API** — `modules/offers/` and `modules/placements/`:

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /offers` | `offer:read` | filters `status`, `jobId`, `applicationId` |
| `POST /offers` | `offer:create` | for an application; rates, dates, currency |
| `PATCH /offers/:id` | `offer:update` | edit + status; `SENT` sets `sentAt`, terminal sets `respondedAt` |
| `POST /offers/:id/accept` | `offer:update` | marks `ACCEPTED`, creates/links the `Placement` |
| `DELETE /offers/:id` | `offer:delete` | |
| `GET /placements` | `placement:read_all` / `_own` | filters `status`, `clientId`, `recruiterId`, date range |
| `GET /placements/stats` | `placement:read_all` + `placement:view_margin` | counts, fee, margin totals |
| `PATCH /placements/:id` | `placement:update` | rates/dates/status; recomputes margin |
| `DELETE /placements/:id` | `placement:delete` | |

Margin is computed server-side (`marginCents = bill - pay`, `marginPercentage`) and only returned
when the caller holds `placement:view_margin`.

**Web**
- Offer + placement panels on the application detail (raise offer, mark sent/accepted/declined,
  placement card with rates + margin).
- `/placements` list page (new) with margin column gated on the permission.

---

## 7. Module 5 — activities, tasks, notes & My Day  `[x]`

**API** — extend `modules/activities/`, add `modules/tasks/`, `modules/notes/`:

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /activities` | `activity:read` | extend existing list: `type`, date range, `mine` |
| `POST /activities` | `activity:create` | log call/meeting/note against any entity |
| `PATCH /activities/:id` | `activity:update` | new |
| `DELETE /activities/:id` | `activity:delete` | exists |
| `GET /tasks` | `task:read` | filters `status`, `assigneeId` (`me`), `dueBefore`, `overdue`, entity |
| `POST /tasks` | `task:create` | title, due, reminder, priority, assignee, entity link |
| `PATCH /tasks/:id` | `task:update` | edit / reassign (requires `task:assign` to change assignee) |
| `POST /tasks/:id/complete` | `task:update` | sets `COMPLETED` + `completedAt` |
| `DELETE /tasks/:id` | `task:delete` | |
| `GET /tasks/my-day` | `task:read` | today's tasks + today's interviews + overdue tasks |
| `GET/POST/PATCH/DELETE /notes` | `note:*` | polymorphic notes on any entity; edit is author-only unless the caller also holds `note:delete` |

**Web**
- Task list + create/edit dialog, complete checkbox, assignee picker.
- **My Day** panel on `/dashboard`: overdue, today's tasks, today's interviews.
- "Log activity" dialog available from candidate / client / job / application.

---

## 8. Module 6 — email  `[x]`

> **Addendum** — also ships `POST /email/preview` (merge render for the compose dialog). The
> outbound worker was made retry-safe during verification (it could re-deliver a message when
> the post-send status write failed) — see `PHASE-3-VERIFICATION.md` §6.1.

**API** — `modules/email/`:

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /email/templates` | `email:template_read` | filters by `category`, `isActive` |
| `POST /email/templates` | `email:template_manage` | |
| `PATCH /email/templates/:id` | `email:template_manage` | |
| `DELETE /email/templates/:id` | `email:template_manage` | system templates deactivatable, not deletable |
| `POST /email/send` | `email:send` | to/cc/subject/body or `templateId` + `mergeData`; queues a `EmailMessage`, writes an `Activity` |
| `GET /email/messages` | `email:template_read` | sent log, filters `status`, `entityType`/`entityId` |
| `GET /email/messages/:id` | `email:template_read` | |

Merge fields (`{{candidate.firstName}}`, `{{job.title}}`, …) are rendered server-side from a
whitelisted context so no template can reach unmapped data. Send runs on the `email` BullMQ queue
via the existing mailer; the message is logged to the entity timeline.

**Web**
- Compose dialog (template picker, merge-field preview, to/cc), reachable from candidate / client /
  application.
- `Settings → Email templates` CRUD page.

---

## 9. Verification  `[x]`

- One e2e suite per module (`clients`, `submissions`, `interviews`, `offers`, `tasks`, `email`),
  following the Phase 2 harness (non-owner `NOBYPASSRLS` role so RLS is active).
- Seed enrichment: ensure each surface has demo data (clients/contacts/jobs/submissions/
  interviews/offers/placements/activities/tasks/emails already seeded in Phase 1/2 — top up
  submission feedback and email templates if missing).
- `pnpm typecheck && pnpm lint && pnpm build && pnpm test && pnpm test:e2e` all green.
- `docs/PHASE-3-VERIFICATION.md` written; `ROADMAP.md` Phase 3 ticked; `ARCHITECTURE.md` updated
  (new modules + endpoints).
