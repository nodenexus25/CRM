import { Module } from '@nestjs/common';

import { PipelineModule } from '@/modules/pipeline/pipeline.module';

import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [PipelineModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
