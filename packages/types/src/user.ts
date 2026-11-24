import { z } from 'zod';

import {
  emailSchema,
  idSchema,
  nameSchema,
  paginationQuerySchema,
  phoneSchema,
  timezoneSchema,
  urlSchema,
} from './common';
import { roleKeySchema, userStatusSchema } from './enums';

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export const assignRolesSchema = z.object({
  roleIds: z.array(idSchema).min(1, 'Select at least one role').max(10),
});
export type AssignRolesRequest = z.infer<typeof assignRolesSchema>;

export const assignTeamsSchema = z.object({
  teamIds: z.array(idSchema).max(20),
});
export type AssignTeamsRequest = z.infer<typeof assignTeamsSchema>;

// ---------------------------------------------------------------------------
// Invite / create
// ---------------------------------------------------------------------------

export const inviteUserSchema = z.object({
  email: emailSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  title: z.string().trim().max(80).optional(),
  phone: phoneSchema.optional().or(z.literal('')),
  roleIds: z.array(idSchema).min(1, 'Select at least one role').max(10),
  teamIds: z.array(idSchema).max(20).default([]),
  /** Send the invitation email now (default) or create the user silently. */
  sendInvite: z.boolean().default(true),
});
export type InviteUserRequest = z.infer<typeof inviteUserSchema>;

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const updateUserSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  title: z.string().trim().max(80).nullable().optional(),
  phone: phoneSchema.nullable().optional().or(z.literal('')),
  avatarUrl: urlSchema.nullable().optional(),
  timezone: timezoneSchema.optional(),
  locale: z.string().trim().max(10).optional(),
  status: userStatusSchema.optional(),
  roleIds: z.array(idSchema).max(10).optional(),
  teamIds: z.array(idSchema).max(20).optional(),
});
export type UpdateUserRequest = z.infer<typeof updateUserSchema>;

export const updateProfileSchema = updateUserSchema.pick({
  firstName: true,
  lastName: true,
  title: true,
  phone: true,
  avatarUrl: true,
  timezone: true,
  locale: true,
});
export type UpdateProfileRequest = z.infer<typeof updateProfileSchema>;

export const adminResetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(10)
    .max(128)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/\d/),
  /** Force the user to change it at next sign-in. */
  requireChange: z.boolean().default(true),
});
export type AdminResetPasswordRequest = z.infer<typeof adminResetPasswordSchema>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const userQuerySchema = paginationQuerySchema.extend({
  status: userStatusSchema.optional(),
  roleKey: roleKeySchema.optional(),
  teamId: idSchema.optional(),
  sortBy: z
    .enum(['createdAt', 'firstName', 'lastName', 'email', 'lastLoginAt', 'status'])
    .default('createdAt'),
});
export type UserQuery = z.infer<typeof userQuerySchema>;

export interface UserListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  title: string | null;
  avatarUrl: string | null;
  phone: string | null;
  status: z.infer<typeof userStatusSchema>;
  emailVerified: boolean;
  timezone: string;
  locale: string;
  roles: { id: string; key: z.infer<typeof roleKeySchema>; name: string }[];
  teams: { id: string; name: string }[];
  lastLoginAt: string | null;
  createdAt: string;
  /** Open work, surfaced on the team page. */
  openJobs: number;
  openTasks: number;
}

export interface UserDetail extends UserListItem {
  permissions: string[];
  activeSessions: { id: string; userAgent: string | null; ip: string | null; createdAt: string; expiresAt: string }[];
  recentActivity: {
    id: string;
    action: string;
    entity: string;
    entityId: string | null;
    createdAt: string;
  }[];
}

/** Backwards-compatible alias used by the auth module. */
export const sessionUserQuerySchema = z.object({
  relationship: z.enum(['jobs', 'candidates', 'clients']).optional(),
});
export type SessionUserQuery = z.infer<typeof sessionUserQuerySchema>;

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).optional(),
  color: z
    .string()
    .trim()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    .optional(),
  parentId: idSchema.nullable().optional(),
  leaderId: idSchema.nullable().optional(),
  memberIds: z.array(idSchema).max(200).default([]),
});
export type CreateTeamRequest = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = createTeamSchema.partial();
export type UpdateTeamRequest = z.infer<typeof updateTeamSchema>;

export interface TeamListItem {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  parentId: string | null;
  leader: { id: string; fullName: string; avatarUrl: string | null } | null;
  memberCount: number;
  openJobs: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z.coerce.boolean().default(false),
  type: z.string().trim().max(48).optional(),
});
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

export const markNotificationsSchema = z.object({
  ids: z.array(idSchema).min(1).max(200),
  read: z.boolean().default(true),
});
export type MarkNotificationsRequest = z.infer<typeof markNotificationsSchema>;

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  actor: { id: string; fullName: string; avatarUrl: string | null } | null;
  createdAt: string;
}

export interface NotificationSummary {
  unread: number;
  items: NotificationItem[];
}

