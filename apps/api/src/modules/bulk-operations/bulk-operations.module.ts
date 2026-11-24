import { Module } from '@nestjs/common';

import { ApplicationsModule } from '@/modules/applications/applications.module';
import { CandidateListsModule } from '@/modules/candidate-lists/candidate-lists.module';
import { CandidatesModule } from '@/modules/candidates/candidates.module';
import { JobsModule } from '@/modules/jobs/jobs.module';

import { BulkOperationsController } from './bulk-operations.controller';
import { BulkOperationsService } from './bulk-operations.service';

/**
 * Bulk actions (Phase 2, Module 6).
 *
 * Depends on the four feature modules whose single-record services it reuses
 * (candidates, jobs, applications, hotlists) so stages, status machines and
 * activity history are applied exactly as they are on the individual paths.
 * Prisma, storage, audit and the `bulk` queue come from global infrastructure.
 *
 * The `bulk` worker is registered in `QueueModule`, mirroring the resume
 * processor, so it can inject this module's service without a module cycle.
 */
@Module({
  imports: [CandidatesModule, JobsModule, ApplicationsModule, CandidateListsModule],
  controllers: [BulkOperationsController],
  providers: [BulkOperationsService],
  exports: [BulkOperationsService],
})
export class BulkOperationsModule {}
