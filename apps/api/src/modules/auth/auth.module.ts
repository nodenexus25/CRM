import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { RbacModule } from '@/modules/rbac/rbac.module';

import { AuthController } from './auth.controller';
import { AuthCookieService } from './auth.cookies';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

/**
 * Authentication.
 *
 * Secrets are passed per-signature by `TokenService` (the access and refresh
 * tokens use different keys), so the module is registered without global
 * defaults — there is nothing here for a token to inherit by accident.
 *
 * `TokenService` and `SessionService` are exported because the global auth
 * guards live in `AppModule` and depend on them.
 */
@Module({
  imports: [JwtModule.register({}), RbacModule],
  controllers: [AuthController],
  providers: [AuthService, AuthCookieService, PasswordService, SessionService, TokenService],
  exports: [AuthService, PasswordService, SessionService, TokenService],
})
export class AuthModule {}
