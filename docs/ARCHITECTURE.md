# TalentFlow — Architecture

> Multi-tenant SaaS ATS + Recruitment CRM for staffing agencies and recruiting firms.
> Competitors: Ceipal, Zoho Recruit, Manatal, JobDiva.
> Product name is configurable via `NEXT_PUBLIC_APP_NAME` / `APP_NAME`.

---

## 1. System Overview

```
                          ┌──────────────────────────────────────────┐
                          │              Clients                     │
                          │  Next.js 15 web app (apps/web :3000)     │
                          │  Marketing site + Tenant workspace       │
                          └────────────────┬─────────────────────────┘
                                           │ HTTPS / REST + httpOnly cookies
                                           ▼
                          ┌──────────────────────────────────────────┐
                          │           NestJS API (apps/api :4000)    │
                          │  /api/v1/*   Swagger at /api/docs        │
                          │  Guards: Throttle→Jwt→Tenant→Csrf→Perms │
                          └───┬───────────┬───────────┬──────────────┘
                              │           │           │
                  ┌───────────▼──┐  ┌─────▼─────┐  ┌──▼────────────┐
                  │ PostgreSQL   │  │  Redis    │  │ MinIO / S3    │
                  │ + pgvector   │  │ + BullMQ  │  │ files         │
                  │ (Prisma)     │  │ cache/q   │  │               │
                  └──────────────┘  └───────────┘  └───────────────┘
                              │
                    ┌─────────▼─────────┐
                    │ Mailpit (SMTP)    │  dev only
                    │ Nodemailer        │
                    └───────────────────┘
```

---

## 2. Stack

| Layer | Technology | Notes |
|---|---|---|
| Monorepo | Turborepo + pnpm workspaces | Remote-cache ready |
| Web | Next.js 15 (App Router), React 19, TypeScript | Server Components where possible, RSC + Route Handlers as BFF proxy |
| Styling | Tailwind CSS v4, shadcn/ui (Radix primitives) | CSS custom-property design tokens |
| Data fetching | TanStack Query v5 + typed fetch client | Optimistic updates |
| Forms | React Hook Form + Zod (schemas from `packages/types`) | Single source of truth |
| Charts | Recharts | Phase 4 |
| API | NestJS 11, TypeScript, REST | Swagger/OpenAPI at `/api/docs` |
| ORM | Prisma 6 | Client extensions for tenancy |
| DB | PostgreSQL 16 + pgvector | FTS now, OpenSearch later behind a search adapter |
| Queue | Redis 7 + BullMQ | `email`, `email-outbound`, `resume-parse`, `import`, `bulk` |
| Cache | Redis (`ioredis`) | sessions, rate limits, aggregates |
| Objects | S3-compatible (MinIO local) | presigned upload/download |
| Auth | JWT access (15m) + refresh (30d) in httpOnly cookies | argon2id hashing, refresh-token rotation w/ reuse detection |
| Email | Nodemailer + SMTP (Mailpit) | Handlebars templates |
| Validation | Zod (API boundary) + class-validator at controller edges where native | DTO ↔ Zod parity tests |
| Testing | Jest (unit), Supertest (e2e), Playwright (critical flows) | |
| Logging | pino + nestjs-pino | request-id correlation |

---

## 3. Monorepo Layout

```
talentflow/
├── apps/
│   ├── api/                    # NestJS REST API
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   ├── rls.sql          # Row Level Security policies (layer 3)
│   │   │   ├── apply-rls.ts     # applies + verifies rls.sql
│   │   │   ├── seed.ts          # demo workspace
│   │   │   └── seed-load.ts     # 100k-candidate load seed (pnpm db:seed:load)
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/          # cross-cutting
│   │   │   │   ├── audit/
│   │   │   │   ├── decorators/  # @CurrentUser, @Tenant, @RequirePermissions, @Public
│   │   │   │   ├── filters/     # all-exceptions.filter
│   │   │   │   ├── guards/      # jwt, tenant, permissions
│   │   │   │   ├── interceptors/# audit, transform, tenant-context
│   │   │   │   ├── middleware/  # request-context (AsyncLocalStorage)
│   │   │   │   └── pagination/
│   │   │   ├── config/          # typed configuration + zod validation
│   │   │   ├── infra/           # prisma, redis, storage, queue, mail
│   │   │   └── modules/         # feature modules
│   │   │       ├── auth/                # login, refresh, verify, reset, session
│   │   │       ├── tenant/              # workspace settings
│   │   │       ├── users/  teams/  rbac/
│   │   │       ├── pipeline/            # tenant + per-job stages, rejection reasons
│   │   │       ├── jobs/                # list, CRUD, clone, recruiters, stats, board
│   │   │       ├── applications/        # add, move, reject, withdraw, history
│   │   │       ├── candidates/          # list + advanced filters + boolean FTS, dedupe/merge
│   │   │       ├── candidate-lists/     # hotlists / talent pools
│   │   │       ├── resumes/             # upload → queue → parse → review
│   │   │       ├── bulk-operations/     # queued bulk actions
│   │   │       ├── imports/             # CSV/Excel import + templates
│   │   │       ├── saved-views/         # per-entity saved filter views
│   │   │       ├── clients/             # clients + nested contacts (Phase 3)
│   │   │       ├── submissions/         # candidate → client submissions, feedback (Phase 3)
│   │   │       ├── interviews/          # scheduling, panel, scorecards, calendar (Phase 3)
│   │   │       ├── offers/  placements/ # offer lifecycle, placement + margin (Phase 3)
│   │   │       ├── activities/          # polymorphic activity feed (log / correct / delete)
│   │   │       ├── tasks/               # tasks, reminders, My Day read model (Phase 3)
│   │   │       ├── notes/               # author-owned, pinnable notes (Phase 3)
│   │   │       ├── email/               # templates, merge renderer, send + message log (Phase 3)
│   │   │       ├── notifications/
│   │   │       ├── search/              # grouped global search (SearchAdapter)
│   │   │       └── health/
│   │   └── test/
│   └── web/                    # Next.js 15
│       ├── src/
│       │   ├── app/
│       │   │   ├── (marketing)/ # public landing + pricing (Phase 5)
│       │   │   ├── (auth)/      # login, signup, forgot, reset, verify
│       │   │   └── (app)/       # authenticated workspace shell
│       │   ├── components/
│       │   │   ├── ui/          # shadcn primitives
│       │   │   ├── layout/      # sidebar, topbar, command-palette
│       │   │   └── *.tsx        # flat feature components
│       │   ├── hooks/
│       │   ├── lib/             # api client, auth, utils
│       │   └── providers/       # query, theme, toast
│       └── e2e/
├── packages/
│   ├── types/                  # shared Zod schemas + inferred TS types + enums
│   ├── ui/                     # shared presentational components (token-driven)
│   └── config/                 # eslint-config, tsconfig, tailwind preset
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── docs/
```

---

## 4. Multi-Tenancy

### 4.1 Model: shared database, shared schema, `tenant_id` discriminator

Every tenant-owned table carries `tenantId String` with an index. Global (platform) tables
(`Plan`, `Tenant`, `PlatformAuditLog`) are the only exceptions.

### 4.2 Enforcement — three layers

**Layer 1 — Request context.** `RequestContextMiddleware` opens an `AsyncLocalStorage`
store per request holding `{ requestId, tenantId, userId, permissions, ip, userAgent }`.

**Layer 2 — Prisma client extension.** A `$extends({ query: { $allModels: { ... } } })`
wrapper:
- injects `tenantId` into `where` for `findMany/findFirst/findUnique/count/aggregate/update*/delete*`
- injects `tenantId` into `data` for `create/createMany`
- **throws** `TenantIsolationError` if a tenant-scoped model is queried with no tenant in
  context (unless the caller explicitly opts out via `prisma.asSystem()` for platform jobs).

```ts
// apps/api/src/infra/prisma/tenant.extension.ts  (shape)
prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const ctx = requestContext.get();
        if (ctx?.bypassTenant) return query(args);
        if (!ctx?.tenantId) throw new TenantIsolationError(model, operation);
        args.where = { ...args.where, tenantId: ctx.tenantId };
        return query(args);
      },
    },
  },
});
```

**Layer 3 — Postgres Row Level Security.** `prisma/rls.sql` enables RLS on every
tenant-owned table with policy `USING ("tenantId" = current_setting('app.tenant_id', true))`.
The policy fails closed: when `app.tenant_id` is unset the setting returns `NULL` and no
row ever matches. The API sets `app.tenant_id` per transaction via
`select set_config('app.tenant_id', $1, true)`. This is defence-in-depth: even a raw
`$queryRaw` or a bug in layer 2 cannot cross tenants. `prisma/apply-rls.ts` applies the
policies and then reports whether the connecting role is actually bound by them
(table owner / `BYPASSRLS` / superuser roles are **not**).

### 4.3 Tenant resolution
1. Authenticated `user.tenantId` (default).
2. Super Admin may pass `X-Tenant-Id` header to scope a request to another tenant
   (audited as `impersonation`).
3. Slug resolution for public careers pages / subdomain routing (Phase 6).

---

## 5. Data Model

### 5.1 Model map

```
Platform
  Plan 1─* Subscription *─1 Tenant
  Tenant 1─* Invoice
  Tenant 1─* TenantSettings (1:1 row)  : logo, brandColor, timezone, currency, dateFormat, slug

Identity & Access
  Tenant 1─* User *─* Role *─* Permission
  Tenant 1─* Team 1─* TeamMember *─1 User
  User 1─* RefreshToken / AuthToken (reset, verify, invite)

CRM
  Tenant 1─* Client 1─* ClientContact
  Client 1─* Job

ATS
  Job 1─* JobPipelineStage          (tenant default when jobId = null, else a full per-job copy)
  Job 1─* JobAssignment *─1 User
  Job *─* Skill (JobSkill)          Skill.aliases[] feeds the parser + boolean search
  Candidate 1─* CandidateResume / CandidateExperience / CandidateEducation
  Candidate 1─* CandidateEmail / CandidatePhone / CandidateCertification / CandidateLanguage
  Candidate *─* Skill (CandidateSkill)
  Candidate *─* CandidateList (CandidateListMember)   # hotlists / talent pools
  Candidate.dedupeKey + email/phone/linkedin normalised columns  → duplicate scan + merge
  Candidate 1─* Application *─1 Job
  Application 1─* StageHistory      (stageEnteredAt + JobPipelineStage.slaDays → SLA)
  Application 1─* Interview
  Application 1─* Offer 1─1 Placement
  RejectionReason (tenant catalogue), TenantSequence (per-entity code counters)

Engagement
  Activity (polymorphic: candidate|client|job|contact|application)
  Task, Note, Attachment, Tag + TagLink (polymorphic)
  EmailTemplate, EmailMessage (threaded, linked to activity)
  Notification (per user)

Extensibility
  CustomField (entity: candidate|job|client) 1─* CustomFieldValue (recordId)
  SavedSearch (entity + filter JSON, per user or shared)
  ImportJob (CSV/Excel import with mapping + error report) + ImportTemplate (reusable mapping)
  BulkOperation (queued bulk action with progress + result summary)

Governance
  AuditLog (actor, action, entity, entityId, before/after diff, ip)
```

### 5.2 Conventions (applied to every tenant-owned table)
- `id String @id @default(cuid())`
- `tenantId String` + `@@index([tenantId])`; composite indexes on hot paths
- `createdAt`, `updatedAt`, `deletedAt DateTime?` (soft delete)
- `createdById`, `updatedById String?`
- `@@unique` constraints always compound with `tenantId` (never globally unique on user data)
- Selective `@@index([tenantId, deletedAt])` to keep list queries fast

### 5.3 Enums (abridged — 42 total)
`TenantStatus`, `UserStatus`, `RoleKey` (SUPER_ADMIN | TENANT_ADMIN | RECRUITER_MANAGER |
RECRUITER | ACCOUNT_MANAGER | VIEWER), `JobStatus`, `JobType` (FULL_TIME | CONTRACT | C2C | W2 |
PART_TIME), `RemoteType`, `ClientStatus`, `ApplicationStage`, `ApplicationStatus`,
`InterviewType`, `OfferStatus`, `PlacementStatus`, `ActivityType`, `TaskStatus`, `Priority`,
`CustomFieldType`, `ImportEntityType`, `ImportStatus`, `InvoiceStatus`, `SubscriptionStatus`.

Phase 2 added `StageCategory` (INTAKE | ACTIVE | HIRED | REJECTED | WITHDRAWN), `SkillProficiency`,
`ResumeParseStatus` (incl. `NEEDS_OCR`), `CandidateSource`, `WorkAuthorization`,
`ExperienceLevel`, `Availability`, `BulkOperationType`, `BulkOperationStatus`. Every enum is kept
in lockstep with `packages/types` by `apps/api/test/enum-parity.e2e-spec.ts`.

---

## 6. RBAC

Permissions are strings `resource:action` (e.g. `candidate:create`, `job:read_all`,
`placement:read_own`, `settings:manage`, `billing:manage`); the catalogue holds **101**
permissions. A tenant can clone-and-customise the built-in role templates; `Role.permissions` are
join rows, so overrides are per tenant.

Guard pipeline: `Throttle → JwtAuthGuard → TenantGuard → CsrfGuard → PermissionsGuard`.
`@RequirePermissions('candidate:update')` on a handler; `PermissionsGuard` reads the resolved
permission set cached in Redis (key `perm:{tenantId}:{userId}`, 60s TTL, invalidated on role change).

Record-level scoping (`_all` vs `_own`) is applied in services via a
`scopeFilter(user, 'candidate')` helper so a `Recruiter` only sees records they own or are
assigned to, while `Recruiter Manager` sees the whole tenant.

Some rules a route guard cannot express are re-checked in the service:

- **`task:assign`** — `PATCH /tasks/:id` needs `task:update`, but *changing* `assigneeId` also
  needs `task:assign` (`ACCOUNT_MANAGER` can edit its tasks but not hand them off).
- **Note authorship** — `note:update` means "edit your own notes". Editing someone else's note
  additionally needs the moderator-tier `note:delete` (Tenant Admin / Recruiter Manager). The
  override grant is deliberately one the route does *not* already require, or the author check
  could never fail.
- **`placement:view_margin`** — margin fields are stripped from placement responses unless the
  caller holds it.

---

## 6a. API surface (Phase 3 additions)

**196 endpoints across 29 controllers** (Phase 2: 146 / 20). All follow the conventions in §6
and §8: `@RequirePermissions`, Zod schemas from `packages/types`, the `{ data }` envelope and
the audit interceptor.

| Controller | Endpoints | Permissions | Highlights |
|---|---|---|---|
| `clients` | 8 | `client:*`, `contact:read_*` | list (status/industry/owner/q), stats, CRUD, contacts list + create; delete blocked while open jobs exist (409) |
| `client-contacts` | 2 | `contact:update` / `delete` | `PATCH /contacts/:id` (`isPrimary` demotes siblings), `DELETE` blocked while an open job references the contact |
| `submissions` | 5 | `submission:send`, `application:*` | `GET /submissions`, `POST /applications/:id/submit` (hide-contact resume), status transitions, client feedback, detail |
| `interviews` | 7 | `interview:*` | list, schedule, detail, reschedule (`RESCHEDULED` on start change), cancel, feedback 1–5, calendar window |
| `offers` | 5 | `offer:*` | list, create, edit/status (`sentAt` / `respondedAt`), accept → `Placement`, delete |
| `placements` | 4 | `placement:*` | list (`_all`/`_own`), stats (needs `view_margin`), edit (margin recomputed), delete |
| `activities` | 4 | `activity:*` | list (type, `from`/`to`, `mine`), log, **correct** (`PATCH`, link immutable), delete |
| `tasks` | 6 | `task:*` | list (status/priority/`assigneeId=me`/due bounds/`overdue`/`rootOnly`), create, edit, complete (idempotent), delete, `GET /tasks/my-day` |
| `notes` | 4 | `note:*` | list (pinned first), create, edit (author or moderator), delete |
| `email` | 8 | `email:*` | template CRUD (system templates deactivatable, not deletable; key unique incl. soft-deleted), `POST /email/preview`, `POST /email/send`, message log + detail |

**My Day** (`GET /tasks/my-day`) is a read model, not a table: the caller's unfinished tasks due
in the current **UTC** day, their overdue backlog (top 20), today's interviews they sit on, and
counts (`open`, `inProgress`, `dueToday`, `overdue`, `completedToday`).

---

## 7. Auth Flows

| Flow | Endpoint | Notes |
|---|---|---|
| Signup (creates tenant + admin) | `POST /auth/signup` | creates `Tenant` + default roles + pipeline stages + admin user; sends verification mail |
| Login | `POST /auth/login` | sets `tf_at` (15m) + `tf_rt` (30d) httpOnly cookies; returns user + permissions |
| Refresh | `POST /auth/refresh` | rotation + reuse detection (revokes family on replay) |
| Logout | `POST /auth/logout` | revokes refresh token, clears cookies |
| Verify email | `POST /auth/verify-email` + `GET /auth/verify-email?token=` | 24h single-use token |
| Forgot / reset password | `POST /auth/forgot-password`, `POST /auth/reset-password` | 1h single-use token, argon2id rehash, revokes all sessions |
| Me | `GET /auth/me` | user + tenant + permissions |

Cookies: `httpOnly`, `secure` in prod, `sameSite=lax`, `path=/`. CSRF: double-submit token
for state-changing routes (`tf_csrf` cookie echoed in `X-CSRF-Token`).

---

## 8. Cross-cutting Concerns

- **Validation** — global `ZodValidationPipe`; every DTO is a Zod schema from `packages/types`.
- **Errors** — `AllExceptionsFilter` maps Prisma/Zod/domain errors to a stable
  `{ statusCode, code, message, details, requestId }` envelope; no stack traces in prod.
- **Audit** — `AuditInterceptor` + explicit `AuditService.record()` for sensitive reads.
  Writes actor, tenant, action, entity, entityId, `before`/`after` diff, IP, UA.
- **Rate limiting** — `@nestjs/throttler` backed by Redis; stricter bucket on `/auth/*`.
- **Security headers** — Helmet; CORS allow-list from `WEB_ORIGIN`.
- **Search** — `SearchService` adapter interface (`search/search.adapter.ts`); the Postgres adapter
  combines a trigger-maintained `searchVector` (GIN, `websearch_to_tsquery` / `ts_rank`) with
  `pg_trgm` `ILIKE` for fuzzy matches, grouped per entity and filtered by the caller's read
  permissions. `OpenSearchAdapter` is the later swap-in. No caller touches SQL directly.
- **Files** — `StorageService` writes to S3/MinIO; DB stores only keys + metadata.
  Presigned PUT for direct browser upload, presigned GET for viewer.
- **Queues** — `email`, `email-outbound`, `resume-parse`, `import`, `bulk` queues with
  retry/backoff and a DLQ.
- **Tenant-composed email** — `POST /email/send` renders merge fields server-side, stores an
  `EmailMessage` (`QUEUED`) plus an `EMAIL` `Activity` on the linked record, and hands delivery
  to the `email-outbound` worker. Merge keys are a whitelist (`MERGE_FIELD_GROUPS` in
  `packages/types/src/email.ts`): any other `{{key}}` renders empty and is never read, even if
  the caller supplies it in `mergeData`. The worker is retry-safe — only the SMTP hand-off can
  fail a job, an already-`SENT` message is skipped, and a failure to record the outcome is logged
  rather than thrown, so BullMQ never re-delivers a message that already went out.
- **Observability** — pino JSON logs w/ `requestId`, `/health` (liveness) and `/health/ready`
  (DB + Redis + S3 checks).

---

## 9. Environment

All config is read through `apps/api/src/config/configuration.ts` and validated with Zod at
boot — the process refuses to start on invalid config. See `.env.example` for the full list.
No secret is ever committed; `docker-compose.yml` uses local-only throwaway credentials.

---

## 10. Extension Points (designed now, implemented later)

| Concern | Interface | Phase |
|---|---|---|
| AI matching | `MatchingService` + `pgvector` `CandidateEmbedding` table | 6 |
| Resume parsing | `ResumeParser` (LLM impl + regex fallback) — **shipped** | ✅ 2 |
| Payments | `PaymentProvider` (Stripe, Razorpay) | 5 |
| Search | `SearchAdapter` — Postgres adapter **shipped**, OpenSearch later | ✅ 2 / 6 |
| Job boards | `JobBoardPublisher` (LinkedIn, Indeed, Naukri, Dice) | 6 |
| Email sync | `MailSyncProvider` (Gmail, Outlook) — outbound send + `EmailMessage` threading fields (`messageId`, `inReplyTo`) **shipped** | ✅ 3 / 6 |
