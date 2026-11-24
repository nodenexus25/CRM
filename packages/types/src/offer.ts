import { z } from 'zod';

import { currencySchema, idSchema, moneyCentsSchema, paginationQuerySchema, sortDirSchema } from './common';
import { offerStatusSchema, placementStatusSchema } from './enums';
import { rateTypeSchema } from './job';

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Raising an offer for an application. Every money field is optional because a
 * permanent offer carries a salary while a contract one carries pay/bill rates
 * — the panel shows whichever the deal needs.
 */
export const createOfferSchema = z.object({
  applicationId: idSchema,
  title: z.string().trim().max(200).nullable().optional(),
  salaryCents: moneyCentsSchema.nullable().optional(),
  payRateCents: moneyCentsSchema.nullable().optional(),
  billRateCents: moneyCentsSchema.nullable().optional(),
  ratePeriod: rateTypeSchema.default('ANNUAL'),
  currency: currencySchema.default('USD'),
  bonusCents: moneyCentsSchema.nullable().optional(),
  equityNote: z.string().trim().max(500).nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});
export type CreateOfferRequest = z.infer<typeof createOfferSchema>;

/**
 * Editing an offer or moving it along its lifecycle. `SENT` stamps `sentAt` and
 * a terminal status stamps `respondedAt`; both are applied server-side so a
 * caller cannot backdate a decision.
 */
export const updateOfferSchema = z.object({
  status: offerStatusSchema.optional(),
  title: z.string().trim().max(200).nullable().optional(),
  salaryCents: moneyCentsSchema.nullable().optional(),
  payRateCents: moneyCentsSchema.nullable().optional(),
  billRateCents: moneyCentsSchema.nullable().optional(),
  ratePeriod: rateTypeSchema.optional(),
  currency: currencySchema.optional(),
  bonusCents: moneyCentsSchema.nullable().optional(),
  equityNote: z.string().trim().max(500).nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  declineReason: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});
export type UpdateOfferRequest = z.infer<typeof updateOfferSchema>;

/** Accepting an offer; the placement is derived from the offer's own terms. */
export const acceptOfferSchema = z.object({
  startDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});
export type AcceptOfferRequest = z.infer<typeof acceptOfferSchema>;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const offerQuerySchema = paginationQuerySchema.extend({
  status: z.union([offerStatusSchema, z.array(offerStatusSchema)]).optional(),
  applicationId: idSchema.optional(),
  jobId: idSchema.optional(),
  clientId: idSchema.optional(),
  recruiterId: idSchema.optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'sentAt', 'startDate']).default('createdAt'),
  sortDir: sortDirSchema.default('desc'),
});
export type OfferQuery = z.infer<typeof offerQuerySchema>;

export interface OfferApplicationRef {
  id: string;
  job: { id: string; title: string; referenceCode: string };
  candidate: { id: string; fullName: string };
  client: { id: string; name: string } | null;
}

/** The placement an accepted offer produced, if there is one. */
export interface OfferPlacementRef {
  id: string;
  status: z.infer<typeof placementStatusSchema>;
  startDate: string | null;
}

export interface OfferListItem {
  id: string;
  status: z.infer<typeof offerStatusSchema>;
  title: string | null;
  salaryCents: number | null;
  payRateCents: number | null;
  billRateCents: number | null;
  /** Raw column value (`ANNUAL`, `HOURLY`, …), normalised for display client-side. */
  ratePeriod: string;
  currency: string;
  bonusCents: number | null;
  equityNote: string | null;
  startDate: string | null;
  expiresAt: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  declineReason: string | null;
  notes: string | null;
  application: OfferApplicationRef;
  placement: OfferPlacementRef | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}
