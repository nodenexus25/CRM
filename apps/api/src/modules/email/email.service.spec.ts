import type { AuditService } from '@/common/audit/audit.service';
import type { MailerService } from '@/infra/mail/mailer.service';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import type { EmailQueueService } from '@/infra/queue/email-queue.service';

import { EmailService } from './email.service';

/**
 * The outbound worker's retry safety. BullMQ retries any job that throws, so
 * these pin down the one rule that keeps a recipient from getting the same
 * email twice: only the SMTP hand-off may fail the job.
 */

const JOB = { tenantId: 'tenant-1', messageId: 'message-1', userId: 'user-1' };

function queuedMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB.messageId,
    status: 'QUEUED',
    toAddresses: ['to@example.test'],
    ccAddresses: [],
    bccAddresses: [],
    subject: 'Subject',
    bodyText: 'Body',
    bodyHtml: null,
    replyTo: null,
    ...overrides,
  };
}

function build(record: unknown) {
  const emailMessage = {
    findFirst: jest.fn().mockResolvedValue(record),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const mailer = { sendRaw: jest.fn().mockResolvedValue(undefined), fromAddress: 'no-reply@example.test' };
  const prisma = { client: { emailMessage } } as unknown as PrismaService;

  const service = new EmailService(
    prisma,
    {} as AuditService,
    mailer as unknown as MailerService,
    {} as EmailQueueService,
  );
  return { service, emailMessage, mailer };
}

describe('EmailService.runOutboundJob', () => {
  it('sends a queued message and marks it SENT', async () => {
    const { service, emailMessage, mailer } = build(queuedMessage());

    await service.runOutboundJob(JOB);

    expect(mailer.sendRaw).toHaveBeenCalledTimes(1);
    expect(mailer.sendRaw).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['to@example.test'], subject: 'Subject', text: 'Body' }),
    );
    expect(emailMessage.updateMany).toHaveBeenCalledWith({
      where: { id: JOB.messageId },
      data: expect.objectContaining({ status: 'SENT', error: null }),
    });
  });

  it('marks the message FAILED and rethrows when SMTP rejects, so BullMQ retries', async () => {
    const { service, emailMessage, mailer } = build(queuedMessage());
    mailer.sendRaw.mockRejectedValue(new Error('connection refused'));

    await expect(service.runOutboundJob(JOB)).rejects.toThrow('connection refused');
    expect(emailMessage.updateMany).toHaveBeenCalledWith({
      where: { id: JOB.messageId },
      data: { status: 'FAILED', error: 'connection refused' },
    });
  });

  it('does not throw (and so does not re-send) when recording SENT fails', async () => {
    const { service, emailMessage, mailer } = build(queuedMessage());
    emailMessage.updateMany.mockRejectedValue(new Error('database unavailable'));

    await expect(service.runOutboundJob(JOB)).resolves.toBeUndefined();
    expect(mailer.sendRaw).toHaveBeenCalledTimes(1);
  });

  it('skips a message that was already sent', async () => {
    const { service, emailMessage, mailer } = build(queuedMessage({ status: 'SENT' }));

    await service.runOutboundJob(JOB);

    expect(mailer.sendRaw).not.toHaveBeenCalled();
    expect(emailMessage.updateMany).not.toHaveBeenCalled();
  });

  it('retries a message that previously failed', async () => {
    const { service, mailer } = build(queuedMessage({ status: 'FAILED' }));

    await service.runOutboundJob(JOB);

    expect(mailer.sendRaw).toHaveBeenCalledTimes(1);
  });

  it('skips a message that no longer exists', async () => {
    const { service, mailer } = build(null);

    await service.runOutboundJob(JOB);

    expect(mailer.sendRaw).not.toHaveBeenCalled();
  });
});
