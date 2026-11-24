import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { type GlobalSearchEntity, type GlobalSearchResultItem } from '@talentflow/types';

import { ForbiddenError } from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';

export interface SearchHit {
  items: GlobalSearchResultItem[];
  total: number;
}

/**
 * Backend-agnostic search contract.
 *
 * Callers never build SQL: they ask the adapter for hits and get back
 * presentation-ready items. Today the only implementation is Postgres; an
 * OpenSearch adapter can be dropped in without touching a single caller.
 */
export interface SearchAdapter {
  search(entity: GlobalSearchEntity, term: string, limit: number): Promise<SearchHit>;
}

/**
 * Postgres-backed search.
 *
 * Jobs and candidates are matched with `websearch_to_tsquery` against the
 * trigger-maintained `searchVector` column and ranked with `ts_rank`; both
 * tables carry a GIN index on the vector (see the `phase2_candidate_search` and
 * `phase2_job_search` migrations). That path is ORed with a `pg_trgm`-backed
 * `ILIKE`, which is what makes a half-typed word (`softw`) still hit —
 * `websearch_to_tsquery` only matches whole lexemes, so a term still being typed
 * would otherwise find nothing.
 *
 * Clients and contacts have no `searchVector` (their rows are few and their
 * searchable text is a couple of short columns), so they use the trigram
 * similarity ranking directly.
 *
 * Every statement writes its tenant predicate out by hand: raw SQL bypasses the
 * tenancy extension, so nothing else would scope it. `count(*) OVER ()` returns
 * the pre-`LIMIT` match count in the same round trip.
 *
 * All queries go through the tenant-scoped Prisma client, so no query here can
 * return a row from another workspace.
 */
@Injectable()
export class PostgresSearchAdapter implements SearchAdapter {
  constructor(private readonly prisma: PrismaService) {}

  search(entity: GlobalSearchEntity, term: string, limit: number): Promise<SearchHit> {
    switch (entity) {
      case 'JOB':
        return this.searchJobs(term, limit);
      case 'CANDIDATE':
        return this.searchCandidates(term, limit);
      case 'CLIENT':
        return this.searchClients(term, limit);
      case 'CONTACT':
        return this.searchContacts(term, limit);
    }
  }

  private async searchJobs(term: string, limit: number): Promise<SearchHit> {
    const rows = await this.prisma.client.$queryRaw<JobHit[]>(Prisma.sql`
      SELECT j."id" AS id,
             j."title" AS title,
             j."referenceCode" AS "referenceCode",
             j."status" AS status,
             j."locationCity" AS "locationCity",
             ts_rank(j."searchVector", q.tsq) AS "rank",
             (count(*) OVER ())::int AS "total"
      FROM "jobs" j
      CROSS JOIN (SELECT websearch_to_tsquery('simple', ${term}) AS tsq) q
      WHERE j."tenantId" = ${requireTenant()}
        AND j."deletedAt" IS NULL
        AND (
          j."searchVector" @@ q.tsq
          OR j."title" ILIKE ${likeContains(term)}
          OR j."referenceCode" ILIKE ${likeContains(term)}
          OR coalesce(j."locationCity", '') ILIKE ${likeContains(term)}
        )
      ORDER BY rank DESC, j."updatedAt" DESC
      LIMIT ${limit}
    `);

    return {
      total: rows[0]?.total ?? 0,
      items: rows.map((job) => ({
        id: job.id,
        entity: 'JOB' as const,
        title: job.title,
        subtitle: job.locationCity ?? job.referenceCode,
        href: `/jobs/${job.id}`,
        badge: job.status,
      })),
    };
  }

  private async searchCandidates(term: string, limit: number): Promise<SearchHit> {
    const rows = await this.prisma.client.$queryRaw<CandidateHit[]>(Prisma.sql`
      SELECT c."id" AS id,
             c."firstName" AS "firstName",
             c."lastName" AS "lastName",
             c."email" AS email,
             c."currentTitle" AS "currentTitle",
             c."currentCompany" AS "currentCompany",
             ts_rank(c."searchVector", q.tsq) AS "rank",
             (count(*) OVER ())::int AS "total"
      FROM "candidates" c
      CROSS JOIN (SELECT websearch_to_tsquery('simple', ${term}) AS tsq) q
      WHERE c."tenantId" = ${requireTenant()}
        AND c."deletedAt" IS NULL
        AND (
          c."searchVector" @@ q.tsq
          OR c."firstName" ILIKE ${likeContains(term)}
          OR c."lastName" ILIKE ${likeContains(term)}
          OR coalesce(c."currentCompany", '') ILIKE ${likeContains(term)}
          OR coalesce(c."email", '') ILIKE ${likeContains(term)}
        )
      ORDER BY rank DESC, c."updatedAt" DESC
      LIMIT ${limit}
    `);

    return {
      total: rows[0]?.total ?? 0,
      items: rows.map((candidate) => ({
        id: candidate.id,
        entity: 'CANDIDATE' as const,
        title: `${candidate.firstName} ${candidate.lastName}`.trim(),
        subtitle: candidate.currentTitle ?? candidate.email,
        href: `/candidates/${candidate.id}`,
        badge: candidate.currentCompany,
      })),
    };
  }

  private async searchClients(term: string, limit: number): Promise<SearchHit> {
    const rows = await this.prisma.client.$queryRaw<ClientHit[]>(Prisma.sql`
      SELECT c."id" AS id,
             c."name" AS name,
             c."industry" AS industry,
             c."status" AS status,
             GREATEST(
               similarity(c."name", ${term}),
               similarity(coalesce(c."legalName", ''), ${term})
             ) AS "rank",
             (count(*) OVER ())::int AS "total"
      FROM "clients" c
      WHERE c."tenantId" = ${requireTenant()}
        AND c."deletedAt" IS NULL
        AND (
          c."name" ILIKE ${likeContains(term)}
          OR coalesce(c."legalName", '') ILIKE ${likeContains(term)}
          OR coalesce(c."industry", '') ILIKE ${likeContains(term)}
        )
      ORDER BY rank DESC, c."name" ASC
      LIMIT ${limit}
    `);

    return {
      total: rows[0]?.total ?? 0,
      items: rows.map((client) => ({
        id: client.id,
        entity: 'CLIENT' as const,
        title: client.name,
        subtitle: client.industry,
        href: `/clients/${client.id}`,
        badge: client.status,
      })),
    };
  }

  /**
   * Contacts have no detail route of their own yet, so a hit opens the client
   * it belongs to — the surface that will eventually render the contact.
   */
  private async searchContacts(term: string, limit: number): Promise<SearchHit> {
    const rows = await this.prisma.client.$queryRaw<ContactHit[]>(Prisma.sql`
      SELECT ct."id" AS id,
             ct."firstName" AS "firstName",
             ct."lastName" AS "lastName",
             ct."email" AS email,
             ct."title" AS title,
             ct."clientId" AS "clientId",
             GREATEST(
               similarity(ct."firstName" || ' ' || ct."lastName", ${term}),
               similarity(coalesce(ct."email", ''), ${term})
             ) AS "rank",
             (count(*) OVER ())::int AS "total"
      FROM "client_contacts" ct
      WHERE ct."tenantId" = ${requireTenant()}
        AND ct."deletedAt" IS NULL
        AND (
          ct."firstName" ILIKE ${likeContains(term)}
          OR ct."lastName" ILIKE ${likeContains(term)}
          OR coalesce(ct."email", '') ILIKE ${likeContains(term)}
          OR coalesce(ct."title", '') ILIKE ${likeContains(term)}
        )
      ORDER BY rank DESC, ct."lastName" ASC, ct."firstName" ASC
      LIMIT ${limit}
    `);

    return {
      total: rows[0]?.total ?? 0,
      items: rows.map((contact) => ({
        id: contact.id,
        entity: 'CONTACT' as const,
        title: `${contact.firstName} ${contact.lastName}`.trim(),
        subtitle: contact.title ?? contact.email,
        href: `/clients/${contact.clientId}`,
        badge: null,
      })),
    };
  }
}

interface JobHit {
  id: string;
  title: string;
  referenceCode: string;
  status: string;
  locationCity: string | null;
  total: number;
}

interface CandidateHit {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  total: number;
}

interface ClientHit {
  id: string;
  name: string;
  industry: string | null;
  status: string;
  total: number;
}

interface ContactHit {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  title: string | null;
  clientId: string;
  total: number;
}

/**
 * `%term%` with the LIKE metacharacters escaped, so a term containing `%` or
 * `_` is matched literally instead of quietly acting as a wildcard. The GIN
 * `trgm` indexes serve these patterns directly.
 */
function likeContains(term: string): string {
  return `%${term.replace(/([\\%_])/g, '\\$1')}%`;
}

/** Raw SQL is not scoped by the tenancy extension, so the tenant is read here. */
function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ForbiddenError('This action must run inside a workspace.');
  return tenantId;
}
