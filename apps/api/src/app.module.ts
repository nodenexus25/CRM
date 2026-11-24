import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuditModule } from '@/common/audit/audit.module';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { CsrfGuard } from '@/common/guards/csrf.guard';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { TenantGuard } from '@/common/guards/tenant.guard';
import { AuditInterceptor } from '@/common/interceptors/audit.interceptor';
import { ResponseEnvelopeInterceptor } from '@/common/interceptors/response-envelope.interceptor';
import { AppConfigModule } from '@/config/config.module';
import type { AppConfig } from '@/config/configuration';
import { MailModule } from '@/infra/mail/mail.module';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { QueueModule } from '@/infra/queue/queue.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { ThrottlerRedisStorage } from '@/infra/redis/throttler-redis.storage';
import { StorageModule } from '@/infra/storage/storage.module';
import { ActivitiesModule } from '@/modules/activities/activities.module';
import { ApplicationsModule } from '@/modules/applications/applications.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { BulkOperationsModule } from '@/modules/bulk-operations/bulk-operations.module';
import { CandidateListsModule } from '@/modules/candidate-lists/candidate-lists.module';
import { CandidatesModule } from '@/modules/candidates/candidates.module';
import { ClientsModule } from '@/modules/clients/clients.module';
import { EmailModule } from '@/modules/email/email.module';
import { HealthModule } from '@/modules/health/health.module';
import { ImportsModule } from '@/modules/imports/imports.module';
import { InterviewsModule } from '@/modules/interviews/interviews.module';
import { JobsModule } from '@/modules/jobs/jobs.module';
import { NotesModule } from '@/modules/notes/notes.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { OffersModule } from '@/modules/offers/offers.module';
import { PipelineModule } from '@/modules/pipeline/pipeline.module';
import { PlacementsModule } from '@/modules/placements/placements.module';
import { RbacModule } from '@/modules/rbac/rbac.module';
import { ResumesModule } from '@/modules/resumes/resumes.module';
import { SavedViewsModule } from '@/modules/saved-views/saved-views.module';
import { SearchModule } from '@/modules/search/search.module';
import { SubmissionsModule } from '@/modules/submissions/submissions.module';
import { TasksModule } from '@/modules/tasks/tasks.module';
import { TeamsModule } from '@/modules/teams/teams.module';
import { TenantModule } from '@/modules/tenant/tenant.module';
import { UsersModule } from '@/modules/users/users.module';

/**
 * Root module: infrastructure, feature modules and the global request pipeline.
 *
 * `APP_*` providers run for every route, which is what makes the security
 * posture the default rather than something each controller has to remember.
 * Their registration order is the execution order, and it is deliberate:
 * throttle first (cheap, protects everything downstream), then authenticate,
 * resolve the workspace, verify the CSRF token, and finally check permissions.
 */
@Module({
  imports: [
    AppConfigModule,

    ThrottlerModule.forRootAsync({
      inject: [ConfigService, ThrottlerRedisStorage],
      useFactory: (config: ConfigService<AppConfig, true>, storage: ThrottlerRedisStorage) => {
        const throttle = config.get('throttle', { infer: true });
        return {
          throttlers: [
            { name: 'default', ttl: throttle.ttl * 1000, limit: throttle.limit },
          ],
          storage,
        };
      },
    }),

    // Global infrastructure — imported once, injectable everywhere.
    PrismaModule,
    RedisModule,
    QueueModule,
    MailModule,
    StorageModule,
    AuditModule,

    // Feature modules.
    AuthModule,
    RbacModule,
    UsersModule,
    TeamsModule,
    TenantModule,
    NotificationsModule,
    SearchModule,
    PipelineModule,
    ClientsModule,
    JobsModule,
    ApplicationsModule,
    SubmissionsModule,
    InterviewsModule,
    OffersModule,
    PlacementsModule,
    CandidatesModule,
    CandidateListsModule,
    ResumesModule,
    ActivitiesModule,
    TasksModule,
    NotesModule,
    EmailModule,
    SavedViewsModule,
    BulkOperationsModule,
    ImportsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },

    // Interceptors wrap the handler, so they are listed outermost-first.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },

    // Any exception that escapes a handler becomes the shared error envelope.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
