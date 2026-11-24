import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { QUEUE_NAMES, type ImportJobPayload } from '@/infra/queue/queue.constants';

import { ImportsService } from '../imports.service';

/**
 * CSV/Excel import worker (Phase 2, Module 7).
 *
 * Runs off the request path on the `import` queue. The service re-enters a
 * tenant `AsyncLocalStorage` context before touching the database, because a
 * worker has no HTTP request to inherit it from. Logs carry ids only — imported
 * rows hold candidate and contact PII and must never reach the logs.
 */
@Processor(QUEUE_NAMES.import)
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(private readonly imports: ImportsService) {
    super();
  }

  async process(job: Job<ImportJobPayload>): Promise<void> {
    await this.imports.runImport(job.data);
    this.logger.debug(`Handled import job for ${job.data.importJobId} (job ${job.id})`);
  }
}
