import { z } from 'zod';

import {
  currencySchema,
  idSchema,
  moneyCentsSchema,
  paginationQuerySchema,
  percentageSchema,
  sortDirSchema,
} from './common';
import { placementStatusSchema } from './enums';
import { rateTypeSchema } from './job';

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Editing a placement's terms or lifecycle. A placement is born when an offer is
 * accepted; it is never created by hand, so there is no create schema here.
 */
export const updatePlacementSchema = z.object({
  status: placementStatusSchema.optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  payRateCents: moneyCentsSchema.nullable().optional(),
  billRateCents: moneyCentsSchema.nullable().optional(),
  ratePeriod: rateTypeSchema.optional(),
  currency: currencySchema.optional(),
  feeCents: moneyCentsSchema.nullable().optional(),
  feePercentage: percentageSchema.nullable().optional(),
  guaranteeDays: z.coerce.number().int().min(0).max(730).nullable().optional(),
  recruiterId: idSchema.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  invoiceRef: z.string().trim().max(120).nullable().optional(),
});
export type UpdatePlacementRequest = z.infer<typeof updatePlacementSchema>;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const placementQuerySchema = paginationQuerySchema.extend({
  status: z.union([placementStatusSchema, z.array(placementStatusSchema)]).optional(),
  clientId: idSchema.optional(),
  jobId: idSchema.optional(),
  applicationId: idSchema.optional(),
  recruiterId: idSchema.optional(),
  /** Inclusive lower bound on `startDate`. */
  from: z.coerce.date().optional(),
  /** Inclusive upper bound on `startDate`. */
  to: z.coerce.date().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'startDate']).default('createdAt'),
  sortDir: sortDirSchema.default('desc'),
});
export type PlacementQuery = z.infer<typeof placementQuerySchema>;

/**
 * The spread between bill and pay. Always `null` unless the caller holds
 * `placement:view_margin` — the field is omitted for everyone else rather than
 * hidden in the UI, so margin data never leaves the server.
 */
export interface PlacementMargin {
  marginCents: number | null;
  marginPercentage: number | null;
}

export interface PlacementListItem {
  id: string;
  status: z.infer<typeof placementStatusSchema>;
  applicationId: string;
  offerId: string | null;
  candidate: { id: string; fullName: string };
  job: { id: string; title: string } | null;
  client: { id: string; name: string } | null;
  recruiter: { id: string; fullName: string } | null;
  startDate: string | null;
  endDate: string | null;
  payRateCents: number | null;
  billRateCents: number | null;
  /** Raw column value (`ANNUAL`, `HOURLY`, …). */
  ratePeriod: string;
  currency: string;
  feeCents: number | null;
  feePercentage: number | null;
  guaranteeDays: number | null;
  notes: string | null;
  invoiceRef: string | null;
  margin: PlacementMargin | null;
  createdAt: string;
  updatedAt: string;
}

/** Headline numbers for the placements page. */
export interface PlacementStats {
  total: number;
  pending: number;
  active: number;
  completed: number;
  terminated: number;
  /** `null` unless the caller holds `placement:view_margin`. */
  margin: {
    totalMarginCents: number;
    totalFeeCents: number;
    averageMarginPercentage: number | null;
    currency: string | null;
  } | null;
}
