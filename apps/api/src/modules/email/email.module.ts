import { Module } from '@nestjs/common';

import { EmailController } from './email.controller';
import { EmailService } from './email.service';

/**
 * Email — templates, merge rendering and the outbound message log.
 *
 * Everything it needs (Prisma, mail, audit and the global queue module) is
 * provided by `@Global()` infrastructure modules. The `email-outbound` worker
 * lives in `QueueModule` alongside the other processors, not here.
 */
@Module({
  controllers: [EmailController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
