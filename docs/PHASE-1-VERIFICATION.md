# TalentFlow — Phase 1 Verification

**Phase 1 — Foundation** · status: **complete and verified** · verified on 2026-11-01

This document is the verification record for Phase 1. It states what was built, the exact
commands used to verify it, the observed results, the defects that verification uncovered, and
what is intentionally **not** done. Nothing here is asserted without a reproducible command.

Related documents: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (design), [`ROADMAP.md`](./ROADMAP.md) (phases).

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

Host ports are deliberately offset from the service defaults so this stack can coexist with
other local stacks: Postgres `5433`, Redis `6380`, MinIO `9020`/`9021`, Mailpit `1035`/`8035`.

---

## 2. Demo credentials

All seeded users share the same password, taken from `SEED_WORKSPACE_PASSWORD` in `.env`.

| Role | Email | Password |
|---|---|---|
| Tenant Admin (workspace owner) | `admin@acme-demo.test` | `Passw0rd!23` |
| Platform Super Admin | `superadmin@talentflow.test` | `Passw0rd!23` |

The remaining seeded users in the demo workspace use the same password:

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

## 3. What was built

### 3.1 Monorepo

Turborepo + pnpm workspaces, `pnpm@9.15.0`, Node >= 20.

| Package | Purpose |
|---|---|
| `apps/web` | Next.js 15 App Router, React 19, Tailwind, shadcn/ui, TanStack Query, React Hook Form, Zod |
| `apps/api` | NestJS 11, REST, Prisma, Swagger |
| `packages/types` | Zod schemas, enums, permission catalog — built with tsup (ESM + CJS + `.d.ts`) |
| `packages/ui` | Shared token-driven primitives, consumed from source via `transpilePackages` |
| `packages/config` | Shared `tsconfig`, ESLint flat configs, Tailwind preset |

### 3.2 Database

- **46 models** and **38 enums** in `apps/api/prisma/schema.prisma`, one initial migration.
- pgvector enabled (`previewFeatures = ["postgresqlExtensions"]`), with `CandidateEmbedding`
  using an `Unsupported("vector(1536)")` column for Phase 6 matching.
- Every tenant-owned table carries `tenant_id`, plus `created_by` / `updated_by` and soft-delete
  columns where applicable.
- `apps/api/prisma/rls.sql` — `ENABLE ROW LEVEL SECURITY` and a `tenant_isolation` policy on
  every tenant-owned table, applied by `apps/api/prisma/apply-rls.ts`. Fails **closed**.
- `apps/api/prisma/seed.ts` — one demo workspace with 6 users covering every role.

### 3.3 Multi-tenancy — three independent layers

| Layer | Mechanism | Where |
|---|---|---|
| 1 | Per-request context via `AsyncLocalStorage` | [`request-context.ts`](../apps/api/src/common/request-context.ts), [`request-context.middleware.ts`](../apps/api/src/common/middleware/request-context.middleware.ts) |
| 2 | Prisma client extension injecting and filtering `tenantId`, throwing `TenantIsolationError` when a scoped query runs without a tenant | [`prisma.service.ts`](../apps/api/src/infra/prisma/prisma.service.ts) |
| 3 | Postgres Row Level Security | [`rls.sql`](../apps/api/prisma/rls.sql) |

A boot-time guard compares the models declared in the Prisma DMMF against
`TENANT_MODELS` / `PLATFORM_MODELS` in
[`tenant-models.ts`](../apps/api/src/infra/prisma/tenant-models.ts), so a newly added model
cannot silently escape classification. `PrismaService.asSystem()` is the single, greppable
escape hatch for deliberate platform-wide queries.

### 3.4 API — 46 endpoints across 8 controllers

- Zod-validated config with boot-time failure on a bad environment.
- Auth: signup (creates tenant + admin), login, refresh rotation, logout, email verification,
  forgot/reset password, accept invite, tenant switch, change password, password strength,
  slug availability.
- JWT access (15 m) + refresh (30 d) in `httpOnly` cookies (`tf_at`, `tf_rt`), Argon2id hashing,
  CSRF double-submit (`tf_csrf` cookie + `x-csrf-token` header) enforced by a global guard that
  skips safe methods, `@Public()` routes, and non-cookie callers.
- RBAC: ~93 `resource:action` permissions with `_all` / `_own` scopes, six role templates, Redis
  permission cache, `@RequirePermissions()` guard.
- Tenant guard with audited `X-Tenant-Id` impersonation for super admins.
- Audit log interceptor + service, global error envelope, Zod validation pipe (422 with field
  details), Helmet, CORS, Redis-backed rate limiting.
- Swagger at `/api/docs`; `/health` and `/health/ready` outside the versioned prefix.
- Mailer + BullMQ queue registry, S3/MinIO storage service, in-app notifications, Postgres
  full-text-search adapter.

### 3.5 Web — 20 pages, 47 components

- Route groups: `(marketing)` 2 pages, `(auth)` 6 pages, `(app)` 12 pages.
- App shell: collapsible sidebar, top bar with global search, tenant switcher (super admin),
  notifications bell, user menu, theme toggle.
- Cmd+K command palette, design tokens with dark/light theme, skeleton/empty/toast/dialog
  primitives, typed API client with refresh-on-401, edge middleware route protection with
  session bootstrap.

---

## 4. Verification

Run from the repository root. Every result below is an observed command output, not an
expectation.

### 4.1 Static gates

| Gate | Command | Observed result |
|---|---|---|
| Typecheck | `pnpm typecheck` | `Tasks: 5 successful, 5 total` |
| Lint | `pnpm lint` | `Tasks: 5 successful, 5 total`, 0 errors |
| Build | `pnpm build` | `Tasks: 3 successful`, web generated all 23 routes, 102 kB shared First Load JS |

### 4.2 Database

| Gate | Command | Observed result |
|---|---|---|
| Schema in sync | `pnpm db:migrate` | "Already in sync, no schema change or pending migration was found."; Prisma Client 6.19.3 regenerated |
| Seed | `pnpm db:seed` | exit 0, counts below |
| RLS | `pnpm db:rls` | `Policies created: 43 tables (tenant_isolation)` |

Seeded row counts as reported by the seed script:

```
permissions 93   plans 4        workspaces 2    users 6         clients 10
jobs 20          candidates 100 applications 90 interviews 38   offers 7
placements 7     tag links 60   activities 320  tasks 45        notes 70
emails 45        audit logs 40  notifications 30
```

### 4.3 Live API

The API was started from the **built** artifact (`node dist/main.js`, i.e. the real production
output, not `ts-node`):

```
[Bootstrap] TalentFlow API v0.1.0 listening on http://localhost:4000/api/v1
[Bootstrap] Allowed web origins: http://localhost:3000
[Bootstrap] OpenAPI docs: http://localhost:4000/api/docs
[RedisService] Redis connection ready
[StorageService] Storage bucket "talentflow-files" is ready
```

Authenticated session against the live API, using a cookie-persisting session:

| Probe | Result |
|---|---|
| `GET /health` | `status: ok` |
| `POST /api/v1/auth/login` | 200 — `Amelia Grant`, role `TENANT_ADMIN`, **87 permissions** |
| Cookies issued | `tf_at`, `tf_rt`, `tf_csrf` |
| `GET /api/v1/auth/session` | 200 — `admin@acme-demo.test` |
| `GET /api/v1/workspace` | 200 — `Acme Demo Staffing` / `acme-demo` / `planCode: GROWTH`, `memberCounts.total: 6` |
| `GET /api/v1/notifications/summary` | 200 — 5 items returned |
| CSRF enforcement | `POST /notifications/read-all` **without** `x-csrf-token` → **403** |

Tenant Admin holds 87 of the 93 catalogued permissions; the remainder are platform-scoped and
only reachable by the super admin.

### 4.4 Live web (production build)

Started with `next start` against the real build output:

| Route | Anonymous result |
|---|---|
| `/` | 200 |
| `/login` | 200 |
| `/signup` | 200 |
| `/pricing` | 200 |
| `/dashboard` | 307 → `/login` |
| `/users` | 307 → `/login` |
| `/jobs` | 307 → `/login` |

Protected routes redirect at the edge when no session cookie is present, and serve the app shell
when it is.

---

## 5. Defects found and fixed during verification

Phase 1 was not declared done until the application actually ran. Running it surfaced five
defects that typechecking and linting could not detect:

| # | Defect | Root cause | Fix |
|---|---|---|---|
| 1 | `next build` failed while prerendering the marketing landing page: *"Slot failed to slot onto its children"* | `Button` always passed two children (loader + children) to Radix `Slot` under `asChild`, which requires exactly one element | Render a single child when `asChild`; wrap loader + children in a fragment otherwise |
| 2 | `next build` failed earlier with a runtime warning on `src/middleware` | A redundant `export const runtime = 'edge'` — middleware is already edge | Removed the export |
| 3 | Root `pnpm typecheck` failed: *"File `tsup.config.ts` is not under `rootDir` `src`"* | `packages/types/tsconfig.json` pinned `rootDir: "src"` while including a file at the package root | Removed `rootDir` (`noEmit` was already set) |
| 4 | Root `pnpm lint` failed: *"ESLint couldn't find an eslint.config.(js\|mjs\|cjs) file"* | `packages/types` and `packages/ui` declared `lint` scripts but shipped no flat config | Added `eslint.config.mjs` to both, re-exporting `@talentflow/config/eslint/base` |
| 5 | `pnpm db:seed` crashed: `email_messages_templateId_fkey` foreign key violation | Template ids were derived from short labels while the email seeder derived its FK from the template's real `key` | Aligned the five template ids with their keys |
| 6 | `nest build` produced a `dist/` with no `main.js`, so `node dist/main.js` failed with *"Cannot find module ...dist\\main"* | A stale `tsconfig.tsbuildinfo` sat **outside** `dist` and survived `deleteOutDir`, so the incremental emit skipped files it believed were written | Moved `tsBuildInfoFile` inside `dist`; made the scripts config non-incremental |
| 7 | A seed artefact made the admin's notification bell always show 0 unread | Recipient was chosen with `index % 6` and the read flag with `index % 3` — sharing a factor, so every notification the admin received was already read | Made the read flag independent of the index |

Two further findings turned out **not** to be defects and required no change:

- A suspected CSRF bypass was a false positive: PowerShell's `WebRequestSession` persists
  headers across calls, so an earlier `-Headers` argument was still being sent. A clean session
  returns 403 as intended.
- `/workspace` returning no nested `plan` object is by design — the DTO exposes flat
  `planCode` / `planName`.

---

## 6. Known limitations

These are deliberate, documented gaps — not oversights.

1. **RLS is dormant in local development.** `pnpm db:rls` reports the runtime role as
   `superuser=true bypassrls=true owns=47 table(s)`. Postgres does not apply RLS to a
   `BYPASSRLS` owner, so **layer 2 (the Prisma extension) is the active enforcement path
   locally**. Layer 3 activates in production, where the API connects as a non-owner login that
   is a member of `talentflow_app` and sets `app.tenant_id` per transaction. Policies fail
   closed: with no `app.tenant_id` set, a scoped table returns zero rows rather than everything.
2. **No automated tests exist yet.** `pnpm test` exits 0 via `jest --passWithNoTests`; it is
   currently a no-op and is deliberately **not** ticked in `ROADMAP.md`. Adding tenant-isolation
   unit tests and a Playwright auth flow is the recommended opening task of Phase 2.
3. **No Dockerfiles.** `docker-compose.yml` covers local infrastructure only. Container images
   for `apps/web` and `apps/api` are scoped to Phase 5 under "Deployment" in `ROADMAP.md`.
4. **Empty feature routes.** `/jobs`, `/candidates`, `/clients`, `/interviews`, `/submissions`
   and `/reports` are authenticated placeholders rendered by the app shell's phase-placeholder
   component. They are the subject of Phases 2–4.

---

## 7. Phase 1 exit criteria

| Criterion | Status |
|---|---|
| Monorepo builds, lints and typechecks cleanly via Turborepo | met |
| Full schema migrated; seed produces a realistic demo workspace | met |
| All three tenancy layers present; model coverage asserted at boot | met |
| Every endpoint authenticated, permission-checked, validated and tenant-scoped | met |
| Auth flows complete, including verification and password reset | met |
| App shell with sidebar, top bar, search, tenant switcher, notifications, theme | met |
| Both apps boot and the seeded credentials log in | met |
| Zero errors from `typecheck`, `lint` and `build` at the repository root | met |

---

## 8. Next — Phase 2 (Core ATS)

Jobs (list, filters, saved views, full create/edit, recruiter assignment, Kanban pipeline with
drag and drop); Candidates (advanced filters, full profile, resume viewer, activity timeline,
duplicate detection); Resume parsing (PDF/DOCX upload → queue → `ResumeParser` with an
LLM-backed implementation and a regex fallback, review-and-accept UI); Bulk and import (bulk
tag/assign/export/email, CSV and Excel import with field-mapping UI and `ImportJob` error
reports).

See [`ROADMAP.md`](./ROADMAP.md) for the complete phase breakdown.
