import { z } from 'zod';

import { dateFormatSchema, emailSchema, idSchema, nameSchema, passwordSchema, slugSchema, currencySchema, timezoneSchema } from './common';
import { roleKeySchema, userStatusSchema } from './enums';

// ---------------------------------------------------------------------------
// Signup — self-serve creates a brand new tenant plus its first admin user
// ---------------------------------------------------------------------------

export const signupSchema = z.object({
  companyName: z.string().trim().min(2, 'Enter your company name').max(120),
  /** Optional; derived from the company name when omitted. */
  workspaceSlug: slugSchema.optional(),
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  timezone: timezoneSchema.default('UTC'),
  currency: currencySchema.default('USD'),
  dateFormat: dateFormatSchema.default('MM/DD/YYYY'),
  phone: z.string().trim().max(32).optional(),
  country: z.string().trim().max(64).optional(),
  /** Trial plan chosen on the marketing page. */
  planCode: z.enum(['STARTER', 'GROWTH', 'PRO', 'ENTERPRISE']).default('GROWTH'),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms of service' }),
  }),
  /** UTM / referral attribution, stored on the tenant for analytics. */
  referralSource: z.string().trim().max(120).optional(),
});
export type SignupInput = z.input<typeof signupSchema>;
export type SignupRequest = z.infer<typeof signupSchema>;

export const checkSlugQuerySchema = z.object({ slug: slugSchema });
export type CheckSlugQuery = z.infer<typeof checkSlugQuerySchema>;

export const checkSlugResponseSchema = z.object({
  slug: slugSchema,
  available: z.boolean(),
  suggestion: slugSchema.optional(),
});

/** Client-side password strength meter input (0–4), computed from the same rules. */
export const passwordStrengthRequestSchema = z.object({ password: z.string().max(128) });
export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Very weak' | 'Weak' | 'Fair' | 'Strong' | 'Very strong';
  checks: { minLength: boolean; lower: boolean; upper: boolean; digit: boolean; symbol: boolean };
}

// ---------------------------------------------------------------------------
// Login / session
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
  rememberMe: z.boolean().default(false),
});
export type LoginInput = z.input<typeof loginSchema>;
export type LoginRequest = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  /** Only used by non-browser clients; browsers rely on the httpOnly cookie. */
  refreshToken: z.string().min(1).optional(),
});
export type RefreshRequest = z.infer<typeof refreshSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

// ---------------------------------------------------------------------------
// Password reset / email verification
// ---------------------------------------------------------------------------

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(20, 'This reset link is not valid'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

export const verifyEmailSchema = z.object({ token: z.string().trim().min(20) });
export type VerifyEmailRequest = z.infer<typeof verifyEmailSchema>;

export const resendVerificationSchema = z.object({ email: emailSchema });
export type ResendVerificationRequest = z.infer<typeof resendVerificationSchema>;

export const acceptInviteSchema = z
  .object({
    token: z.string().trim().min(20),
    firstName: nameSchema,
    lastName: nameSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type AcceptInviteInput = z.input<typeof acceptInviteSchema>;
export type AcceptInviteRequest = z.infer<typeof acceptInviteSchema>;

// ---------------------------------------------------------------------------
// Session payloads returned to the client
// ---------------------------------------------------------------------------

export interface SessionRole {
  id: string;
  key: z.infer<typeof roleKeySchema>;
  name: string;
}

export interface SessionUser {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  title: string | null;
  avatarUrl: string | null;
  phone: string | null;
  status: z.infer<typeof userStatusSchema>;
  emailVerified: boolean;
  isSuperAdmin: boolean;
  timezone: string;
  locale: string;
  roles: SessionRole[];
  permissions: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface SessionTenant {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  brandColor: string;
  timezone: string;
  currency: string;
  dateFormat: z.infer<typeof dateFormatSchema>;
  status: string;
  trialEndsAt: string | null;
  planCode: string | null;
  planName: string | null;
}

/** Returned by `POST /auth/login`, `POST /auth/refresh`, `POST /auth/signup`. */
export interface AuthSessionResponse {
  user: SessionUser;
  tenant: SessionTenant | null;
  /** Tenants the caller may switch into (super admins only). */
  availableTenants: SessionTenant[];
  accessTokenExpiresAt: string;
}

// ---------------------------------------------------------------------------
// Super-admin impersonation
// ---------------------------------------------------------------------------

export const impersonateSchema = z.object({
  tenantId: idSchema,
  reason: z.string().trim().min(4, 'Give a short reason — it is written to the audit log').max(280),
});
export type ImpersonateRequest = z.infer<typeof impersonateSchema>;
