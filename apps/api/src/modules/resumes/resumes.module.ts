import { Module } from '@nestjs/common';

import { CandidatesModule } from '@/modules/candidates/candidates.module';

import { ResumesController } from './resumes.controller';
import { ResumesService } from './resumes.service';

/**
 * Resumes (Phase 2, Module 5).
 *
 * Depends on `CandidatesModule` because accepting a parse folds into the
 * candidate aggregate; everything else it needs (Prisma, storage, audit, the
 * `resume-parse` queue) comes from global infrastructure modules.
 */
@Module({
  imports: [CandidatesModule],
  controllers: [ResumesController],
  providers: [ResumesService],
  exports: [ResumesService],
})
export class ResumesModule {}
