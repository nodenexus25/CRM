import { Module } from '@nestjs/common';

import { CandidateListsController } from './candidate-lists.controller';
import { CandidateListsService } from './candidate-lists.service';

@Module({
  controllers: [CandidateListsController],
  providers: [CandidateListsService],
  exports: [CandidateListsService],
})
export class CandidateListsModule {}
