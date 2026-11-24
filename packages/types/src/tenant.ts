import { z } from 'zod';

import {
  currencySchema,
  dateFormatSchema,
  hexColorSchema,
  idSchema,
  paginationQuerySchema,
  slugSchema,
  timezoneSchema,
  urlSchema,
} from './common';
import { tenantStatusSchema, userStatusSchema } from './enums';

// ---------------------------------------------------------------------------
// Workspace settings (tenant detail page in Phase 5)
// ---------------------------------------------------------------------------

export const tenantSettingsSchema = z.object({
  legalName: z.string().trim().max(160).optional(),
  website: urlSchema.optional().or(z.literal('')),
  phone: z.string().trim().max(32).optional(),
  addressLine1: z.string().trim().max(160).optional(),
  addressLine2: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(64).optional(),
  taxId: z.string().trim().max(40).optional(),
  /** Default currency for rates and invoices. */
  currency: currencySchema,
  timezone: timezoneSchema,
  dateFormat: dateFormatSchema,
  weekStartsOn: z.coerce.number().int().min(0).max(1).default(1),
  /** Show the workspace logo on outbound candidate submissions. */
  showLogoOnSubmissions: z.boolean().default(true),
  /** Hide candidate contact details on submissions sent to clients. */
  hideCandidateContactOnSubmission: z.boolean().default(true),
  /** Default signature appended to emails sent from the app. */
  emailSignature: z.string().trim().max(2000).optional(),
});
export type TenantSettingsInput = z.input<typeof tenantSettingsSchema>;
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  logoUrl: urlSchema.nullable().optional(),
  brandColor: hexColorSchema.optional(),
  primaryDomain: z.string().trim().max(253).nullable().optional(),
  settings: tenantSettingsSchema.partial().optional(),
});
export type UpdateTenantRequest = z.infer<typeof updateTenantSchema>;

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: z.infer<typeof tenantStatusSchema>;
  logoUrl: string | null;
  brandColor: string;
  timezone: string;
  currency: string;
  createdAt: string;
  trialEndsAt: string | null;
}

/**
 * Everything the workspace settings screen renders. `settings` is partial
 * because rows created before a setting existed simply do not carry the key.
 */
export interface TenantDetail extends TenantSummary {
  primaryDomain: string | null;
  planCode: string | null;
  planName: string | null;
  settings: Partial<TenantSettings>;
  memberCounts: TenantMemberCounts;
}

// ---------------------------------------------------------------------------
// Super-admin platform endpoints
// ---------------------------------------------------------------------------

export const platformTenantQuerySchema = paginationQuerySchema.extend({
  status: tenantStatusSchema.optional(),
  planCode: z.string().trim().max(32).optional(),
  sortBy: z.enum(['createdAt', 'name', 'status']).default('createdAt'),
});
export type PlatformTenantQuery = z.infer<typeof platformTenantQuerySchema>;

export interface PlatformTenantListItem {
  id: string;
  name: string;
  slug: string;
  status: z.infer<typeof tenantStatusSchema>;
  planCode: string | null;
  planName: string | null;
  seatsUsed: number;
  seatsIncluded: number;
  totalUsers: number;
  activeUsers: number;
  jobs: number;
  candidates: number;
  storageBytes: string;
  mrrCents: number;
  createdAt: string;
  trialEndsAt: string | null;
  lastActivityAt: string | null;
}

export const platformTenantActionSchema = z.object({
  reason: z.string().trim().min(4).max(280),
});
export type PlatformTenantActionRequest = z.infer<typeof platformTenantActionSchema>;

export interface PlatformMetrics {
  totalTenants: number;
  activeTenants: number;
  trialingTenants: number;
  suspendedTenants: number;
  totalUsers: number;
  activeUsers: number;
  mrrCents: number;
  arrCents: number;
  newTenantsThisMonth: number;
  churnedThisMonth: number;
}

export interface TenantUsage {
  tenantId: string;
  users: { used: number; limit: number | null };
  jobs: { used: number; limit: number | null };
  candidates: { used: number; limit: number | null };
  storageBytes: { used: string; limit: string | null };
  aiCredits: { used: number; limit: number | null };
  invoices: {
    id: string;
    number: string;
    status: string;
    amountCents: number;
    currency: string;
    issuedAt: string;
    paidAt: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Workspace switcher (super admin)
// ---------------------------------------------------------------------------

export const switchTenantSchema = z.object({ tenantId: idSchema });
export type SwitchTenantRequest = z.infer<typeof switchTenantSchema>;

export interface TenantMemberCounts {
  total: number;
  active: number;
  invited: number;
}

export const tenantInviteQuerySchema = paginationQuerySchema.extend({
  status: userStatusSchema.optional(),
  roleKey: z.string().trim().max(32).optional(),
});
export type TenantInviteQuery = z.infer<typeof tenantInviteQuerySchema>;

export const tenantSlugParamSchema = z.object({ slug: slugSchema });
export type TenantSlugParam = z.infer<typeof tenantSlugParamSchema>;
