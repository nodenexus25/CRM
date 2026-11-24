import { Module } from '@nestjs/common';

import { PipelineModule } from '@/modules/pipeline/pipeline.module';

import { ApplicationSubmissionsController, SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [PipelineModule],
  controllers: [SubmissionsController, ApplicationSubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
