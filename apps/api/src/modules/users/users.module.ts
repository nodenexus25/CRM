import { Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';
import { RbacModule } from '@/modules/rbac/rbac.module';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Workspace user administration.
 *
 * `AuthModule` supplies `PasswordService` (admin password resets) and
 * `RbacModule` supplies `RbacService` (permission resolution and cache
 * invalidation). Prisma, audit, queue and mail are global.
 */
@Module({
  imports: [AuthModule, RbacModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
