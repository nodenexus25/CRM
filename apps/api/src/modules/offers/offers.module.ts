import { Module } from '@nestjs/common';

import { PipelineModule } from '@/modules/pipeline/pipeline.module';

import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  imports: [PipelineModule],
  controllers: [OffersController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
