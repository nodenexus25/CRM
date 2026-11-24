import { Injectable } from '@nestjs/common';
import type { JobStatus, Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  toSkipTake,
  type ClientContactItem,
  type ClientDetail,
  type ClientListItem,
  type ClientOwnerSummary,
  type ClientQuery,
  type ClientStats,
  type CreateClientContactRequest,
  type CreateClientRequest,
  type Paginated,
  type UpdateClientContactRequest,
  type UpdateClientRequest,
} from '@talentflow/types';

import { AuditService } from '@/common/audit/audit.service';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/common/errors/domain-errors';
import { requestContext } from '@/common/request-context';
import { PrismaService } from '@/infra/prisma/prisma.service';

/**
 * Job statuses that still depend on a client or one of its contacts. Deleting
 * either while one of these exists would strand a live requisition, so it is
 * blocked and surfaced as a 409 rather than silently orphaning the job.
 */
const OPEN_JOB_STATUSES: JobStatus[] = ['DRAFT', 'OPEN', 'ON_HOLD'];

const CLIENT_LIST_INCLUDE = {
  owner: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
} satisfies Prisma.ClientInclude;

const CLIENT_DETAIL_INCLUDE = {
  ...CLIENT_LIST_INCLUDE,
  contacts: {
    where: { deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.ClientInclude;

type ClientWithList = Prisma.ClientGetPayload<{ include: typeof CLIENT_LIST_INCLUDE }>;
type ClientContactRow = Prisma.ClientContactGetPayload<Record<string, never>>;

/**
 * Clients (the companies we recruit for) and their contacts — the CRM half of
 * the ATS/CRM product.
 *
 * A client carries the commercial defaults (bill rate, fee, payment terms) that
 * seed new requisitions and an optional owner used for `_own` scoping. Contacts
 * hang off a client and exactly one may be flagged primary. Everything is soft
 * deleted: a placement or job that still points at a row must keep resolving.
 */
@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(query: ClientQuery): Promise<Paginated<ClientListItem>> {
    const where = this.buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.client.client.findMany({
        where,
        include: CLIENT_LIST_INCLUDE,
        orderBy: buildOrderBy(query),
        ...toSkipTake(query),
      }),
      this.prisma.client.client.count({ where }),
    ]);

    const ids = rows.map((row) => row.id);
    const [jobs, contacts] = await Promise.all([this.jobCounts(ids), this.contactCounts(ids)]);

    return {
      items: rows.map((row) => {
        const counts = jobs.get(row.id) ?? { open: 0, total: 0 };
        return toClientListItem(row, counts, contacts.get(row.id) ?? 0);
      }),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async stats(): Promise<ClientStats> {
    const scope = this.scopeFilter();

    const [byStatus, total, withOpenJobs, activePlacements] = await Promise.all([
      this.prisma.client.client.groupBy({
        by: ['status'],
        where: { deletedAt: null, ...scope },
        _count: { _all: true },
      }),
      this.prisma.client.client.count({ where: { deletedAt: null, ...scope } }),
      this.prisma.client.client.count({
        where: { deletedAt: null, ...scope, jobs: { some: { deletedAt: null, status: 'OPEN' } } },
      }),
      // Placements are not owned by a client user, so this stays a workspace-wide
      // figure even when the caller is limited to their own clients.
      this.prisma.client.placement.count({ where: { deletedAt: null, status: 'ACTIVE', clientId: { not: null } } }),
    ]);

    const counts: ClientStats['byStatus'] = {
      PROSPECT: 0,
      ACTIVE: 0,
      INACTIVE: 0,
      CHURNED: 0,
    };
    for (const row of byStatus) counts[row.status] = row._count._all;

    return { byStatus: counts, total, withOpenJobs, activePlacements };
  }

  async detail(clientId: string): Promise<ClientDetail> {
    const client = await this.prisma.client.client.findFirst({
      where: { id: clientId, deletedAt: null },
      include: CLIENT_DETAIL_INCLUDE,
    });
    if (!client) throw new NotFoundError('Client', clientId);

    const [jobs, placements] = await Promise.all([
      this.prisma.client.job.findMany({
        where: { clientId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          referenceCode: true,
          status: true,
          openings: true,
          createdAt: true,
          _count: { select: { applications: true } },
        },
      }),
      this.prisma.client.placement.findMany({
        where: { clientId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          startDate: true,
          application: {
            select: { candidate: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
    ]);

    const openJobs = jobs.filter((job) => OPEN_JOB_STATUSES.includes(job.status)).length;

    return {
      ...toClientListItem(client, { open: openJobs, total: jobs.length }, client.contacts.length),
      phone: client.phone,
      email: client.email,
      description: client.description,
      addressLine1: client.addressLine1,
      addressLine2: client.addressLine2,
      state: client.state,
      postalCode: client.postalCode,
      defaultBillRateCents: client.defaultBillRateCents,
      defaultFeePercentage:
        client.defaultFeePercentage === null ? null : client.defaultFeePercentage.toNumber(),
      paymentTermsDays: client.paymentTermsDays,
      currency: client.currency,
      externalId: client.externalId,
      source: client.source,
      contacts: client.contacts.map(toContactItem),
      jobs: jobs.map((job) => ({
        id: job.id,
        title: job.title,
        referenceCode: job.referenceCode,
        status: job.status,
        openings: job.openings,
        applicantCount: job._count.applications,
        createdAt: job.createdAt.toISOString(),
      })),
      placements: placements.map((placement) => ({
        id: placement.id,
        status: placement.status,
        startDate: placement.startDate?.toISOString() ?? null,
        candidateName: `${placement.application.candidate.firstName} ${placement.application.candidate.lastName}`.trim(),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  async create(input: CreateClientRequest): Promise<ClientDetail> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;

    await this.assertUsersExist(compact([input.ownerId]));

    const created = await this.prisma.client.client.create({
      data: {
        tenantId,
        name: input.name,
        legalName: input.legalName ?? null,
        status: input.status,
        industry: input.industry ?? null,
        website: input.website ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        description: input.description ?? null,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postalCode: input.postalCode ?? null,
        country: input.country ?? null,
        defaultBillRateCents: input.defaultBillRateCents ?? null,
        defaultFeePercentage: input.defaultFeePercentage ?? null,
        paymentTermsDays: input.paymentTermsDays ?? null,
        currency: input.currency ?? null,
        ownerId: input.ownerId ?? userId,
        externalId: input.externalId ?? null,
        source: input.source ?? null,
        createdById: userId,
        updatedById: userId,
      },
    });

    await this.audit.record({
      action: 'CREATE',
      entity: 'Client',
      entityId: created.id,
      description: `Created client ${created.name}`,
    });

    return this.detail(created.id);
  }

  async update(clientId: string, input: UpdateClientRequest): Promise<ClientDetail> {
    await this.findClientOrFail(clientId);
    const userId = requestContext.userId ?? null;

    if (input.ownerId !== undefined) await this.assertUsersExist(compact([input.ownerId]));

    const data: Prisma.ClientUncheckedUpdateInput = { updatedById: userId };

    if (input.name !== undefined) data.name = input.name;
    if (input.legalName !== undefined) data.legalName = input.legalName ?? null;
    if (input.status !== undefined) data.status = input.status;
    if (input.industry !== undefined) data.industry = input.industry ?? null;
    if (input.website !== undefined) data.website = input.website ?? null;
    if (input.phone !== undefined) data.phone = input.phone ?? null;
    if (input.email !== undefined) data.email = input.email ?? null;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1 ?? null;
    if (input.addressLine2 !== undefined) data.addressLine2 = input.addressLine2 ?? null;
    if (input.city !== undefined) data.city = input.city ?? null;
    if (input.state !== undefined) data.state = input.state ?? null;
    if (input.postalCode !== undefined) data.postalCode = input.postalCode ?? null;
    if (input.country !== undefined) data.country = input.country ?? null;
    if (input.defaultBillRateCents !== undefined) data.defaultBillRateCents = input.defaultBillRateCents ?? null;
    if (input.defaultFeePercentage !== undefined) data.defaultFeePercentage = input.defaultFeePercentage ?? null;
    if (input.paymentTermsDays !== undefined) data.paymentTermsDays = input.paymentTermsDays ?? null;
    if (input.currency !== undefined) data.currency = input.currency ?? null;
    if (input.ownerId !== undefined) data.ownerId = input.ownerId ?? null;
    if (input.externalId !== undefined) data.externalId = input.externalId ?? null;
    if (input.source !== undefined) data.source = input.source ?? null;

    await this.prisma.client.client.update({ where: { id: clientId }, data });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'Client',
      entityId: clientId,
      description: 'Updated a client',
    });

    return this.detail(clientId);
  }

  async remove(clientId: string): Promise<{ deleted: true }> {
    const client = await this.findClientOrFail(clientId);

    const openJobs = await this.prisma.client.job.count({
      where: { clientId, deletedAt: null, status: { in: OPEN_JOB_STATUSES } },
    });
    if (openJobs > 0) {
      throw new ConflictError(
        `${client.name} still has ${openJobs} open requisition${openJobs === 1 ? '' : 's'}. Close or reassign them first.`,
      );
    }

    await this.prisma.client.client.update({
      where: { id: clientId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'Client',
      entityId: clientId,
      description: `Deleted client ${client.name}`,
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------------------

  async listContacts(clientId: string): Promise<ClientContactItem[]> {
    await this.findClientOrFail(clientId);

    const rows = await this.prisma.client.clientContact.findMany({
      where: { clientId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    return rows.map(toContactItem);
  }

  async createContact(clientId: string, input: CreateClientContactRequest): Promise<ClientContactItem> {
    const tenantId = requireTenant();
    const userId = requestContext.userId ?? null;
    await this.findClientOrFail(clientId);

    const created = await this.prisma.client.$transaction(async (tx) => {
      // The account has to have a main point of contact, so the first one added
      // is promoted automatically; later ones only take over when asked to.
      const existing = await tx.clientContact.count({ where: { clientId, deletedAt: null } });
      const isPrimary = input.isPrimary || existing === 0;

      if (isPrimary) {
        await tx.clientContact.updateMany({
          where: { clientId, isPrimary: true, deletedAt: null },
          data: { isPrimary: false },
        });
      }

      return tx.clientContact.create({
        data: {
          tenantId,
          clientId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email ?? null,
          phone: input.phone ?? null,
          title: input.title ?? null,
          department: input.department ?? null,
          isPrimary,
          notes: input.notes ?? null,
          createdById: userId,
          updatedById: userId,
        },
      });
    });

    await this.audit.record({
      action: 'CREATE',
      entity: 'ClientContact',
      entityId: created.id,
      description: `Added contact ${created.firstName} ${created.lastName}`,
    });

    return toContactItem(created);
  }

  async updateContact(contactId: string, input: UpdateClientContactRequest): Promise<ClientContactItem> {
    const existing = await this.findContactOrFail(contactId);
    const userId = requestContext.userId ?? null;

    const data: Prisma.ClientContactUncheckedUpdateInput = { updatedById: userId };
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.email !== undefined) data.email = input.email ?? null;
    if (input.phone !== undefined) data.phone = input.phone ?? null;
    if (input.title !== undefined) data.title = input.title ?? null;
    if (input.department !== undefined) data.department = input.department ?? null;
    if (input.isPrimary !== undefined) data.isPrimary = input.isPrimary;
    if (input.notes !== undefined) data.notes = input.notes ?? null;

    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (input.isPrimary === true) {
        await tx.clientContact.updateMany({
          where: { clientId: existing.clientId, isPrimary: true, deletedAt: null, id: { not: contactId } },
          data: { isPrimary: false },
        });
      }

      return tx.clientContact.update({ where: { id: contactId }, data });
    });

    await this.audit.record({
      action: 'UPDATE',
      entity: 'ClientContact',
      entityId: contactId,
      description: 'Updated a contact',
    });

    return toContactItem(updated);
  }

  async removeContact(contactId: string): Promise<{ deleted: true }> {
    const contact = await this.findContactOrFail(contactId);

    const openJobs = await this.prisma.client.job.count({
      where: { contactId, deletedAt: null, status: { in: OPEN_JOB_STATUSES } },
    });
    if (openJobs > 0) {
      throw new ConflictError(
        `${contact.firstName} ${contact.lastName} is the contact on ${openJobs} open requisition${openJobs === 1 ? '' : 's'}. Reassign them first.`,
      );
    }

    await this.prisma.client.clientContact.update({
      where: { id: contactId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: 'DELETE',
      entity: 'ClientContact',
      entityId: contactId,
      description: `Deleted contact ${contact.firstName} ${contact.lastName}`,
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** The owner scope the caller is entitled to; `{}` means "the whole workspace". */
  private scopeFilter(): Prisma.ClientWhereInput {
    const userId = requireUser();
    const context = requestContext.getOrThrow();
    const canReadAll = context.isSuperAdmin || hasPermission(context.permissions, 'client:read_all');
    return canReadAll ? {} : { ownerId: userId };
  }

  private buildWhere(query: ClientQuery): Prisma.ClientWhereInput {
    const and: Prisma.ClientWhereInput[] = [this.scopeFilter()];

    // `mine` narrows even an all-access caller to the clients they own.
    if (query.mine) and.push({ ownerId: requireUser() });

    const statuses = toArray(query.status);
    if (statuses.length > 0) and.push({ status: { in: statuses } });

    if (query.industry) {
      and.push({ industry: { equals: query.industry, mode: 'insensitive' } });
    }
    if (query.ownerId) and.push({ ownerId: query.ownerId });

    if (query.q) {
      const like = { contains: query.q, mode: 'insensitive' as const };
      and.push({
        OR: [
          { name: like },
          { legalName: like },
          { industry: like },
          { city: like },
          { website: like },
          { email: like },
        ],
      });
    }

    return { deletedAt: null, AND: and };
  }

  private async findClientOrFail(clientId: string): Promise<{ id: string; name: string }> {
    const client = await this.prisma.client.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!client) throw new NotFoundError('Client', clientId);
    return client;
  }

  private async findContactOrFail(
    contactId: string,
  ): Promise<{ id: string; clientId: string; firstName: string; lastName: string }> {
    const contact = await this.prisma.client.clientContact.findFirst({
      where: { id: contactId, deletedAt: null },
      select: { id: true, clientId: true, firstName: true, lastName: true },
    });
    if (!contact) throw new NotFoundError('Contact', contactId);
    return contact;
  }

  private async assertUsersExist(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;

    const found = await this.prisma.client.user.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });

    const missing = unique.filter((id) => !found.some((user) => user.id === id));
    if (missing.length > 0) {
      throw new ValidationError('Some of those users do not exist.', { userIds: missing });
    }
  }

  /** Per-client open and total requisition counts, in one round trip. */
  private async jobCounts(
    clientIds: string[],
  ): Promise<Map<string, { open: number; total: number }>> {
    if (clientIds.length === 0) return new Map();

    const grouped = await this.prisma.client.job.groupBy({
      by: ['clientId', 'status'],
      where: { clientId: { in: clientIds }, deletedAt: null },
      _count: { _all: true },
    });

    const counts = new Map<string, { open: number; total: number }>();
    for (const row of grouped) {
      if (!row.clientId) continue;
      const entry = counts.get(row.clientId) ?? { open: 0, total: 0 };
      entry.total += row._count._all;
      if (OPEN_JOB_STATUSES.includes(row.status)) entry.open += row._count._all;
      counts.set(row.clientId, entry);
    }
    return counts;
  }

  private async contactCounts(clientIds: string[]): Promise<Map<string, number>> {
    if (clientIds.length === 0) return new Map();

    const grouped = await this.prisma.client.clientContact.groupBy({
      by: ['clientId'],
      where: { clientId: { in: clientIds }, deletedAt: null },
      _count: { _all: true },
    });

    return new Map(grouped.map((row) => [row.clientId, row._count._all]));
  }
}

// -----------------------------------------------------------------------------
// Mappers & helpers
// -----------------------------------------------------------------------------

function toClientOwnerSummary(owner: ClientWithList['owner']): ClientOwnerSummary | null {
  if (!owner) return null;
  return {
    id: owner.id,
    fullName: `${owner.firstName} ${owner.lastName}`.trim(),
    avatarUrl: owner.avatarUrl,
  };
}

function toClientListItem(
  client: ClientWithList,
  jobs: { open: number; total: number },
  contactCount: number,
): ClientListItem {
  return {
    id: client.id,
    name: client.name,
    legalName: client.legalName,
    status: client.status,
    industry: client.industry,
    website: client.website,
    city: client.city,
    country: client.country,
    owner: toClientOwnerSummary(client.owner),
    openJobs: jobs.open,
    totalJobs: jobs.total,
    contactCount,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  };
}

function toContactItem(contact: ClientContactRow): ClientContactItem {
  return {
    id: contact.id,
    clientId: contact.clientId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    fullName: `${contact.firstName} ${contact.lastName}`.trim(),
    email: contact.email,
    phone: contact.phone,
    title: contact.title,
    department: contact.department,
    isPrimary: contact.isPrimary,
    notes: contact.notes,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

function buildOrderBy(query: ClientQuery): Prisma.ClientOrderByWithRelationInput[] {
  const dir = query.sortDir;
  switch (query.sortBy) {
    case 'name':
      return [{ name: dir }];
    case 'status':
      return [{ status: dir }];
    case 'updatedAt':
      return [{ updatedAt: dir }];
    default:
      return [{ createdAt: dir }];
  }
}

function requireTenant(): string {
  const tenantId = requestContext.tenantId;
  if (!tenantId) throw new ForbiddenError('This action must run inside a workspace.');
  return tenantId;
}

function requireUser(): string {
  const userId = requestContext.userId;
  if (!userId) throw new ForbiddenError('This action requires an authenticated user.');
  return userId;
}

/** Mirrors `PermissionsGuard`: holding `_all` satisfies an `_own` requirement. */
function hasPermission(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  if (required.endsWith('_own')) {
    return granted.includes(`${required.replace(/_own$/, '')}_all`);
  }
  return false;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function compact(values: (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => Boolean(value));
}
