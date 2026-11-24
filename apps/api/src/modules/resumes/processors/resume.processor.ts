import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { QUEUE_NAMES, type ResumeParseJob } from '@/infra/queue/queue.constants';

import { ResumesService } from '../resumes.service';

/**
 * Resume parsing worker (Phase 2, Module 5).
 *
 * Runs off the request path on the `resume-parse` queue. The service re-enters a
 * tenant `AsyncLocalStorage` context before touching the database, because a
 * worker has no HTTP request to inherit it from. Logs carry ids only — resume
 * text and contact details are PII and must never reach the logs.
 */
@Processor(QUEUE_NAMES.resumeParse)
export class ResumeProcessor extends WorkerHost {
  private readonly logger = new Logger(ResumeProcessor.name);

  constructor(private readonly resumes: ResumesService) {
    super();
  }

  async process(job: Job<ResumeParseJob>): Promise<void> {
    await this.resumes.runParseJob(job.data);
    this.logger.debug(`Handled parse job for resume ${job.data.resumeId} (job ${job.id})`);
  }
}
