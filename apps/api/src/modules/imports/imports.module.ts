import { Module } from '@nestjs/common';

import { CandidatesModule } from '@/modules/candidates/candidates.module';
import { JobsModule } from '@/modules/jobs/jobs.module';

import { ImportWriter } from './import-writer';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

/**
 * CSV/Excel import (Phase 2, Module 7).
 *
 * Depends on `CandidatesModule` and `JobsModule` because a candidate or job row
 * is written through the same services the interactive API uses — same
 * validation, same side effects (activity log, pipeline copy, tenant job
 * numbering). Prisma, storage, audit and the `import` queue come from global
 * infrastructure.
 *
 * The `import` worker is registered in `QueueModule`, mirroring the bulk and
 * resume processors, so it can inject this module's service without a cycle.
 */
@Module({
  imports: [CandidatesModule, JobsModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportWriter],
  exports: [ImportsService],
})
export class ImportsModule {}
