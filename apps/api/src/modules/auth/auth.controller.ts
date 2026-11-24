import { Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import {
  acceptInviteSchema,
  changePasswordSchema,
  checkSlugQuerySchema,
  forgotPasswordSchema,
  loginSchema,
  passwordStrengthRequestSchema,
  refreshSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  signupSchema,
  switchTenantSchema,
  verifyEmailSchema,
  type AcceptInviteRequest,
  type AuthSessionResponse,
  type ChangePasswordRequest,
  type ForgotPasswordRequest,
  type LoginRequest,
  type PasswordStrength,
  type RefreshRequest,
  type ResendVerificationRequest,
  type ResetPasswordRequest,
  type SignupRequest,
  type SwitchTenantRequest,
  type VerifyEmailRequest,
} from '@talentflow/types';

import { ActiveTenantId } from '@/common/decorators/active-tenant.decorator';
import { AllowNoTenant } from '@/common/decorators/allow-no-tenant.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { ZodBody, ZodQuery } from '@/common/decorators/zod.decorator';
import { UnauthorizedError } from '@/common/errors/domain-errors';
import { readCookie } from '@/common/http/cookies';
import { AuthRateLimit } from '@/common/http/rate-limit';
import { requestContext } from '@/common/request-context';
import type { AppConfig } from '@/config/configuration';

import { AuthCookieService } from './auth.cookies';
import { AuthService } from './auth.service';

/**
 * Credential and session endpoints.
 *
 * Tokens are returned only as httpOnly cookies — never in a response body — so
 * a cross-site script cannot exfiltrate a session and the browser attaches
 * them automatically on same-origin requests.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookieService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // ---------------------------------------------------------------------------
  // Registration & sign-in
  // ---------------------------------------------------------------------------

  @Public()
  @AllowNoTenant()
  @AuthRateLimit()
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a workspace and its first administrator' })
  async signup(
    @ZodBody(signupSchema) body: SignupRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const result = await this.auth.signup(body);
    this.cookies.issue(response, result.tokens);
    return result.session;
  }

  @Public()
  @AllowNoTenant()
  @AuthRateLimit()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @ZodBody(loginSchema) body: LoginRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const context = requestContext.getOrThrow();
    const result = await this.auth.login(body, { ip: context.ip, userAgent: context.userAgent });
    this.cookies.issue(response, result.tokens);
    return result.session;
  }

  @Public()
  @AllowNoTenant()
  @AuthRateLimit()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the session using the refresh cookie' })
  async refresh(
    @ZodBody(refreshSchema) body: RefreshRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const token = readCookie(request, this.refreshCookieName) ?? body.refreshToken;

    if (!token) {
      this.cookies.clear(response);
      throw new UnauthorizedError('Your session has ended. Sign in again.');
    }

    const context = requestContext.getOrThrow();
    const result = await this.auth.refresh(token, { ip: context.ip, userAgent: context.userAgent });
    this.cookies.issue(response, result.tokens);
    return result.session;
  }

  @Public()
  @AllowNoTenant()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(readCookie(request, this.refreshCookieName));
    this.cookies.clear(response);
  }

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------

  @Get('session')
  @ApiOperation({ summary: 'Current user, workspace and effective permissions' })
  session(
    @CurrentUser('id') userId: string,
    @ActiveTenantId() activeTenantId: string | undefined,
  ): Promise<AuthSessionResponse> {
    return this.auth.getSession(userId, activeTenantId);
  }

  @Post('switch-tenant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch a platform super admin into another workspace' })
  switchTenant(
    @CurrentUser('id') userId: string,
    @ZodBody(switchTenantSchema) body: SwitchTenantRequest,
  ): Promise<AuthSessionResponse> {
    return this.auth.switchTenant(userId, body.tenantId);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the signed-in user’s password' })
  changePassword(
    @CurrentUser('id') userId: string,
    @ZodBody(changePasswordSchema) body: ChangePasswordRequest,
  ): Promise<{ changed: true }> {
    return this.auth.changePassword(userId, body.currentPassword, body.newPassword);
  }

  // ---------------------------------------------------------------------------
  // Email verification & password recovery
  // ---------------------------------------------------------------------------

  @Public()
  @AllowNoTenant()
  @AuthRateLimit()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm an email address from the emailed link' })
  verifyEmail(@ZodBody(verifyEmailSchema) body: VerifyEmailRequest): Promise<{ verified: true }> {
    return this.auth.verifyEmail(body.token);
  }

  @Public()
  @AllowNoTenant()
  @AuthRateLimit()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-send the verification email' })
  resendVerification(
    @ZodBody(resendVerificationSchema) body: ResendVerificationRequest,
  ): Promise<{ sent: true }> {
    return this.auth.resendVerification(body.email);
  }

  @Public()
  @AllowNoTenant()
  @AuthRateLimit()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset link' })
  forgotPassword(
    @ZodBody(forgotPasswordSchema) body: ForgotPasswordRequest,
  ): Promise<{ sent: true }> {
    return this.auth.forgotPassword(body.email);
  }

  @Public()
  @AllowNoTenant()
  @AuthRateLimit()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password using a reset link' })
  resetPassword(
    @ZodBody(resetPasswordSchema) body: ResetPasswordRequest,
  ): Promise<{ reset: true }> {
    return this.auth.resetPassword(body.token, body.password);
  }

  @Public()
  @AllowNoTenant()
  @AuthRateLimit()
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a workspace invitation and sign in' })
  async acceptInvite(
    @ZodBody(acceptInviteSchema) body: AcceptInviteRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const result = await this.auth.acceptInvite(body.token, {
      firstName: body.firstName,
      lastName: body.lastName,
      password: body.password,
    });
    this.cookies.issue(response, result.tokens);
    return result.session;
  }

  // ---------------------------------------------------------------------------
  // Public helpers used by the signup form
  // ---------------------------------------------------------------------------

  @Public()
  @AllowNoTenant()
  @Get('check-slug')
  @ApiOperation({ summary: 'Check whether a workspace URL is still available' })
  checkSlug(@ZodQuery(checkSlugQuerySchema) query: { slug: string }) {
    return this.auth.checkSlug(query.slug);
  }

  @Public()
  @AllowNoTenant()
  @Post('password-strength')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Score a candidate password with the server-side policy' })
  passwordStrength(
    @ZodBody(passwordStrengthRequestSchema) body: { password: string },
  ): PasswordStrength {
    return this.auth.measurePasswordStrength(body.password);
  }

  private get refreshCookieName(): string {
    return this.config.get('cookie', { infer: true }).refreshName;
  }
}
