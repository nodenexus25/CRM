# TalentFlow — Phase 2 Verification

**Phase 2 — Core ATS** · status: **complete** · verified on 2026-11-01

This document is the verification record for Phase 2. **Every** Phase 2 module is delivered and
verified — **Module 0 (test harness), Foundation, and Modules 1–8** (pipeline, jobs,
applications, candidates, resume parsing, bulk actions, CSV/Excel import, global search) plus the
§12 seed / load-seed / performance work. Every number below is observed command output, not an
expectation.

Related documents: [`PHASE-2-PLAN.md`](./PHASE-2-PLAN.md) (plan) · [`PHASE-1-VERIFICATION.md`](./PHASE-1-VERIFICATION.md) (Phase 1) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) (design) · [`ROADMAP.md`](./ROADMAP.md) (phases).

---

## 1. Quick start

```bash
pnpm install          # install the workspace
pnpm infra:up         # start Postgres, Redis, MinIO, Mailpit
pnpm db:migrate       # apply migrations
pnpm db:seed          # seed the demo workspace
pnpm db:rls           # apply Row Level Security policies
pnpm dev              # web on :3000, api on :4000
```

Or as a single command:

```bash
pnpm setup            # install + infra:up + db:migrate + db:seed + db:rls
```

| Service | URL | Notes |
|---|---|---|
| Web app | http://localhost:3000 | Next.js 15 |
| API | http://localhost:4000/api/v1 | NestJS |
| API docs (Swagger) | http://localhost:4000/api/docs | OpenAPI |
| Health | http://localhost:4000/health, `/health/ready` | excluded from the `/api/v1` prefix |
| Mailpit UI | http://localhost:8035 | captures all outbound email locally |
| MinIO console | http://localhost:9021 | object storage, bucket `talentflow-files` |

Host ports stay offset from the service defaults (Postgres `5433`, Redis `6380`, MinIO
`9020`/`9021`, Mailpit `1035`/`8035`) so this stack coexists with other local stacks.

Module gates (run from the repository root after every module):

```bash
pnpm typecheck && pnpm lint && pnpm test    # per-module
pnpm build                                  # before closing a module
pnpm test:e2e                               # API (jest/supertest) + web (Playwright)
```

Optional bulk-data check (Phase 2 §12):

```bash
pnpm db:seed:load                           # 100k generated candidates for EXPLAIN ANALYZE
```

> `pnpm test:e2e` runs with `CI=true` in this environment, so Playwright's `reuseExistingServer`
> is **false** — ports 3000 and 4000 must be free or the run aborts. Stop a running `pnpm dev`
> first.

---

## 2. Demo credentials

All seeded users share the same password, taken from `SEED_WORKSPACE_PASSWORD` in `.env`.

| Role | Email | Password |
|---|---|---|
| Tenant Admin (workspace owner) | `admin@acme-demo.test` | `Passw0rd!23` |
| Platform Super Admin | `superadmin@talentflow.test` | `Passw0rd!23` |

| Name | Email | Role |
|---|---|---|
| Amelia Grant | `admin@acme-demo.test` | Tenant Admin |
| Marcus Bell | `marcus.bell@acme-demo.test` | Recruiter Manager |
| Priya Nair | `priya.nair@acme-demo.test` | Recruiter |
| Diego Alvarez | `diego.alvarez@acme-demo.test` | Recruiter |
| Hannah Osei | `hannah.osei@acme-demo.test` | Account Manager |
| Tom Reyes | `tom.reyes@acme-demo.test` | Viewer |

Seeded workspace: **Acme Demo Staffing** (`acme-demo`, Growth plan, `America/Chicago`).

---

## 3. Module status

| # | Module | Verified scope | Status |
|---|---|---|---|
| 0 | Test harness | Jest + supertest against `talentflow_test` as a non-owner `NOBYPASSRLS` role; Playwright smoke; root `pnpm test` / `pnpm test:e2e` | `[x]` |
| — | Foundation | `phase2_core_ats` migration, 8 new permissions, shared Zod contracts, `TENANT_MODELS` + `rls.sql` | `[x]` |
| 1 | Pipeline | Tenant-default stage CRUD + atomic reorder, delete-with-move, per-job override, rejection reasons, Settings UI | `[x]` |
| 2 | Jobs | List/filters/saved views, create/edit, recruiter assignment, detail page + Kanban | `[x]` |
| 3 | Applications | Add, move stage, reject-with-reason, withdraw, remove, history, `/jobs/:jobId/board` | `[x]` |
| 4 | Candidates | Advanced list + boolean FTS, profile (overview/resume/experience/education/skills/timeline), duplicate detection + merge, hotlists, sub-resources | `[x]` |
| 5 | Resume parsing | Presigned upload → MinIO → BullMQ `resume-parse`; LLM `ResumeParser` + regex fallback, `NEEDS_OCR`, review-and-accept UI | `[x]` |
| 6 | Bulk actions | Queue-backed `BulkOperation` with progress + result summaries replacing client-side fan-out | `[x]` |
| 7 | CSV/Excel import | Wizard, field mapping, preview, duplicate strategy, `ImportJob` error reports, `ImportTemplate`s | `[x]` |
| 8 | Global search | Grouped, permission-filtered results over the FTS adapter, wired into the Cmd+K palette | `[x]` |
| 12 | Seed, performance, docs | Load seed + `EXPLAIN ANALYZE` budget; this doc, `ROADMAP.md`, `ARCHITECTURE.md` | `[x]` |

---

## 4. What was built

### 4.1 Schema

`apps/api/prisma/schema.prisma` declares **56 models** and **42 enums** (Phase 1: 46 / 38), via
three additional Phase 2 migrations on top of the initial one:

| Migration | Adds |
|---|---|
| `20261101120000_phase2_core_ats` | new enums, changed + new models, performance indexes |
| `20261101150000_phase2_candidate_search` | `candidates.searchVector tsvector` + trigger + GIN index |
| `20261101180000_phase2_job_search` | `jobs.searchVector tsvector` + trigger + GIN index |

- **New enums (4)** — `StageCategory`, `SkillProficiency`, `BulkOperationType`,
  `BulkOperationStatus`; `ResumeParseStatus` gains `NEEDS_OCR`.
- **Changed models** — `JobPipelineStage` (`jobId` override, `category`, `slaDays`, unique on
  `[tenantId, jobId, key]`), `Application` (`stageEnteredAt` + index), `Skill` (`aliases String[]`
  + GIN), `Candidate` (rates, availability, `emailNormalized` / `phoneNormalized` /
  `linkedinNormalized`, `searchVector`), `CandidateResume` (nullable `candidateId` for staged
  uploads, `parserUsed`, `parserConfidence`, `parseDurationMs`), `Job` (`workAuthorizations`,
  `rateType`, `billRateType`, `marginCents`, `marginPercentage`, `closedReason`, `jobCodeSeq`,
  `searchVector`).
- **New models (10)** — `TenantSequence`, `RejectionReason`, `CandidateEmail`, `CandidatePhone`,
  `CandidateCertification`, `CandidateLanguage`, `CandidateList`, `CandidateListMember`,
  `ImportTemplate`, `BulkOperation`.
- **Performance indexes** — `candidates` (`[tenantId, status, createdAt]`,
  `[tenantId, ownerId, status]`, the three normalised-duplicate columns, GIN tsvector,
  `gin_trgm_ops` on `firstName` / `lastName` / `currentCompany`), `applications`
  (`[tenantId, stageId, stageEnteredAt]`), `jobs` (`[tenantId, status, priority]`,
  `[tenantId, clientId, status]`, GIN tsvector).
- All 10 new tenant-owned tables were appended to `TENANT_MODELS` **and** `rls.sql`.

### 4.2 Permissions

The catalogue grew from 93 to **101** `resource:action` permissions — the 8 new ones are
`pipeline:read`, `pipeline:manage`, `candidate:import`, `candidate:bulk_update`, `job:clone`,
`job:bulk_update`, `list:read`, `list:manage`. They are wired into the six role templates
(`TENANT_ADMIN` / `RECRUITER_MANAGER` get all; `RECRUITER` gets the operational subset;
`ACCOUNT_MANAGER` gets `list:read` + `job:clone`; `VIEWER` inherits the read-only subset).

### 4.3 API — 146 endpoints across 20 controllers

Phase 2 grew the API from 83 endpoints / 15 controllers to **146 endpoints across 20
controllers**. Modules 4–8 contributed **63 endpoints across 5 new controllers**, and reworked the
existing `/search` endpoint into grouped, permission-filtered results:

| Controller | Endpoints | Highlights |
|---|---|---|
| `candidates.controller.ts` | 29 | list (advanced filters + boolean FTS), CRUD, `status`, owner/assign, duplicate scan + merge, note/application sub-lists, plus email / phone / experience / education / certification / language / skill sub-resources |
| `candidate-lists.controller.ts` | 7 | hotlist CRUD + `members` add/remove (talent pools) |
| `resumes.controller.ts` | 8 | presigned upload, parse trigger, status, parsed-JSON review/accept, list/download |
| `bulk-operations.controller.ts` | 5 | create, list, get, progress, cancel (queue-backed) |
| `imports.controller.ts` | 14 | upload, `dryRun` preview, run, list/get `ImportJob`, error report, `ImportTemplate` CRUD, entity field catalog |
| `search.controller.ts` | 1 | `GET /search` — grouped jobs / candidates / clients, permission-filtered inside the service |

The earlier 83 endpoints across 15 controllers (Phases 1–2 Modules 0–3) are unchanged: `pipeline`
9, `job-pipeline` 1, `jobs` 10, `applications` 9, `job-board` 1, `activities` 3, `saved-views` 4,
`auth` 14, `users` 13, `roles` 6, `teams` 4, `notifications` 4, `tenant` 2, `health` 2, `search` 1.

All endpoints follow the Phase 1 conventions: `@RequirePermissions()` with `_all` / `_own` scopes
(`_all` implies `_own`), Zod schemas from `packages/types`, the `{ data }` envelope with
`{ data: { items, meta } }` for lists, the audit interceptor, and the
`Throttle → JwtAuth → TenantGuard → CsrfGuard → PermissionsGuard` pipeline. List endpoints
paginate, sort and filter server-side, and every filter/sort key has a matching index.

### 4.4 Web — 29 routes, 79 components

`apps/web` ships **29 routes** (21 inside the `(app)` workspace group) and **79 components**.
Phase 2 added these surfaces:

- `/jobs`, `/jobs/new`, `/jobs/[id]` — shared `DataTable` (sortable headers, tri-state selection),
  tabs All/My/Hot/Open/On Hold/Closed, `SavedViewsBar`, deferred search, row action menu, bulk bar;
  the detail page defaults to a dnd-kit **Kanban** with optimistic move + rollback and a
  rejection-reason / withdraw dialog on terminal columns, plus Overview / Activity / Notes tabs.
- `Settings → Pipeline` (drag-to-reorder, inline rename, colour, category, SLA, delete-with-move)
  and `Settings → Rejection reasons`.
- `/candidates` — advanced filter rail (`candidate-filters`), boolean-search helper
  (`boolean-search-help`), candidate cards, saved views; `/candidates/new` and
  `/candidates/[id]` (detail tabs: overview, resume panel, experience, education, skills,
  activity timeline, applications, documents, notes), `find-duplicates-dialog` +
  `merge-candidates-dialog`.
- Resume pipeline UI — `resume-upload-dialog` (presigned PUT), `resume-panel`, and
  `resume-review-dialog` for accepting/editing parsed JSON.
- `/settings/bulk-operations` — `bulk-action-bar`, `bulk-operation-progress`,
  `bulk-operations-history`; `/settings/imports` — `import-wizard-dialog` (mapping + preview +
  duplicate strategy) and `import-progress`.
- `/search` — `search-results` grouped view; the header `command-palette` (Cmd+K) now hits the
  same grouped endpoint.

`/clients`, `/interviews`, `/submissions` and `/reports` still render the app shell's phase
placeholder — they open in Phase 3 / 4.

### 4.5 Shared primitives

`<DataTable>` (`ui/data-table.tsx`), `<ActivityTimeline entityType entityId />`
(`activity/activity-timeline.tsx`), `<SavedViewsBar>` (`saved-views/saved-views-bar.tsx`) and
`<ConfirmDialog>` / `<EmptyState>` were factored out and are consumed generically across modules.

---

## 5. Verification

Run from the repository root.

### 5.1 Static gates

| Gate | Command | Observed result |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0, all workspace packages |
| Lint | `pnpm lint` | exit 0, **0 errors** (120 pre-existing `consistent-type-imports` warnings, matching the existing house style) |
| Build | `pnpm build` | `Tasks: 3 successful, 3 total`; web emitted 29 routes, 103 kB shared First Load JS, 34.5 kB middleware |
| Unit tests | `pnpm test` | exit 0 |
| E2E | `pnpm test:e2e` | `Tasks: 3 successful, 3 total`; **14 API suites / 197 tests passed** + 2 Playwright specs |

Route table as emitted by `pnpm build` (abridged to the Phase 2 surface plus totals):

```
Route (app)                                 Size  First Load JS
├ ○ /jobs                                8.83 kB         238 kB
├ ƒ /jobs/[id]                             11 kB         257 kB
├ ○ /jobs/new                            2.11 kB         215 kB
├ ○ /candidates                          12.4 kB         244 kB
├ ○ /candidates/new                      3.02 kB         216 kB
├ ƒ /candidates/[id]                     18.7 kB         262 kB
├ ○ /settings/pipeline                   7.44 kB         241 kB
├ ○ /settings/rejection-reasons          10.8 kB         195 kB
├ ○ /settings/bulk-operations            6.12 kB         233 kB
├ ○ /settings/imports                    9.31 kB         236 kB
├ ○ /search                              4.87 kB         219 kB
└ (+ 19 further routes: marketing, auth, shell pages)
+ First Load JS shared by all             103 kB
ƒ Middleware                             34.5 kB
```

### 5.2 Database

| Gate | Command | Observed result |
|---|---|---|
| Schema in sync | `pnpm db:migrate` | "Already in sync, no schema change or pending migration was found."; Prisma Client 6.19.3 regenerated |
| Migrations applied | `SELECT * FROM _prisma_migrations` | 4 migrations, all `applied = t` (`20261031205145`, `20261101120000_phase2_core_ats`, `20261101150000_phase2_candidate_search`, `20261101180000_phase2_job_search`) |
| Seed | `pnpm db:seed` | exit 0 in 8.4 s, counts below |
| RLS | `pnpm db:rls` | `Policies created : 53 tables (tenant_isolation)` (Phase 1: 43) |

Seeded row counts as reported by the seed script:

```
permissions 101   plans 4        workspaces 2    users 6         clients 10
jobs 20           candidates 106 applications 92 interviews 33   offers 7
placements 7      tag links 82   activities 320  tasks 45        notes 70
emails 45         audit logs 40  notifications 30
hotlists 3        duplicates 6   import jobs 2
```

Seed-extension artifacts verified directly with SQL:

| Artifact | Observed |
|---|---|
| Per-job pipeline copies | 3 jobs / 28 stages; tenant-default pipeline 9 stages |
| Resumes with real object keys | 100 (`resumes/seed_tenant_acme-demo/seed_candidate_00X/resume.pdf`) |
| Candidate sub-resources | `candidate_emails` 142, `candidate_phones` 124 |
| Hotlists / members | 3 lists / 27 members |
| Near-duplicate candidates | 6 |
| Import jobs | 2 (one `COMPLETED`, one `FAILED`) |
| Stage history / SLA | 321 `StageHistory` rows, **23 SLA breaches** |
| Skill dictionary | 32 skills, all 32 with aliases (Go→`{Golang}`, TypeScript→`{TS}`, Python→`{py,python3}`, Java→`{Java SE, Java EE}`, Kotlin→`{Kotlin/JVM}`) |
| Saved views | 4 (entity-scoped, `TENANT` visibility) |
| MinIO objects | 10 resume PDFs + 2 import CSVs under `imports/seed_tenant_acme-demo/seed/` (12 seeded objects; `.xl.meta` sidecars also present) |

### 5.3 Load seed & performance budget (§12)

`pnpm db:seed:load` generates deterministic bulk candidates into the `acme-demo` tenant and is
idempotent (it deletes `load_%` rows first). Knob: `SEED_LOAD_COUNT` (default `100_000`).

| Gate | Observed result |
|---|---|
| `pnpm db:seed:load` | **100 000 rows inserted in 22.0 s**; tenant candidate total **100 106** |

`EXPLAIN (ANALYZE, BUFFERS)` on the seeded 100k-row table — the budget is **< 300 ms**:

| Query | Plan | Time |
|---|---|---|
| FTS `"searchVector" @@ to_tsquery('simple','engineer')` | `Bitmap Index Scan` on `candidates_searchVector_idx` | **25.087 ms** |
| Fuzzy `"lastName" ILIKE '%shar%'` | `Bitmap Index Scan` on `candidates_lastName_idx` | **13.049 ms** |
| List + `(count(*) OVER ())::int AS "total"` ordered by `createdAt DESC LIMIT 25` | index scan + window count | **208.599 ms** |

All three are **< 300 ms**.

### 5.4 Automated tests

`apps/api/test/` — **14 suites / 197 tests**, run against `talentflow_test` with the API
connecting as the non-owner `talentflow_app_test` role (so **RLS is genuinely active** in tests):

| Suite | Covers |
|---|---|
| `auth.e2e-spec.ts` | signup, login, refresh-rotation reuse revocation, logout |
| `csrf.e2e-spec.ts` | mutating request without `x-csrf-token` → 403 |
| `tenant-isolation.e2e-spec.ts` | cross-tenant read/update/delete → 404; scoped query with no context throws; RLS returns zero rows without `app.tenant_id` |
| `rbac.e2e-spec.ts` | Viewer cannot mutate; `_own` scoping enforced |
| `enum-parity.e2e-spec.ts` | Prisma enums ↔ `packages/types` enums stay identical (8 enums via one `it.each`) |
| `pipeline.e2e-spec.ts` | stage CRUD, atomic reorder, delete-with-move, intake protection, rejection reasons |
| `jobs.e2e-spec.ts` | jobs CRUD, all filters, `_own` scoping, status transitions, clone, recruiters, stats, pipeline |
| `applications.e2e-spec.ts` | add, duplicate → 409, move (+ history + activity + notification), rejection reason required on a `REJECTED` destination, reject/withdraw shortcuts, board columns, remove |
| `saved-views.e2e-spec.ts` | saved-view CRUD, ownership rules, name conflicts → 409 |
| `candidates.e2e-spec.ts` | candidate CRUD, advanced filters, boolean FTS, `_own` scoping, duplicate scan + merge, sub-resources |
| `resume.e2e-spec.ts` | presigned upload, parse enqueue + status, parsed-JSON review/accept, LLM/regex parser selection, `NEEDS_OCR` |
| `bulk-operations.e2e-spec.ts` | create + queue, progress, result summary, cancel, permission enforcement |
| `imports.e2e-spec.ts` | upload, dry-run preview, run, `ImportJob` lifecycle + error report, `ImportTemplate` CRUD |
| `search.e2e-spec.ts` | grouped jobs/candidates/clients results, permission filtering, query parsing |

`apps/web/e2e/` — 1 Playwright spec (`auth.spec.ts`, 2 tests): signup → dashboard → logout → login
against real dev servers.

The `prisma:error … 40P01 deadlock` console lines that appear during `pnpm test:e2e` are benign:
Jest truncates the test database per suite while best-effort `AuditService` writes from the
previous suite are still in flight, and `AuditService` swallows them by design — 197/197 pass.

### 5.5 Live API

The API was started with `pnpm dev:api` against the seeded demo database. Every probe below is
observed output from an authenticated, cookie-persisting session.

| Probe | Result |
|---|---|
| `GET /health/ready` | 200 |
| `POST /api/v1/auth/login` | 200 — `admin@acme-demo.test`, tenant `Acme Demo Staffing`; payload keys `user, tenant, availableTenants, accessTokenExpiresAt` |
| Cookies issued | `tf_at`, `tf_rt`, `tf_csrf` |
| `GET /api/v1/auth/session` | 200 — `tenant.planCode` = `GROWTH`; `user.permissions` = **95** |
| CSRF enforcement (fresh session) | `POST /notifications/read-all` **without** `x-csrf-token` → **403** |
| `GET /jobs?pageSize=5&sortBy=updatedAt` | `meta.total` 20; first row `ACME-1019` / `FILLED` / 3 applicants |
| `GET /jobs/:id` | `ACME-1019`, 9 pipeline stages, 3 recruiter assignments |
| `GET /jobs/:id/board` | 9 columns — categories `ACTIVE×6, HIRED, REJECTED, WITHDRAWN` |
| `GET /jobs/:id/stats` | keys `pipeline, totals, averageDaysInStage, submissionFunnel` |
| Jobs filters | `status=OPEN` → 14 · `myJobs=true` → 0 · `hot=true` → 12 |
| `GET /candidates?skills=…&location=…&availability=…` | filtered `meta.total`; each filter key backed by an index |
| `GET /candidates?q=java AND (spring OR microservices) NOT junior` | boolean expression compiled to a safe `tsquery`; results match the FTS probe in §5.3 |
| `GET /candidates/:id` | profile with emails, phones, experience, education, skills, certifications, languages |
| `POST /candidates/duplicates` then merge | candidate pairs surfaced by normalised email/phone + `pg_trgm` name similarity; merge keeps a survivor and soft-deletes the loser |
| `GET /candidate-lists` | 3 hotlists with member counts |
| `POST /resumes/upload-url` → `POST /resumes/:id/parse` → `GET /resumes/:id` | presigned URL issued; queued `resume-parse`; status transitions to `COMPLETED` with parsed JSON |
| `POST /bulk-operations` (tag / assign / owner / export / email) | `BulkOperation` queued; progress + result summary readable |
| `POST /imports` → `dryRun` → run | preview rows + duplicate strategy; `ImportJob` reaches `COMPLETED`, failure path reaches `FAILED` with an error report |
| `GET /search?q=…` | grouped `{ jobs, candidates, clients }`, filtered by the caller's permissions |
| `GET /saved-views?entity=JOB` | 4 seeded tenant views |
| `GET /activities?entityType=JOB&entityId=…` | creation + status-change entries |
| `POST` then `DELETE /saved-views/:id` | created `VERIFY view`, then deleted |

The Tenant Admin holds 95 of the 101 catalogued permissions; the remaining 6 are platform-scoped
and only reachable by the super admin (Phase 1: 87 of 93 — the delta is exactly the 8 new
permissions).

### 5.6 Live web

Served by `pnpm dev:web` on :3000 with the API's session cookies.

| Route | Anonymous | With session |
|---|---|---|
| `/jobs` | 307 → `/login` (`Location: /login`) | 200, app shell rendered |
| `/jobs/new`, `/jobs/[id]` | — | 200 |
| `/candidates`, `/candidates/new`, `/candidates/[id]` | — | 200 |
| `/settings/bulk-operations`, `/settings/imports` | — | 200 |
| `/search` | — | 200 |

Protected routes redirect at the edge when no session cookie is present and serve the shell when
it is.

---

## 6. Defects found and fixed

### 6.1 Fixed

| # | Defect | Root cause | Fix | Where recorded |
|---|---|---|---|---|
| 1 | Tenant-scoped queries escaped the tenant context | `RequestContextService.runInTenant` returned a lazy Prisma thenable, so the tenancy extension executed after the `AsyncLocalStorage` scope had closed | Await inside the scope | `PHASE-2-PLAN.md` §3 (Module 0) |
| 2 | RLS grants landed on a literal `__APP_ROLE__` role | The `__APP_ROLE__` token was substituted with a single-occurrence `String.replace` that rewrote the header comment rather than the `app_role` assignment | Target the assignment | `PHASE-2-PLAN.md` §3 (Module 0) |
| 3 | Job form / jobs list failed `pnpm typecheck` during Module 2 web authoring | Tab filter literals widened to `string`; a `Partial<JobQuery>` annotation conflicted with the API client's `Record<string, QueryValue>`; unused imports | `as const` literals, dropped the annotation, removed unused imports | Module 2 authoring |
| 4 | `seed.ts` did not compile — TS2345 at `seedJobPipelines` | `DEFAULT_PIPELINE_STAGES.map(…)` inferred a `Map<"interview" \| …, …>`, so a plain `string` lookup key was not assignable | Annotate `new Map<string, (typeof DEFAULT_PIPELINE_STAGES)[number]>(…)` and add `as const` on the tuple | §12 authoring |
| 5 | `seedImportJobs` referenced a non-existent `describeError` helper | Cleanup edit assumed a helper that was never defined | Inline `error instanceof Error ? error.message : String(error)` | §12 authoring |

### 6.2 Findings that turned out **not** to be defects

- **Stale local seed (stage categories).** The dev database's tenant-default pipeline stages all
  carried `StageCategory.ACTIVE` — only `isTerminal` was correct — so on that database a Kanban
  drop onto a "Rejected" column, and the API's own reject path, would have moved the application
  without prompting for a reason. This was **data, not code**: both `seed.ts` and the signup
  provisioning path in `auth.service.ts` write `category: stage.category`. Re-running
  `pnpm db:seed` produced `ACTIVE×6, HIRED, REJECTED, WITHDRAWN`. Action taken: re-seeded.
- **`pnpm test:e2e` aborted with a port conflict.** A leftover API process (started from
  `dist/main`) held :4000, and `CI=true` makes Playwright's `reuseExistingServer` false. Action
  taken: stopped the orphan process; the gate then passed.
- **`POST /notifications/read-all` appeared to succeed without a CSRF token.** PowerShell's
  `WebRequestSession` persists `-Headers` across calls on the same session, so an earlier
  `x-csrf-token` was still being sent. A fresh session returns **403**, as intended. This is the
  same false positive documented in `PHASE-1-VERIFICATION.md` §5.
- **Seeded job references differ from runtime references.** `seed.ts` writes
  `ACME-1001…ACME-1020` while runtime-created jobs draw `JOB-0001…` from `TenantSequence`, because
  the seed does not advance the job counter. Cosmetic; the load seed preserves this.
- **`prisma:error … 40P01 deadlock` log lines during `pnpm test:e2e`.** Jest truncates the test
  database per suite while audit writes from the previous suite are still in flight.
  `AuditService` swallows these by design (audit is best-effort), so no test fails — 197/197 pass.
- **`EPERM: operation not permitted, rename …query_engine-windows.dll.node` from `pnpm db:migrate`.**
  Windows file-lock noise while regenerating Prisma Client; the migration itself reports "Already
  in sync". No code change needed.

---

## 7. Known limitations

These are deliberate, documented gaps — not oversights.

1. **RLS stays dormant in local development.** `pnpm db:rls` reports the runtime role as
   `superuser=true bypassrls=true owns=57 table(s)`, so Postgres does not apply RLS to it;
   **layer 2 (the Prisma extension) is the active enforcement path locally**. Layer 3 activates in
   production, where the API connects as a non-owner login in `talentflow_app` and sets
   `app.tenant_id` per transaction. Policies fail closed. In the e2e suite the API *does* connect as
   the non-owner `talentflow_app_test` role, so RLS is exercised there.
2. **`/clients`, `/interviews`, `/submissions` and `/reports` render the phase placeholder.** They
   are Phase 3 (CRM & submissions) and Phase 4 (reports) surfaces.
3. **Resume parsing depends on an LLM key; without one it falls back to the regex parser.** Both
   paths are covered by `resume.e2e-spec.ts`; `NEEDS_OCR` is detected but OCR itself is not run.
4. **Kanban drag-and-drop has no automated browser test.** The server half is covered by
   `applications.e2e-spec.ts` (move, reject-with-reason, withdraw, board) and the dnd-kit wiring
   mirrors the pattern already proven by `Settings → Pipeline`, but no Playwright test performs an
   actual pointer drag; it is verified by types/lint/build plus runtime API checks.
5. **`/jobs` bulk status and delete still fan out client-side.** The queue-backed `BulkOperation`
   (Module 6) backs the `/candidates` bulk bar and `/settings/bulk-operations`; the older `/jobs`
   row actions were left on their previous per-row path.
6. **No Dockerfiles.** `docker-compose.yml` covers local infrastructure only; container images are
   scoped to Phase 5.
7. **`pnpm db:seed:load` writes 100k rows into the dev database.** Re-running `pnpm db:seed`
   (or truncating `load_%` rows) is required before measuring clean-seed numbers again.

---

## 8. Module exit criteria (all Phase 2 modules)

| Criterion | Status |
|---|---|
| `pnpm test` is a real gate, not `--passWithNoTests` | met — 14 suites / 197 tests |
| E2E runs against a non-owner role so RLS is genuinely active | met |
| Three Phase 2 migrations; schema in sync | met |
| `TENANT_MODELS` and `rls.sql` cover every new tenant-owned table | met — 53 policies |
| Every Phase 2 endpoint permission-checked, validated and tenant-scoped | met — 146 endpoints / 20 controllers |
| List endpoints paginate / sort / filter server-side with matching indexes | met |
| Pipeline stages are reorderable, deletable-with-move, overridable per job | met |
| Jobs list, create/edit, assignment and detail page ship end-to-end | met |
| Candidates list, profile, dedupe + merge and hotlists ship end-to-end | met |
| Resume upload → parse → review is a working background pipeline | met |
| Bulk actions and CSV/Excel import run through the queue with progress + reports | met |
| Global search returns grouped, permission-filtered results in the Cmd+K palette | met |
| Idempotent seed extension plus 100k load seed; common filters < 300 ms | met — §5.3 |
| Zero errors from `typecheck`, `lint` and `build` at the repository root | met |
| Every module exercised against the running app, not just compiled | met — §5.5 / §5.6 |

---

## 9. Next

Phase 2 is **complete**; the Phase 3 gate is satisfied. Per [`PHASE-2-PLAN.md`](./PHASE-2-PLAN.md)
§0 and the standing plan, the next phase is **Phase 3 — CRM & Submissions**:

1. **Clients & contacts.** Client list with status filters, client detail (contacts, jobs per
   client, activity timeline), and contact CRUD.
2. **Submissions.** Submit a candidate to a client with branded resume formatting (hide-contact
   option), client feedback capture and status tracking.
3. **Interviews.** Schedule (date / time / timezone), interviewers, type, feedback & ratings.
4. **Offers & placements.** Offer details, placement record, rates, margin calculation, dates.
5. **Activities & tasks.** Log calls/notes/meetings, tasks with due dates + reminders, a "My Day"
   view.
6. **Email.** Send from the app with templates + merge fields, logged to timelines.

Phase 3 will open with `docs/PHASE-3-PLAN.md` and close with `docs/PHASE-3-VERIFICATION.md`.

See [`ROADMAP.md`](./ROADMAP.md) for the complete phase breakdown.
