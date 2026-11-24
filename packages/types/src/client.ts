import { z } from 'zod';

import {
  currencySchema,
  emailSchema,
  idSchema,
  paginationQuerySchema,
  phoneSchema,
  urlSchema,
} from './common';
import { clientStatusSchema } from './enums';

/**
 * CRM clients (the companies we recruit for) and their contacts.
 *
 * A client owns commercial defaults that seed new jobs, an optional owner used
 * for `_own` scoping, and a set of contacts — one of which may be flagged
 * primary. Soft delete is used throughout; `Client.deletedAt` never removes the
 * rows a placement or job still points at.
 */

const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional();

// ---------------------------------------------------------------------------
// Clients — write
// ---------------------------------------------------------------------------

export const createClientSchema = z.object({
  name: z.string().trim().min(1, 'Give the client a name').max(160),
  legalName: nullableTrimmed(200),
  status: clientStatusSchema.default('PROSPECT'),
  industry: nullableTrimmed(120),
  website: urlSchema.nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  email: emailSchema.nullable().optional(),
  description: nullableTrimmed(4000),

  addressLine1: nullableTrimmed(200),
  addressLine2: nullableTrimmed(200),
  city: nullableTrimmed(120),
  state: nullableTrimmed(120),
  postalCode: nullableTrimmed(32),
  country: nullableTrimmed(120),

  defaultBillRateCents: z.coerce.number().int().min(0).max(1_000_000_000).nullable().optional(),
  defaultFeePercentage: z.coerce.number().min(0).max(100).nullable().optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  currency: currencySchema.nullable().optional(),

  ownerId: idSchema.nullable().optional(),
  externalId: nullableTrimmed(120),
  source: nullableTrimmed(80),
});
export type CreateClientRequest = z.infer<typeof createClientSchema>;

export const updateClientSchema = createClientSchema.partial();
export type UpdateClientRequest = z.infer<typeof updateClientSchema>;

// ---------------------------------------------------------------------------
// Clients — read
// ---------------------------------------------------------------------------

export const clientQuerySchema = paginationQuerySchema.extend({
  status: z.union([clientStatusSchema, z.array(clientStatusSchema)]).optional(),
  industry: z.string().trim().max(120).optional(),
  ownerId: idSchema.optional(),
  /** Restrict to clients the caller owns (implies `client:read_own`). */
  mine: z.coerce.boolean().default(false),
  sortBy: z.enum(['name', 'createdAt', 'updatedAt', 'status']).default('createdAt'),
});
export type ClientQuery = z.infer<typeof clientQuerySchema>;

export interface ClientOwnerSummary {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface ClientListItem {
  id: string;
  name: string;
  legalName: string | null;
  status: z.infer<typeof clientStatusSchema>;
  industry: string | null;
  website: string | null;
  city: string | null;
  country: string | null;
  owner: ClientOwnerSummary | null;
  openJobs: number;
  totalJobs: number;
  contactCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClientDetail extends ClientListItem {
  phone: string | null;
  email: string | null;
  description: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  state: string | null;
  postalCode: string | null;
  defaultBillRateCents: number | null;
  defaultFeePercentage: number | null;
  paymentTermsDays: number | null;
  currency: string | null;
  externalId: string | null;
  source: string | null;
  contacts: ClientContactItem[];
  jobs: {
    id: string;
    title: string;
    referenceCode: string;
    status: string;
    openings: number;
    applicantCount: number;
    createdAt: string;
  }[];
  placements: {
    id: string;
    status: string;
    startDate: string | null;
    candidateName: string;
  }[];
}

export interface ClientStats {
  byStatus: Record<z.infer<typeof clientStatusSchema>, number>;
  total: number;
  withOpenJobs: number;
  activePlacements: number;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export const createClientContactSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  email: emailSchema.nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  title: nullableTrimmed(120),
  department: nullableTrimmed(120),
  isPrimary: z.boolean().default(false),
  notes: nullableTrimmed(2000),
});
export type CreateClientContactRequest = z.infer<typeof createClientContactSchema>;

export const updateClientContactSchema = createClientContactSchema.partial();
export type UpdateClientContactRequest = z.infer<typeof updateClientContactSchema>;

export interface ClientContactItem {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  department: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Payload for a contact picker: id + display name, scoped to a client. */
export interface ContactOption {
  id: string;
  clientId: string;
  name: string;
  email: string | null;
  isPrimary: boolean;
}
