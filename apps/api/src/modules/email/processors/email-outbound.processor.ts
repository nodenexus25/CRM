import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { QUEUE_NAMES, type EmailOutboundJob } from '@/infra/queue/queue.constants';

import { EmailService } from '../email.service';

/**
 * Outbound email worker.
 *
 * Runs off the request path on the `email-outbound` queue. The service re-enters
 * a tenant `AsyncLocalStorage` context before touching the database, because a
 * worker has no HTTP request to inherit it from. Logs carry the message id only
 * — the subject, body and recipients are PII and must never reach the logs.
 */
@Processor(QUEUE_NAMES.emailOutbound)
export class EmailOutboundProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailOutboundProcessor.name);

  constructor(private readonly email: EmailService) {
    super();
  }

  async process(job: Job<EmailOutboundJob>): Promise<void> {
    await this.email.runOutboundJob(job.data);
    this.logger.debug(`Handled outbound email ${job.data.messageId} (job ${job.id})`);
  }
}
