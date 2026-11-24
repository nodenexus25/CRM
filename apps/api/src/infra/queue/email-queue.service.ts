import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { requestContext } from '@/common/request-context';

import { MailerService } from '../mail/mailer.service';
import { QUEUE_NAMES, type EmailJob, type EmailOutboundJob } from './queue.constants';

/** Retry policy shared by both email queues so delivery behaviour cannot drift. */
const EMAIL_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: 500,
  removeOnFail: 1_000,
};

/**
 * Producer for transactional email.
 *
 * Delivery is queued so a slow SMTP server never blocks a request. When Redis
 * is unavailable the message is sent inline and the failure is logged — a user
 * must still be able to verify their email.
 */
@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.email) private readonly queue: Queue<EmailJob>,
    @InjectQueue(QUEUE_NAMES.emailOutbound) private readonly outbound: Queue<EmailOutboundJob>,
    private readonly mailer: MailerService,
  ) {}

  async enqueue(job: EmailJob): Promise<void> {
    const context = requestContext.get();
    const payload: EmailJob = {
      ...job,
      tenantId: job.tenantId ?? context?.tenantId,
      requestedBy: job.requestedBy ?? context?.userId,
    };

    try {
      await this.queue.add(job.template, payload, EMAIL_JOB_OPTIONS);
    } catch (error) {
      this.logger.warn(
        `Queue unavailable, sending "${job.template}" inline: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.mailer.send({
        to: job.to,
        subject: job.subject,
        template: job.template,
        context: job.context,
        replyTo: job.replyTo,
      });
    }
  }

  /**
   * Queues the delivery of a tenant-composed message. There is deliberately no
   * inline fallback here: the worker is the only thing that knows how to move
   * the `EmailMessage` out of `QUEUED` (and into `SENT` or `FAILED`), so sending
   * it in the request would leave the row lying about what happened.
   */
  async enqueueOutbound(job: EmailOutboundJob): Promise<void> {
    await this.outbound.add('outbound', job, EMAIL_JOB_OPTIONS);
  }
}
