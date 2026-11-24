import { Module } from '@nestjs/common';

import { JobPipelineController } from './job-pipeline.controller';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';

@Module({
  controllers: [PipelineController, JobPipelineController],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
