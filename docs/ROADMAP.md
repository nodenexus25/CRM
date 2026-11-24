# TalentFlow — Roadmap

Legend: `[x]` done · `[~]` in progress · `[ ]` pending

---

## Phase 0 — Documentation & Scaffolding ✅
- [x] `docs/ARCHITECTURE.md`
- [x] `docs/ROADMAP.md`
- [x] Monorepo (pnpm workspaces + Turborepo)
- [x] `packages/config` (tsconfig, eslint, tailwind preset)
- [x] `packages/types` (Zod schemas, enums, shared types)
- [x] `packages/ui` (shared token-driven primitives)
- [x] `docker-compose.yml` (Postgres 16 + pgvector, Redis 7, MinIO, Mailpit)
- [x] `.env.example`

## Phase 1 — Foundation ✅
### Database
- [x] Full Prisma schema (40+ models, all relations + indexes)
- [x] Initial migration
- [x] `prisma/rls.sql` Row Level Security policies (2nd isolation layer)
- [x] Seed: 1 demo tenant, users of every role, 10 clients, 20 jobs, 100 candidates + related data

### API
- [x] Typed config module with Zod boot validation
- [x] Prisma service + tenant-scoping client extension (AsyncLocalStorage)
- [x] Health checks (`/health`, `/health/ready`)
- [x] Auth: signup (tenant+admin), login, refresh rotation, logout, verify email, forgot/reset password
- [x] JWT access/refresh in httpOnly cookies + CSRF double-submit
- [x] RBAC: roles, permissions, `@RequirePermissions` guard, Redis permission cache
- [x] Tenant guard + super-admin `X-Tenant-Id` impersonation (audited)
- [x] Audit log (interceptor + service), soft deletes, created/updated by
- [x] Global error envelope + Zod validation pipe
- [x] Helmet, CORS, Redis-backed rate limiting
- [x] Swagger/OpenAPI at `/api/docs`
- [x] Mailer (Nodemailer + templates) and BullMQ queue registry
- [x] S3/MinIO storage service
- [x] Notifications module (in-app)
- [x] Users, Roles, Teams, Tenant settings modules
- [x] Global search endpoint (Postgres FTS adapter)

### Web
- [x] Next.js 15 App Router + Tailwind + shadcn/ui base
- [x] Design tokens + dark/light theme
- [x] Marketing landing placeholder + pricing stub
- [x] Auth pages: login, signup (creates tenant), forgot password, reset password, verify email
- [x] App shell: collapsible sidebar, top bar, global search, tenant switcher (super admin), notifications bell, user menu, theme toggle
- [x] Cmd+K command palette
- [x] TanStack Query providers, toast, typed API client with refresh-on-401
- [x] Protection middleware + session bootstrap

### Verification gates
- [x] `pnpm install`
- [x] `pnpm db:migrate` + `pnpm db:seed`
- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm build`
- [x] Both apps boot; login with seed credentials works

---

## Phase 2 — Core ATS ✅
### Test harness (Phase 1 gap)
- [x] Jest + supertest e2e harness against `talentflow_test` with a non-owner NOBYPASSRLS role
- [x] Factories + runtime table discovery + per-suite truncate
- [x] Suites: auth, CSRF, tenant isolation (3 layers), RBAC, enum parity
- [x] Playwright smoke (`apps/web/e2e/auth.spec.ts`) wired to root `pnpm test:e2e`
### Foundation
- [x] `phase2_core_ats` migration: new enums, changed + new models, performance indexes
- [x] New permissions (`pipeline:*`, `candidate:import`, `candidate:bulk_update`, `job:clone`, `job:bulk_update`, `list:*`) in the catalog + role templates
- [x] Shared Zod schemas in `packages/types`; `TENANT_MODELS` + `rls.sql` updated
### Pipeline & rejection reasons
- [x] Tenant-default stage set: `GET/POST /pipeline/stages`, `PATCH /stages/:id`, atomic `PUT /stages/reorder`
- [x] `DELETE /stages/:id?moveToStageId=` — blocked (409) while in use unless a destination is supplied, then applications move + `StageHistory` + soft delete; intake stage protected
- [x] Per-job override: `PUT /jobs/:id/stages` (materialises the workspace pipeline onto a job, id-or-key identity)
- [x] Rejection-reason catalogue: `GET/POST/PATCH/DELETE /pipeline/rejection-reasons` (system reasons deactivatable, not deletable)
- [x] Web: Settings → Pipeline (dnd-kit drag-to-reorder, keyboard sensor, edit/delete dialogs) and Settings → Rejection reasons
- [x] e2e suite `apps/api/test/pipeline.e2e-spec.ts` (25 tests)
### Jobs
- [x] Jobs list: table + filters + saved views
- [x] Job create/edit: location, remote/hybrid, type (FT/Contract/C2C/W2), pay/bill rate, openings, description, priority, status (client/contact/skills/owner pickers land with the clients + candidates modules)
- [x] Assign recruiters (JobAssignment)
- [x] Job detail page with Kanban pipeline + drag & drop across stages
### Applications
- [x] Add candidate(s) to a job; duplicate active application blocked (409)
- [x] Move stage → `StageHistory` + Activity + notification + `stageEnteredAt` (bulk move → Module 6)
- [x] Reject with reason, withdraw, remove; list per job and per candidate
### Candidates
- [x] Candidate list with advanced filters (skills, location, experience, work auth, availability, tags, source, owner)
- [x] Candidate profile: overview, resume viewer, experience, education, skills, activity timeline, applications, documents, notes
- [x] Add manually / upload resume
- [x] Duplicate detection (email, phone, name fuzzy) + merge
- [x] Hotlists / talent pools (`CandidateList`)
### Resume parsing
- [x] Upload PDF/DOCX → queue job → text extraction
- [x] `ResumeParser` interface + LLM parser (env-configured key) + regex fallback
- [x] Parsed JSON stored on `CandidateResume`, review-and-accept UI
### Bulk & import
- [x] Bulk actions: tag, assign to job, change owner, CSV export, bulk email
- [x] CSV/Excel import for candidates, clients, jobs with field-mapping UI + `ImportJob` error report
### Global search
- [x] Global search endpoints + `Cmd+K` command palette wiring (FTS across jobs/candidates/clients)
### Verification gates
- [x] Idempotent seed extension (per-job pipelines, SLA breaches, sub-resources, PDF resumes, skill aliases, hotlists, duplicates, `ImportJob`s)
- [x] `pnpm db:seed:load` (100k candidates) + `EXPLAIN ANALYZE` — common filters < 300 ms
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm test` / `pnpm test:e2e` all green
- [x] [`PHASE-2-VERIFICATION.md`](./PHASE-2-VERIFICATION.md) complete

## Phase 3 — CRM & Submissions
- [x] Clients & contacts: list, detail, jobs per client, activity timeline, status
- [x] Submissions: submit candidate to client with branded resume formatting (hide-contact option), client feedback, status tracking
- [x] Interviews: schedule (date/time/timezone), interviewers, type, feedback & ratings
- [x] Offers & placements: offer details, placement record, rates, margin calculation, dates
- [x] Activities & tasks: log calls/notes/meetings, tasks with due dates + reminders, "My Day" view
- [x] Email: send from app, templates + merge fields, logged to timelines
### Verification gates
- [x] One e2e suite per module (clients, submissions, interviews, offers-placements, tasks, email) — 20 suites / 354 tests
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm test` / `pnpm test:e2e` all green
- [x] [`PHASE-3-VERIFICATION.md`](./PHASE-3-VERIFICATION.md) complete

## Phase 4 — Dashboards & Reports
- [ ] Recruiter dashboard (my jobs, my submissions, tasks today)
- [ ] Manager dashboard (team performance)
- [ ] Admin dashboard (company KPIs)
- [ ] Reports: submissions/interviews/placements per recruiter & per client
- [ ] Time-to-fill, pipeline conversion funnel, source effectiveness, revenue/margin
- [ ] Date-range filters + CSV export

## Phase 5 — SaaS & Billing
- [ ] Plans (Starter, Growth, Pro, Enterprise) with feature flags + limits (users, jobs, AI credits, storage)
- [ ] Seat-based subscriptions, 14-day trial
- [ ] `PaymentProvider` interface → Stripe (global) + Razorpay (India)
- [ ] Webhooks, invoices, upgrade/downgrade, dunning, workspace lock on non-payment
- [ ] Tenant settings: profile, branding, users & invites, roles & permissions editor, pipeline stage editor, custom fields editor, email templates, integrations
- [ ] Super Admin panel: all tenants, MRR, active users, plan usage, impersonate (audited), suspend, feature flags
- [ ] Public marketing site: landing, pricing, signup
### Deployment
- [ ] Multi-stage Dockerfiles for `apps/web` (Next.js standalone) + `apps/api` (NestJS) and `.dockerignore`
- [ ] CI pipeline: install → typecheck → lint → test → build → image push

## Phase 6 — AI & Integrations
- [ ] AI candidate→job matching with scores (pgvector embeddings)
- [ ] AI job description generator
- [ ] AI candidate summary
- [ ] Semantic candidate search
- [ ] Gmail / Outlook two-way sync
- [ ] Google / Microsoft calendar sync
- [ ] Job board publishing (LinkedIn, Indeed, Naukri, Dice)
- [ ] Public careers page per tenant
- [ ] LinkedIn sourcing Chrome extension
- [ ] Public REST API + webhooks
- [ ] Candidate portal & client portal
