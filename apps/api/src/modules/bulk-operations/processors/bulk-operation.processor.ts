import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { QUEUE_NAMES, type BulkOperationJob } from '@/infra/queue/queue.constants';

import { BulkOperationsService } from '../bulk-operations.service';

/**
 * Bulk-action worker (Phase 2, Module 6).
 *
 * Runs off the request path on the `bulk` queue. The service re-enters a tenant
 * `AsyncLocalStorage` context before touching the database, because a worker has
 * no HTTP request to inherit it from. Logs carry ids only — a bulk run never
 * names the candidates it touched.
 */
@Processor(QUEUE_NAMES.bulk)
export class BulkOperationProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkOperationProcessor.name);

  constructor(private readonly bulk: BulkOperationsService) {
    super();
  }

  async process(job: Job<BulkOperationJob>): Promise<void> {
    await this.bulk.runBulkOperation(job.data);
    this.logger.debug(`Handled bulk job for operation ${job.data.bulkOperationId} (job ${job.id})`);
  }
}
