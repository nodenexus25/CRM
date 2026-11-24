# TalentFlow — Phase 2 Plan (Core ATS)

Status: **in progress** · owner: full-stack · depends on: Phase 1 (verified)

This document is the working plan for Phase 2. It lists the modules, the schema changes,
the new permissions, the endpoints, the pages and the order of work. It is updated as the
phase progresses. Everything here obeys the Phase 1 conventions (three-layer tenancy, Zod
schemas from `packages/types`, the error envelope, audit, CSRF, cookie auth).

Legend: `[x]` done · `[~]` in progress · `[ ]` pending

---

## 0. Order of work

1. **Module 0 — test harness** (Phase 1 gap). Without it nothing else is trustworthy.
2. **Foundation** — schema, permissions, shared types (prerequisite for 1–8).
3. **Module 1 — pipeline stages + rejection reasons**.
4. **Module 2 — jobs** (list, create/edit, detail, Kanban).
5. **Module 3 — applications** (stage moves, history, activity).
6. **Module 4 — candidates** (list, profile, duplicates, merge, hotlists).
7. **Module 5 — resume parsing** (queue, `ResumeParser`, review UI, skill dictionary).
8. **Module 6 — bulk actions**.
9. **Module 7 — CSV/Excel import**.
10. **Module 8 — global search + command palette**.
11. **Seed updates, performance indexes, verification.**

After every module: `pnpm typecheck && pnpm lint && pnpm test`, then exercise the module
against the running app.

---

## 1. Schema changes (one migration: `phase2_core_ats`)

### 1.1 New enums
| Enum | Members |
|---|---|
| `StageCategory` | `ACTIVE`, `HIRED`, `REJECTED`, `WITHDRAWN` |
| `SkillProficiency` | `BASIC`, `CONVERSATIONAL`, `PROFESSIONAL`, `NATIVE` |
| `BulkOperationType` | `CANDIDATE_TAGS`, `CANDIDATE_OWNER`, `CANDIDATE_STATUS`, `CANDIDATE_ADD_TO_JOB`, `CANDIDATE_ADD_TO_LIST`, `CANDIDATE_DELETE`, `CANDIDATE_EXPORT`, `JOB_STATUS`, `JOB_PRIORITY`, `JOB_ASSIGN_RECRUITERS` |
| `BulkOperationStatus` | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` |

`ResumeParseStatus` gains `NEEDS_OCR`. `ImportEntityType` unchanged.

### 1.2 Changed models
- **`JobPipelineStage`** — add `jobId String?` (per-job override; `null` = tenant default),
  `category StageCategory @default(ACTIVE)`, `slaDays Int?`. Uniqueness becomes
  `@@unique([tenantId, jobId, key])` (partial-null handled in app logic), index
  `[tenantId, jobId, order]`.
- **`Application`** — add `stageEnteredAt DateTime @default(now())` (powers days-in-stage /
  SLA), index `[tenantId, stageId, stageEnteredAt]`.
- **`Skill`** — add `aliases String[] @default([])`; GIN index for alias lookup.
- **`Candidate`** — add `workAuthorizationExpiresAt DateTime?`, `expectedRateCents Int?`,
  `currentRateCents Int?`, `ratePeriod String?`, `rateCurrency String?`,
  `availabilityDate DateTime?`. Add `dedupeEmailKey/ dedupePhoneKey / dedupeLinkedinKey`
  are derived; keep the single `dedupeKey` + new `emailNormalized`, `phoneNormalized`,
  `linkedinNormalized` columns (indexed) for O(1) exact-duplicate detection.
- **`CandidateResume`** — `candidateId` becomes **nullable** (staging upload before the
  candidate exists); add `parserUsed String?`, `parserConfidence Float?`,
  `parseDurationMs Int?`, `deletedAt` already present.
- **`Job`** — add `workAuthorizations WorkAuthorization[] @default([])`, `rateType String?`
  (`HOURLY|DAILY|MONTHLY|ANNUAL`), `billRateType String?`, `marginCents Int?`,
  `marginPercentage Decimal? @db.Decimal(6,2)`, `closedReason String?`,
  `jobCodeSeq Int?` (sequence value backing `JOB-0001`).
- **`SavedSearch`** — already supports entity/columns/sort/filters/visibility; reused as
  "Saved views". No change.

### 1.3 New models (all tenant-scoped)
| Model | Purpose | Key fields |
|---|---|---|
| `TenantSequence` | concurrency-safe per-tenant counters | `key`, `value`; `@@unique([tenantId, key])` |
| `RejectionReason` | configurable rejection reasons | `label`, `key`, `order`, `isActive`, `isSystem` |
| `CandidateEmail` | multiple emails, one primary | `address`, `isPrimary`, `label` |
| `CandidatePhone` | multiple phones, E.164 + one primary | `number`, `isPrimary`, `label` |
| `CandidateCertification` | certifications | `name`, `issuer`, `issuedAt`, `expiresAt`, `credentialId`, `credentialUrl` |
| `CandidateLanguage` | languages | `name`, `proficiency` |
| `CandidateList` | hotlists / talent pools | `name`, `description`, `visibility`, `ownerId` |
| `CandidateListMember` | list membership | `@@id([listId, candidateId])` |
| `ImportTemplate` | reusable import mappings | `entity`, `name`, `mapping`, `options` |
| `BulkOperation` | background bulk-action progress | `type`, `status`, `selection`, `payload`, counters, `errors` |

Tenant-owned tables added above are appended to `TENANT_MODELS` **and** `rls.sql`.

### 1.4 Indexes for the 100k-row performance target
- `candidates`: `[tenantId, status, createdAt]`, `[tenantId, ownerId, status]`,
  `[tenantId, emailNormalized]`, `[tenantId, phoneNormalized]`,
  `[tenantId, linkedinNormalized]`, GIN on `to_tsvector('simple', ...)` (name/title/company/
  resume text) and `gin_trgm_ops` on `firstName`, `lastName`.
- `applications`: `[tenantId, jobId, stageId, boardOrder]` (exists), `[tenantId, stageId, stageEnteredAt]`.
- `jobs`: `[tenantId, status, priority]`, `[tenantId, clientId, status]`, GIN tsvector.

---

## 2. New permissions (added to the catalog + six role templates)

- `pipeline:read`, `pipeline:manage` (stages + rejection reasons).
- `candidate:import`, `candidate:bulk_update`.
- `job:clone`, `job:bulk_update`.
- `list:read`, `list:manage` (hotlists / talent pools).
- Existing `candidate:merge`, `candidate:export`, `import:create`, `export:create`,
  `saved_search:manage` are reused.

Templates: `TENANT_ADMIN`/`RECRUITER_MANAGER` get everything; `RECRUITER` gets
`pipeline:read`, `candidate:import`, `candidate:bulk_update`, `job:clone`, `job:bulk_update`,
`list:read`, `list:manage`; `ACCOUNT_MANAGER` gets `list:read`, `job:clone`; `VIEWER` gets
the read-only subset automatically.

---

## 3. Module 0 — test harness  `[x]`

- `apps/api/test/` — Jest config `test/jest-e2e.json`; `supertest` against the Nest app with a
  **separate** database (`talentflow_test`), migrated + truncated per suite.
- Docker init script creates a **non-owner, NOBYPASSRLS** role `talentflow_app_test`; e2e tests
  connect as that role with `SET app.tenant_id` so **RLS is genuinely active**. A `PrismaService`
  test override issues `select set_config('app.tenant_id', $1, true)` per transaction.
- Factories: `tenant`, `user`, `role`, `client`, `job`, `candidate`, `application`.
- Tests: auth (signup/login/refresh-reuse-revokes-family/logout), CSRF (mutating without
  header → 403), tenant isolation (A cannot read/update/delete B by id → 404; scoped query
  without context throws; RLS returns zero rows with no `app.tenant_id`), RBAC (Viewer
  cannot mutate; Recruiter `_own` enforced).
- Playwright `apps/web/e2e/auth.spec.ts`: signup → dashboard → logout → login. Root
  `pnpm test:e2e`.

Root scripts: `pnpm test` (turbo), `pnpm test:e2e` (turbo).

**Done.** 5 suites / 44 assertions green (`auth`, `csrf`, `tenant-isolation`, `rbac`,
`enum-parity`) plus 2 Playwright specs. Two product bugs were found and fixed along the way:
`RequestContextService.runInTenant` returned a lazy Prisma thenable so the tenancy extension
ran after the `AsyncLocalStorage` scope had closed; and the `__APP_ROLE__` token in `rls.sql`
was replaced with a single-occurrence `String.replace` that rewrote the header comment
instead of the `app_role` assignment, so RLS grants landed on a literal `__APP_ROLE__` role.

---

## 4. Module 1 — pipeline stages + rejection reasons  `[x]`

**API** (`/pipeline`)
- `GET /stages`, `POST /stages`, `PATCH /stages/:id`, `PUT /stages/reorder`
  (single transactional endpoint), `DELETE /stages/:id?moveToStageId=`.
- `GET /rejection-reasons`, `POST`, `PATCH`, `DELETE` (tenant editor).
- `PUT /jobs/:id/stages` — per-job override (copies tenant stages on job creation).
- Delete blocked when in use unless a target stage is supplied (then applications move).

**Web** — Settings → Pipeline: dnd-kit drag-to-reorder, inline rename, colour picker,
category select, SLA, delete with "move candidates to…" dialog. Settings → Rejection reasons.

**Done.** Tenant-default stage CRUD with an atomic reorder, delete-with-move (409 without a
destination; applications move + a `StageHistory` row is written + the stage is soft-deleted),
intake-stage protection, per-job materialisation/override (`PUT /jobs/:id/stages` resolves stage
identity by id-then-key so a client can send ids it just read or keys it never fetched), and the
`RejectionReason` catalogue (system reasons are undeletable but deactivatable). Web surface ships
as Settings → Pipeline (dnd-kit editor, keyboard sensor) and Settings → Rejection reasons.
Verified by `apps/api/test/pipeline.e2e-spec.ts` (25 tests) plus the repo gates
`pnpm typecheck && pnpm lint && pnpm test`.

---

## 5. Module 2 — jobs  `[x]`

**API** (`/jobs`)
- `GET /jobs` — filters: status, priority, jobType, remoteType, clientId, recruiterId,
  ownerId, location, skillIds, created/due ranges, `myJobs`, `hot`, `q` (FTS); server-side
  pagination/sort.
- `POST /jobs`, `GET /jobs/:id`, `PATCH /jobs/:id`, `DELETE /jobs/:id`.
- `POST /jobs/:id/clone`, `POST /jobs/:id/status` (validated transitions),
  `PUT /jobs/:id/recruiters` (notify assignees), `GET /jobs/:id/stats`.
- `JOB-0001` codes from `TenantSequence` inside a transaction.
- `GET /jobs/:id/pipeline` returns the job's effective stages.

**Web** — `/jobs` (DataTable, tabs All/My/Hot/Open/On Hold/Closed, saved views, bulk bar),
`/jobs/new`, `/jobs/[id]` (Pipeline Kanban default / Overview / Activity / Notes /
Attachments) with dnd-kit optimistic moves, rejection-reason dialog on REJECTED stages.

**Shared** — `<ActivityTimeline entityType entityId />`, `<SavedViewsBar>`, `<DataTable>`.

**Done.** The jobs API lists with every filter above (`_all`/`_own` scoping via
`hasPermission`, so a Recruiter sees only jobs they own or are assigned to), paginates and
sorts server-side and returns the flattened `JobListItem` shape the table consumes. Create,
read, update (soft delete) and `POST /jobs/:id/clone` all run through the same
`nextJobSequence` counter inside a transaction, so `JOB-0001`-style codes have no gaps under
concurrency. `POST /jobs/:id/status` validates against `JOB_STATUS_TRANSITIONS`;
`PUT /jobs/:id/recruiters` replaces the assignment set, diffs it and notifies only the newly
added assignees; `GET /jobs/:id/stats` and `GET /jobs/:id/pipeline` serve the detail page; the
Kanban reads `GET /jobs/:jobId/board` (one column per effective stage, capped per stage) which
shares its stage resolution with the applications module. Web ships `/jobs` (shared
`DataTable` with sortable headers and tri-state selection, tabs All/My/Hot/Open/On Hold/Closed,
`SavedViewsBar`, priority/job-type/remote selects, deferred search, row actions and a bulk
status/delete bar), `/jobs/new`, and `/jobs/[id]` with Pipeline (dnd-kit Kanban, fractional
`boardOrder`, optimistic move with rollback, keyboard sensor), Overview, Activity and Notes
tabs; dropping a card on a `REJECTED`/`WITHDRAWN` column opens the reason dialog instead of
moving blind. Three shared primitives were factored out for the later modules: `<DataTable>`,
`<ActivityTimeline>` and `<SavedViewsBar>`. Verified by `apps/api/test/jobs.e2e-spec.ts`,
`applications.e2e-spec.ts` and `saved-views.e2e-spec.ts` — 9 suites / 116 tests — plus the repo
gates `pnpm typecheck && pnpm lint && pnpm build && pnpm test` and `pnpm test:e2e`, and a live
run against the seeded demo tenant (list filters, create → patch → status → recruiters → clone →
delete, board columns, saved-view create/delete, best-effort bulk status/delete fan-out, activity
timeline). Deviations: the **Attachments tab** and the job form's client/contact/skill/owner
pickers are deferred (no clients or candidates API yet — they arrive with Module 4 and Phase 3);
the `/jobs` bulk bar fans out over the per-job endpoints with `Promise.allSettled` until Module 6
adds a real bulk endpoint. A stale local seed (predating `StageCategory` on the pipeline stages)
was re-seeded during verification — the seed and the signup path both write `category` correctly,
so no code change was needed.

---

## 6. Module 3 — applications

**API** (`/applications`) — add candidate(s), move stage (StageHistory + Activity +
notification + `stageEnteredAt`), bulk move, reject with reason, withdraw, remove, list per
job and per candidate. Duplicate active application blocked (DB unique + 409).
`_own` rule documented in ARCHITECTURE.md: a Recruiter with `candidates:update_own` may edit a
candidate only if they own it **or** it is on a job they are assigned to.

---

## 7. Module 4 — candidates

**API** (`/candidates`)
- `GET /candidates` — advanced filters + boolean FTS parser (`java AND (spring OR microservices)
  NOT junior`) compiled to a safe `tsquery`.
- CRUD, `POST /candidates/duplicates` (exact email/phone/LinkedIn + fuzzy name+company via
  `pg_trgm`), `POST /candidates/merge`, `PATCH /candidates/:id/owner`,
  `GET/POST /candidate-lists` (hotlists) + membership.
- Sub-resources: emails, phones, experiences, education, skills, certifications, languages.

**Web** — `/candidates` (DataTable, filter slide-out, boolean search help popover, saved
views, card toggle), `/candidates/new` (manual / single resume / bulk), `/candidates/[id]`
(Overview / Resume / Jobs / Activity / Notes / Tasks / Attachments / Audit), merge UI
side-by-side.

---

## 8. Module 5 — resume parsing

- Upload: presigned PUT → MinIO → `CandidateResume` (`PENDING`, `candidateId` null) →
  BullMQ `resume-parse`.
- Accept PDF, DOCX, DOC (best effort), TXT, RTF; ≤10 MB; MIME + magic-byte checks.
- `ResumeParser` interface; `llm` implementation (env `LLM_PROVIDER`/`LLM_API_KEY`/`LLM_MODEL`,
  strict Zod JSON, one retry, then regex), `regex` fallback. `NEEDS_OCR` when no text layer.
- Skill normalization against a seeded ~300-skill dictionary with aliases.
- Review-and-accept UI; polling progress endpoint. PII never logged.

---

## 9. Module 6 — bulk actions

Bulk tag / owner / status / add-to-job / add-to-list / export / delete (candidates); status /
priority / assign / export (jobs). Runs as a BullMQ job writing `BulkOperation`; progress +
result summary; "select all N matching" via filter-based selection; bulk email stubbed for
Phase 3.

---

## 10. Module 7 — import

Wizard: upload (papaparse / exceljs) → header detection → field mapping (auto-suggest, custom
fields, defaults, skip) → preview 20 rows with validation → duplicate strategy → run. BullMQ
`import` job writes `ImportJob`; downloadable error CSV; save mapping as `ImportTemplate`.
50k rows/file, 500-row transaction batches. Sample templates per entity.

---

## 11. Module 8 — global search

`/search` returns grouped, permission-filtered results (jobs, candidates, clients, contacts)
over the FTS adapter; Cmd+K palette + top-bar wired; recent searches/records; quick actions.

---

## 12. Seed, performance, docs

- Idempotent seed extension: per-job pipelines, stage histories with SLA breaches, multiple
  emails/phones, 10 generated PDF resumes in MinIO, skill dictionary with aliases, 3 saved
  views, 3 hotlists, near-duplicate candidates, one completed + one failed `ImportJob`.
- `pnpm db:seed:load` generates 100k candidates; verify common filters <300 ms with
  `EXPLAIN ANALYZE`.
- `docs/PHASE-2-VERIFICATION.md`, `ROADMAP.md`, `ARCHITECTURE.md` updated.
