import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '@/config/configuration';
import { BulkOperationsModule } from '@/modules/bulk-operations/bulk-operations.module';
import { BulkOperationProcessor } from '@/modules/bulk-operations/processors/bulk-operation.processor';
import { EmailModule } from '@/modules/email/email.module';
import { EmailOutboundProcessor } from '@/modules/email/processors/email-outbound.processor';
import { ImportsModule } from '@/modules/imports/imports.module';
import { ImportProcessor } from '@/modules/imports/processors/import.processor';
import { ResumesModule } from '@/modules/resumes/resumes.module';
import { ResumeProcessor } from '@/modules/resumes/processors/resume.processor';

import { EmailQueueService } from './email-queue.service';
import { EmailProcessor } from './processors/email.processor';
import { QUEUE_NAMES } from './queue.constants';

/** Splits `redis://[:password@]host:port/db` into BullMQ connection options. */
function connectionFromUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
  };
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: connectionFromUrl(config.get('redis', { infer: true }).url),
        defaultJobOptions: {
          removeOnComplete: 500,
          removeOnFail: 1_000,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.email },
      { name: QUEUE_NAMES.emailOutbound },
      { name: QUEUE_NAMES.resumeParse },
      { name: QUEUE_NAMES.import },
      { name: QUEUE_NAMES.bulk },
    ),
    ResumesModule,
    BulkOperationsModule,
    ImportsModule,
    EmailModule,
  ],
  providers: [
    EmailQueueService,
    EmailProcessor,
    EmailOutboundProcessor,
    ResumeProcessor,
    BulkOperationProcessor,
    ImportProcessor,
  ],
  exports: [BullModule, EmailQueueService],
})
export class QueueModule {}
