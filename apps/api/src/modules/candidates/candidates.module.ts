import { Module } from '@nestjs/common';

import { CandidateListsModule } from '@/modules/candidate-lists/candidate-lists.module';

import { CandidatesController } from './candidates.controller';
import { CandidatesService } from './candidates.service';

@Module({
  imports: [CandidateListsModule],
  controllers: [CandidatesController],
  providers: [CandidatesService],
  exports: [CandidatesService],
})
export class CandidatesModule {}
