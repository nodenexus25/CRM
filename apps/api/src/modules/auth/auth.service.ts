import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import {
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_REJECTION_REASONS,
  ROLE_KEY_DESCRIPTIONS,
  ROLE_KEY_LABELS,
  ROLE_PERMISSION_TEMPLATES,
  ROLE_PRIORITY,
  TENANT_ROLE_KEYS,
  type AuthSessionResponse,
  type AuthTokens,
  type LoginRequest,
  type PasswordStrength,
  type SessionTenant,
  type SignupRequest,
} from '@talentflow/types';

import {
  ConflictError,
  EmailNotVerifiedError,
  ForbiddenError,
  InvalidCredentialsError,
  TokenExpiredError,
  TokenInvalidError,
  TokenReuseError,
  UnauthorizedError,
  ValidationError,
} from '@/common/errors/domain-errors';
import type { AccessTokenPayload } from '@/common/auth/principal';
import { requestContext } from '@/common/request-context';
import { AuditService } from '@/common/audit/audit.service';
import { slugify, withSuffix } from '@/common/utils/slug.util';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { EmailQueueService } from '@/infra/queue/email-queue.service';
import type { AppConfig } from '@/config/configuration';
import { RbacService } from '@/modules/rbac/rbac.service';

import { PasswordService } from './password.service';
import { SessionService, type TenantWithPlan } from './session.service';
import { generateOpaqueToken, hashOpaqueToken } from './token-hash.util';
import { parseDurationToSeconds, TokenService } from './token.service';

const TRIAL_DAYS = 14;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const EMAIL_VERIFICATION_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_MINUTES = 60;

export interface AuthResult {
  session: AuthSessionResponse;
  tokens: AuthTokens;
}

export interface LoginMeta {
  ip?: string;
  userAgent?: string;
}

type UserWithRoles = Prisma.UserGetPayload<{
  include: { userRoles: { include: { role: true } } };
}>;

type UserWithTenant = Prisma.UserGetPayload<{
  include: { userRoles: { include: { role: true } }; tenant: true };
}>;

/**
 * Authentication and session lifecycle.
 *
 * Login is the one flow that legitimately starts without a tenant: the email
 * may exist in several workspaces, so the candidate set is loaded unscoped and
 * the password itself disambiguates. Every write after that point runs inside
 * the resolved tenant's context.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: SessionService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly rbac: RbacService,
    private readonly mail: EmailQueueService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // ---------------------------------------------------------------------------
  // Signup
  // ---------------------------------------------------------------------------

  async signup(input: SignupRequest): Promise<AuthResult> {
    const slug = await this.reserveSlug(input.workspaceSlug ?? slugify(input.companyName));

    const plan = await this.prisma.client.plan.findUnique({ where: { code: input.planCode } });
    if (!plan) {
      throw new ValidationError('That plan is not available. Pick another plan.');
    }

    const passwordHash = await this.passwords.hash(input.password);
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);

    const tenant = await this.prisma.client.tenant.create({
      data: {
        name: input.companyName,
        slug,
        status: 'TRIAL',
        trialEndsAt,
        referralSource: input.referralSource ?? null,
        settings: {
          legalName: input.companyName,
          timezone: input.timezone,
          currency: input.currency,
          dateFormat: input.dateFormat,
          ...(input.phone ? { phone: input.phone } : {}),
          ...(input.country ? { country: input.country } : {}),
        },
      },
    });

    const { user, tenantWithPlan } = await requestContext.runInTenant(tenant.id, async () => {
      await this.createSystemRoles(tenant.id);
      await this.createDefaultPipeline(tenant.id);
      await this.createDefaultRejectionReasons(tenant.id);

      const adminRole = await this.prisma.client.role.findFirstOrThrow({
        where: { key: 'TENANT_ADMIN' },
      });

      const createdUser = await this.prisma.client.user.create({
        data: {
          tenantId: tenant.id,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone ?? null,
          timezone: input.timezone,
          status: 'ACTIVE',
          passwordHash,
        },
        include: { userRoles: { include: { role: true } } },
      });

      await this.prisma.client.userRole.create({
        data: { tenantId: tenant.id, userId: createdUser.id, roleId: adminRole.id },
      });

      await this.prisma.client.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: 'TRIALING',
          trialEndsAt,
          seats: 1,
        },
      });

      const reloaded = await this.prisma.client.user.findFirstOrThrow({
        where: { id: createdUser.id },
        include: { userRoles: { include: { role: true } } },
      });
      const withPlan = await this.session.requireActiveTenant(tenant.id);

      return { user: reloaded, tenantWithPlan: withPlan };
    });

    // Verification email is fire-and-forget: the workspace is already usable.
    await this.sendVerificationEmail(tenant.id, user, tenant.name);

    const result = await requestContext.runInTenant(tenant.id, () =>
      this.issueSession(user, tenantWithPlan, {}),
    );

    await this.mail.enqueue({
      to: user.email,
      subject: `Welcome to ${this.appName}`,
      template: 'welcome',
      context: {
        firstName: user.firstName,
        tenantName: tenant.name,
        planName: plan.name,
        trialEndsAt: trialEndsAt.toDateString(),
      },
      tenantId: tenant.id,
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  async login(input: LoginRequest, meta: LoginMeta): Promise<AuthResult> {
    const candidates = await this.prisma.asSystem(() =>
      this.prisma.client.user.findMany({
        where: { email: input.email, deletedAt: null },
        include: { userRoles: { include: { role: true } }, tenant: true },
      }),
    );

    const usable = candidates.filter((candidate) => candidate.tenant.deletedAt === null);
    if (usable.length === 0) {
      throw new InvalidCredentialsError();
    }

    const now = new Date();
    const locked = usable.find((candidate) => candidate.lockedUntil && candidate.lockedUntil > now);
    if (locked) {
      throw new ForbiddenError(
        'Too many failed sign-in attempts. Try again in a few minutes or reset your password.',
      );
    }

    let matched: UserWithTenant | undefined;
    for (const candidate of usable) {
      if (!candidate.passwordHash) continue;
      if (await this.passwords.verify(candidate.passwordHash, input.password)) {
        matched = candidate;
        break;
      }
    }

    if (!matched) {
      await this.registerFailedAttempts(usable, now);
      throw new InvalidCredentialsError();
    }

    return requestContext.runInTenant(matched.tenantId, async () => {
      const user = await this.prisma.client.user.update({
        where: { id: matched.id },
        data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
        include: { userRoles: { include: { role: true } } },
      });

      await this.assertCanSignIn(user);

      const tenant = await this.session.requireActiveTenant(user.tenantId);
      const result = await this.issueSession(user, tenant, { meta });

      await this.audit.record({
        action: 'LOGIN',
        entity: 'User',
        entityId: user.id,
        description: `${user.email} signed in`,
        actorId: user.id,
        actorEmail: user.email,
        actorName: `${user.firstName} ${user.lastName}`.trim(),
      });

      return result;
    });
  }

  // ---------------------------------------------------------------------------
  // Refresh / logout
  // ---------------------------------------------------------------------------

  async refresh(refreshToken: string, meta: LoginMeta): Promise<AuthResult> {
    const payload = await this.tokens.verifyRefreshToken(refreshToken);

    return requestContext.runInTenant(payload.tid, async () => {
      const stored = await this.prisma.client.refreshToken.findUnique({
        where: { id: payload.jti },
      });

      if (!stored) {
        throw new UnauthorizedError('Your session has expired. Sign in again.');
      }

      // A token that was already rotated is being replayed: assume theft and
      // revoke the entire family.
      if (stored.replacedById || stored.revokedAt) {
        await this.revokeFamily(payload.fid);
        this.logger.warn(`Refresh token replay detected for user ${payload.sub}; family revoked`);
        throw new TokenReuseError();
      }

      if (stored.expiresAt <= new Date()) {
        throw new UnauthorizedError('Your session has expired. Sign in again.');
      }

      const user = await this.session.loadUserWithRoles(payload.sub);
      if (!user) {
        throw new UnauthorizedError('Your session is no longer valid. Sign in again.');
      }

      await this.assertCanSignIn(user);

      const tenant = await this.session.requireActiveTenant(user.tenantId);
      const result = await this.issueSession(user, tenant, {
        familyId: payload.fid,
        replaceTokenId: stored.id,
        meta,
      });

      return result;
    });
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;

    let payload: AccessTokenPayload | { fid?: string; tid?: string };
    try {
      payload = await this.tokens.verifyRefreshToken(refreshToken);
    } catch {
      // An unreadable token is already unusable — nothing to revoke.
      return;
    }

    const { tid, fid } = payload as { tid: string; fid: string };
    if (!tid || !fid) return;

    await requestContext.runInTenant(tid, () => this.revokeFamily(fid));
  }

  // ---------------------------------------------------------------------------
  // Email verification
  // ---------------------------------------------------------------------------

  async verifyEmail(token: string): Promise<{ verified: true }> {
    const record = await this.prisma.asSystem(() =>
      this.prisma.client.authToken.findUnique({
        where: { tokenHash: hashOpaqueToken(token) },
      }),
    );

    if (!record || record.type !== 'EMAIL_VERIFICATION' || record.usedAt) {
      throw new TokenInvalidError();
    }
    if (record.expiresAt <= new Date()) {
      throw new TokenExpiredError();
    }

    await requestContext.runInTenant(record.tenantId, async () => {
      await this.prisma.client.authToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });

      if (record.userId) {
        await this.prisma.client.user.update({
          where: { id: record.userId },
          data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
        });
      }
    });

    return { verified: true };
  }

  async resendVerification(email: string): Promise<{ sent: true }> {
    const users = await this.prisma.asSystem(() =>
      this.prisma.client.user.findMany({
        where: { email, deletedAt: null, emailVerifiedAt: null },
        include: { tenant: true },
      }),
    );

    for (const user of users) {
      if (user.tenant.deletedAt) continue;
      await this.sendVerificationEmail(user.tenantId, user, user.tenant.name);
    }

    // Always the same answer, so the endpoint cannot be used to enumerate accounts.
    return { sent: true };
  }

  // ---------------------------------------------------------------------------
  // Password reset
  // ---------------------------------------------------------------------------

  async forgotPassword(email: string): Promise<{ sent: true }> {
    const users = await this.prisma.asSystem(() =>
      this.prisma.client.user.findMany({
        where: { email, deletedAt: null, status: { not: 'DISABLED' } },
        include: { tenant: true },
      }),
    );

    for (const user of users) {
      if (user.tenant.deletedAt) continue;

      const token = generateOpaqueToken();
      await requestContext.runInTenant(user.tenantId, () =>
        this.prisma.client.authToken.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            email: user.email,
            type: 'PASSWORD_RESET',
            tokenHash: hashOpaqueToken(token),
            expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
          },
        }),
      );

      await this.mail.enqueue({
        to: user.email,
        subject: `Reset your ${this.appName} password`,
        template: 'reset-password',
        context: {
          firstName: user.firstName,
          tenantName: user.tenant.name,
          resetUrl: `${this.appUrl}/reset-password?token=${token}`,
          expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
        },
        tenantId: user.tenantId,
      });
    }

    return { sent: true };
  }

  async resetPassword(token: string, password: string): Promise<{ reset: true }> {
    const record = await this.prisma.asSystem(() =>
      this.prisma.client.authToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } }),
    );

    if (!record || record.type !== 'PASSWORD_RESET' || record.usedAt) {
      throw new TokenInvalidError();
    }
    if (record.expiresAt <= new Date()) {
      throw new TokenExpiredError();
    }
    if (!record.userId) {
      throw new TokenInvalidError();
    }

    const passwordHash = await this.passwords.hash(password);
    const userId = record.userId;

    await requestContext.runInTenant(record.tenantId, async () => {
      await this.prisma.client.user.update({
        where: { id: userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null, mustChangePassword: false },
      });

      await this.prisma.client.authToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });

      // A password change invalidates every existing session.
      await this.prisma.client.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await this.audit.record({
        action: 'PASSWORD_RESET',
        entity: 'User',
        entityId: userId,
        description: 'Password reset via emailed link',
      });
    });

    const user = await this.session.loadUserWithRoles(userId);
    if (user) {
      await this.mail.enqueue({
        to: user.email,
        subject: `Your ${this.appName} password was changed`,
        template: 'password-changed',
        context: { firstName: user.firstName },
        tenantId: record.tenantId,
      });
    }

    return { reset: true };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ changed: true }> {
    const user = await this.session.loadUserWithRoles(userId);
    if (!user) {
      throw new UnauthorizedError();
    }
    if (!user.passwordHash) {
      throw new ValidationError('This account has no password set yet.');
    }

    const valid = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!valid) {
      throw new InvalidCredentialsError('Your current password is incorrect');
    }

    const passwordHash = await this.passwords.hash(newPassword);

    await this.prisma.client.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });

    await this.prisma.client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.mail.enqueue({
      to: user.email,
      subject: `Your ${this.appName} password was changed`,
      template: 'password-changed',
      context: { firstName: user.firstName },
    });

    await this.audit.record({
      action: 'PASSWORD_RESET',
      entity: 'User',
      entityId: userId,
      description: 'Password changed from the account settings',
    });

    return { changed: true };
  }

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

  async acceptInvite(
    token: string,
    input: { firstName: string; lastName: string; password: string },
  ): Promise<AuthResult> {
    const record = await this.prisma.asSystem(() =>
      this.prisma.client.authToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } }),
    );

    if (!record || record.type !== 'INVITE' || record.usedAt) {
      throw new TokenInvalidError('This invitation is invalid or has already been accepted.');
    }
    if (record.expiresAt <= new Date()) {
      throw new TokenExpiredError('This invitation has expired. Ask an administrator to resend it.');
    }
    if (!record.userId) {
      throw new TokenInvalidError();
    }

    const passwordHash = await this.passwords.hash(input.password);
    const userId = record.userId;

    const user = await requestContext.runInTenant(record.tenantId, async () => {
      const updated = await this.prisma.client.user.update({
        where: { id: userId },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
        include: { userRoles: { include: { role: true } } },
      });

      await this.prisma.client.authToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });

      return updated;
    });

    const tenant = await this.session.requireActiveTenant(record.tenantId);
    const result = await requestContext.runInTenant(record.tenantId, () =>
      this.issueSession(user, tenant, {}),
    );

    await this.audit.record({
      action: 'CREATE',
      entity: 'User',
      entityId: user.id,
      description: `${user.email} accepted their invitation`,
      actorId: user.id,
      actorEmail: user.email,
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Session reads
  // ---------------------------------------------------------------------------

  /**
   * Rebuilds the session payload for the currently authenticated user.
   *
   * `activeTenantId` lets a super admin read the session as it looks from
   * inside another workspace; for everyone else it is ignored, so the header
   * cannot be used to peek across tenants.
   */
  async getSession(userId: string, activeTenantId?: string): Promise<AuthSessionResponse> {
    const user = await this.session.loadUserWithRoles(userId);
    if (!user) {
      throw new UnauthorizedError();
    }

    const targetTenantId =
      activeTenantId && user.isSuperAdmin && activeTenantId !== user.tenantId
        ? activeTenantId
        : user.tenantId;

    const roles = this.session.rolesOf(user);
    const permissions = await this.rbac.resolvePermissionKeys(
      user.id,
      user.tenantId,
      user.isSuperAdmin,
    );
    const tenant = await this.session.requireActiveTenant(targetTenantId);
    const availableTenants = await this.session.listAvailableTenants(user.isSuperAdmin);

    return {
      user: this.session.buildSessionUser(user, roles, permissions),
      tenant: this.session.buildSessionTenant(tenant),
      availableTenants,
      accessTokenExpiresAt: new Date().toISOString(),
    };
  }

  /** Switches a platform super admin into another workspace, audited. */
  async switchTenant(userId: string, tenantId: string): Promise<AuthSessionResponse> {
    const user = await this.session.loadUserWithRoles(userId);
    if (!user) {
      throw new UnauthorizedError();
    }
    if (!user.isSuperAdmin) {
      throw new ForbiddenError('Only platform administrators can switch workspaces.');
    }

    const tenant = await this.session.requireActiveTenant(tenantId);

    await this.audit.record({
      action: 'IMPERSONATE',
      entity: 'Tenant',
      entityId: tenant.id,
      description: `${user.email} switched into ${tenant.name}`,
      tenantId: tenant.id,
      actorId: user.id,
      actorEmail: user.email,
    });

    return this.getSession(userId, tenantId);
  }

  async checkSlug(slug: string): Promise<{ slug: string; available: boolean; suggestion?: string }> {
    const existing = await this.prisma.client.tenant.findUnique({ where: { slug } });
    if (!existing) {
      return { slug, available: true };
    }

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const candidate = withSuffix(slug, attempt);
      const taken = await this.prisma.client.tenant.findUnique({ where: { slug: candidate } });
      if (!taken) {
        return { slug, available: false, suggestion: candidate };
      }
    }

    return { slug, available: false };
  }

  measurePasswordStrength(password: string): PasswordStrength {
    return this.passwords.measureStrength(password);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Issues a fresh access/refresh pair.
   *
   * Rotation keeps the family id and marks the previous row as replaced, which
   * is what makes replay detectable on the next refresh.
   */
  private async issueSession(
    user: UserWithRoles,
    tenant: TenantWithPlan,
    options: { familyId?: string; replaceTokenId?: string; meta?: LoginMeta },
  ): Promise<AuthResult> {
    const familyId = options.familyId ?? randomUUID();
    const refreshTokenId = randomUUID();

    const access = await this.tokens.issueAccessToken({
      sub: user.id,
      tid: user.tenantId,
      sid: familyId,
      sad: user.isSuperAdmin,
    });

    const refresh = await this.tokens.issueRefreshToken({
      sub: user.id,
      tid: user.tenantId,
      fid: familyId,
      jti: refreshTokenId,
    });

    await this.prisma.client.refreshToken.create({
      data: {
        id: refreshTokenId,
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash: hashOpaqueToken(refresh.token),
        familyId,
        expiresAt: refresh.expiresAt,
        ip: options.meta?.ip ?? requestContext.get()?.ip ?? null,
        userAgent: options.meta?.userAgent ?? requestContext.get()?.userAgent ?? null,
      },
    });

    if (options.replaceTokenId) {
      await this.prisma.client.refreshToken.update({
        where: { id: options.replaceTokenId },
        data: { revokedAt: new Date(), replacedById: refreshTokenId },
      });
    }

    const roles = this.session.rolesOf(user);
    const permissions = await this.rbac.resolvePermissionKeys(
      user.id,
      user.tenantId,
      user.isSuperAdmin,
    );
    const availableTenants = await this.session.listAvailableTenants(user.isSuperAdmin);

    return {
      session: {
        user: this.session.buildSessionUser(user, roles, permissions),
        tenant: this.session.buildSessionTenant(tenant),
        availableTenants,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
      },
      tokens: {
        accessToken: access.token,
        refreshToken: refresh.token,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
        refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
      },
    };
  }

  private async assertCanSignIn(user: {
    status: string;
    emailVerifiedAt: Date | null;
  }): Promise<void> {
    if (user.status === 'INVITED') {
      throw new UnauthorizedError(
        'You have not accepted your invitation yet. Open the invite email to set a password.',
        'ACCEPT_INVITE',
      );
    }
    if (user.status === 'SUSPENDED' || user.status === 'DISABLED') {
      throw new ForbiddenError(
        'This account has been disabled. Contact your workspace administrator.',
      );
    }
    // Email verification is enforced by the email-verification flow; the API
    // still refuses to *start* a session for a completely unverified account.
    if (!user.emailVerifiedAt) {
      throw new EmailNotVerifiedError();
    }
  }

  private async registerFailedAttempts(
    candidates: { id: string; tenantId: string; failedLoginAttempts: number; email: string }[],
    now: Date,
  ): Promise<void> {
    for (const candidate of candidates) {
      const attempts = candidate.failedLoginAttempts + 1;
      const locked = attempts >= MAX_FAILED_LOGIN_ATTEMPTS;

      await requestContext.runInTenant(candidate.tenantId, () =>
        this.prisma.client.user.update({
          where: { id: candidate.id },
          data: {
            failedLoginAttempts: attempts,
            lockedUntil: locked ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) : null,
          },
        }),
      );

      await this.audit.record({
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: candidate.id,
        tenantId: candidate.tenantId,
        actorEmail: candidate.email,
        description: locked
          ? `Account locked after ${attempts} failed sign-in attempts`
          : `Failed sign-in attempt ${attempts} of ${MAX_FAILED_LOGIN_ATTEMPTS}`,
      });
    }
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.client.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createSystemRoles(tenantId: string): Promise<void> {
    const permissions = await this.prisma.client.permission.findMany({
      select: { id: true, key: true },
    });
    const idByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));

    const roleKeys = TENANT_ROLE_KEYS;

    for (const key of roleKeys) {
      const role = await this.prisma.client.role.create({
        data: {
          tenantId,
          key,
          name: ROLE_KEY_LABELS[key],
          description: ROLE_KEY_DESCRIPTIONS[key],
          priority: ROLE_PRIORITY[key],
          isSystem: true,
        },
      });

      const permissionIds = ROLE_PERMISSION_TEMPLATES[key]
        .map((permissionKey) => idByKey.get(permissionKey))
        .filter((id): id is string => Boolean(id));

      if (permissionIds.length > 0) {
        await this.prisma.client.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ tenantId, roleId: role.id, permissionId })),
          skipDuplicates: true,
        });
      }
    }
  }

  private async createDefaultPipeline(tenantId: string): Promise<void> {
    await this.prisma.client.jobPipelineStage.createMany({
      data: DEFAULT_PIPELINE_STAGES.map((stage, index) => ({
        tenantId,
        key: stage.key,
        name: stage.name,
        type: stage.type,
        category: stage.category,
        color: stage.color,
        order: index,
        isDefault: 'isDefault' in stage ? Boolean(stage.isDefault) : false,
        isTerminal: 'isTerminal' in stage ? Boolean(stage.isTerminal) : false,
        slaDays: 'slaDays' in stage ? stage.slaDays : null,
      })),
      skipDuplicates: true,
    });
  }

  private async createDefaultRejectionReasons(tenantId: string): Promise<void> {
    await this.prisma.client.rejectionReason.createMany({
      data: DEFAULT_REJECTION_REASONS.map((reason, index) => ({
        tenantId,
        key: reason.key,
        label: reason.label,
        order: index,
        isActive: true,
        isSystem: true,
      })),
      skipDuplicates: true,
    });
  }

  private async sendVerificationEmail(
    tenantId: string,
    user: { id: string; email: string; firstName: string },
    tenantName: string,
  ): Promise<void> {
    const token = generateOpaqueToken();

    await requestContext.runInTenant(tenantId, () =>
      this.prisma.client.authToken.create({
        data: {
          tenantId,
          userId: user.id,
          email: user.email,
          type: 'EMAIL_VERIFICATION',
          tokenHash: hashOpaqueToken(token),
          expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 3_600_000),
        },
      }),
    );

    await this.mail.enqueue({
      to: user.email,
      subject: `Confirm your email for ${this.appName}`,
      template: 'verify-email',
      context: {
        firstName: user.firstName,
        tenantName,
        verifyUrl: `${this.appUrl}/verify-email?token=${token}`,
        expiresInHours: EMAIL_VERIFICATION_TTL_HOURS,
      },
      tenantId,
    });
  }

  /** Keeps trying suffixes until no tenant owns the slug. */
  private async reserveSlug(desired: string): Promise<string> {
    for (let attempt = 0; attempt <= 25; attempt += 1) {
      const candidate = withSuffix(desired, attempt);
      const existing = await this.prisma.client.tenant.findUnique({ where: { slug: candidate } });
      if (!existing) return candidate;
    }
    throw new ConflictError('We could not find an available workspace URL. Try a different name.');
  }

  private get appName(): string {
    return this.config.get('appName', { infer: true });
  }

  private get appUrl(): string {
    return this.config.get('appUrl', { infer: true }).replace(/\/$/, '');
  }

  /** Exposed for the web client's session bootstrap. */
  refreshTtlSeconds(): number {
    return parseDurationToSeconds(
      this.config.get('jwt', { infer: true }).refreshTtl,
      60 * 60 * 24 * 30,
    );
  }

  /** Convenience re-export so callers do not import the tenant type directly. */
  buildTenantSummary(tenant: TenantWithPlan): SessionTenant {
    return this.session.buildSessionTenant(tenant);
  }
}
