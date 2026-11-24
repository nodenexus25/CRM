import { Module } from '@nestjs/common';

import { PipelineModule } from '@/modules/pipeline/pipeline.module';

import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { JobBoardController } from './job-board.controller';

@Module({
  imports: [PipelineModule],
  controllers: [ApplicationsController, JobBoardController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
