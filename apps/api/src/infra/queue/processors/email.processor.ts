import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { MailerService } from '../../mail/mailer.service';
import { QUEUE_NAMES, type EmailJob } from '../queue.constants';

@Processor(QUEUE_NAMES.email)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly mailer: MailerService) {
    super();
  }

  async process(job: Job<EmailJob>): Promise<void> {
    await this.mailer.send({
      to: job.data.to,
      subject: job.data.subject,
      template: job.data.template,
      context: job.data.context,
      replyTo: job.data.replyTo,
    });

    this.logger.debug(`Delivered "${job.data.template}" email (job ${job.id})`);
  }
}
