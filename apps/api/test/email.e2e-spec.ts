import {
  createApplication,
  createCandidate,
  createClient,
  createJob,
  createTenantScenario,
  TEST_PASSWORD,
  type TenantScenario,
} from './factories';
import { disconnectTestDatabases, getSystemPrisma, resetDatabase } from './utils/db';
import { createTestApp, type TestApp } from './utils/test-app';
import { TestHttpClient } from './utils/test-http';

/**
 * Email (Phase 3, Module 6).
 *
 * Templates (CRUD, the system-template guard, the merge-field whitelist),
 * server-side merge previews, sending (the `EmailMessage` row, the queue hand-off
 * and the timeline `Activity`) and the outbound message log.
 *
 * Delivery itself runs on the `email-outbound` BullMQ worker, which races the
 * assertions — so a freshly sent message is asserted to be `QUEUED` *or* already
 * `SENT`, never `FAILED`.
 */

interface TemplateShape {
  id: string;
  name: string;
  key: string;
  subject: string;
  body: string;
  category: string;
  mergeFields: string[];
  isSystem: boolean;
  isActive: boolean;
}

interface PreviewShape {
  subject: string;
  body: string;
  missingFields: string[];
}

interface MessageShape {
  id: string;
  direction: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  bodyText: string | null;
  status: string;
  template: { id: string; name: string; key: string } | null;
  entityType: string | null;
  entityId: string | null;
  candidateId: string | null;
  jobId: string | null;
  createdBy: { id: string } | null;
}

interface PageShape<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number };
}

const OUTREACH = {
  name: 'Candidate outreach',
  key: 'candidate.outreach',
  subject: 'Hi {{candidate.firstName}} — {{job.title}} at {{client.name}}',
  body: 'Hello {{ candidate.fullName }},\n\nI think you would be great for {{job.title}}.\n\n{{sender.fullName}}\n{{tenant.name}}',
  category: 'SOURCING',
};

describe('Email (e2e)', () => {
  let testApp: TestApp;
  let http: TestHttpClient;
  let scenario: TenantScenario;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    scenario = await createTenantScenario({ name: 'Acme Talent' });
    http = new TestHttpClient(testApp.server, testApp.prefix);
    await http.login(scenario.admin.email, TEST_PASSWORD);
  });

  afterAll(async () => {
    await testApp.close();
    await disconnectTestDatabases();
  });

  async function signInAs(email: string): Promise<void> {
    http.clearCookies();
    const response = await http.login(email, TEST_PASSWORD);
    expect(response.status).toBe(200);
  }

  async function createTemplate(body: Record<string, unknown> = OUTREACH): Promise<TemplateShape> {
    const response = await http.post('/email/templates', { body });
    expect(response.status).toBe(201);
    return response.body.data as TemplateShape;
  }

  /** A candidate on a client-linked job — every merge group resolvable. */
  async function seedContext() {
    const client = await createClient(scenario.tenant.id, { name: 'Northwind Trading' });
    const job = await createJob(scenario.tenant.id, {
      clientId: client.id,
      status: 'OPEN',
      title: 'Staff Engineer',
    });
    const candidate = await createCandidate(scenario.tenant.id, { firstName: 'Priya', lastName: 'Shah' });
    return { client, job, candidate };
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    it('lets a recruiter read templates and send, but not manage templates', async () => {
      const template = await createTemplate();
      await signInAs(scenario.recruiter.email);

      expect((await http.get('/email/templates')).status).toBe(200);
      expect((await http.get('/email/messages')).status).toBe(200);
      expect((await http.post('/email/templates', { body: { ...OUTREACH, key: 'other' } })).status).toBe(403);
      expect((await http.patch(`/email/templates/${template.id}`, { body: { name: 'x' } })).status).toBe(403);
      expect((await http.delete(`/email/templates/${template.id}`)).status).toBe(403);

      const send = await http.post('/email/send', {
        body: { to: ['someone@example.test'], subject: 'Hello', body: 'Plain body' },
      });
      expect(send.status).toBe(201);
    });

    it('gives a viewer no email access at all', async () => {
      await signInAs(scenario.viewer.email);

      expect((await http.get('/email/templates')).status).toBe(403);
      expect((await http.get('/email/messages')).status).toBe(403);
      expect((await http.post('/email/preview', { body: { subject: 'x', body: 'y' } })).status).toBe(403);
      expect(
        (await http.post('/email/send', {
          body: { to: ['someone@example.test'], subject: 'x', body: 'y' },
        })).status,
      ).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  describe('templates', () => {
    it('creates a template and derives its merge fields from the copy', async () => {
      const template = await createTemplate();

      expect(template.key).toBe('candidate.outreach');
      expect(template.category).toBe('SOURCING');
      expect(template.isSystem).toBe(false);
      expect(template.isActive).toBe(true);
      expect(template.mergeFields).toEqual([
        'candidate.firstName',
        'job.title',
        'client.name',
        'candidate.fullName',
        'sender.fullName',
        'tenant.name',
      ]);
    });

    it('rejects an explicit merge field outside the whitelist', async () => {
      const response = await http.post('/email/templates', {
        body: { ...OUTREACH, mergeFields: ['candidate.firstName', 'candidate.salaryExpectation'] },
      });
      expect(response.status).toBe(422);
    });

    it('rejects a duplicate key with 409, even after the original is deleted', async () => {
      const template = await createTemplate();
      expect((await http.post('/email/templates', { body: OUTREACH })).status).toBe(409);

      await http.delete(`/email/templates/${template.id}`);
      expect((await http.post('/email/templates', { body: OUTREACH })).status).toBe(409);
    });

    it('rejects a malformed key', async () => {
      const response = await http.post('/email/templates', { body: { ...OUTREACH, key: 'Has Spaces!' } });
      expect(response.status).toBe(422);
    });

    it('updates a template but keeps its key immutable', async () => {
      const template = await createTemplate();

      const response = await http.patch(`/email/templates/${template.id}`, {
        body: { name: 'Warm outreach', isActive: false, key: 'renamed' },
      });
      expect(response.status).toBe(200);

      const updated = response.body.data as TemplateShape;
      expect(updated.name).toBe('Warm outreach');
      expect(updated.isActive).toBe(false);
      expect(updated.key).toBe('candidate.outreach');
    });

    it('filters by category and active flag', async () => {
      const sourcing = await createTemplate();
      const offer = await createTemplate({
        ...OUTREACH,
        key: 'offer.letter',
        name: 'Offer letter',
        category: 'OFFER',
      });
      await http.patch(`/email/templates/${offer.id}`, { body: { isActive: false } });

      const byCategory = (await http.get('/email/templates?category=SOURCING')).body.data as PageShape<TemplateShape>;
      expect(byCategory.items.map((item) => item.id)).toEqual([sourcing.id]);

      const active = (await http.get('/email/templates?isActive=true')).body.data as PageShape<TemplateShape>;
      expect(active.items.map((item) => item.id)).toEqual([sourcing.id]);
    });

    it('lets a system template be deactivated but never deleted', async () => {
      const system = await getSystemPrisma().emailTemplate.create({
        data: {
          tenantId: scenario.tenant.id,
          name: 'Interview invite',
          key: 'system.interview-invite',
          subject: 'Interview for {{job.title}}',
          body: 'See you at {{interview.scheduledStart}}',
          category: 'INTERVIEW',
          isSystem: true,
        },
      });

      expect((await http.delete(`/email/templates/${system.id}`)).status).toBe(409);

      const deactivate = await http.patch(`/email/templates/${system.id}`, { body: { isActive: false } });
      expect(deactivate.status).toBe(200);
      expect((deactivate.body.data as TemplateShape).isActive).toBe(false);
    });

    it('soft-deletes a custom template and 404s it afterwards', async () => {
      const template = await createTemplate();

      const response = await http.delete(`/email/templates/${template.id}`);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ deleted: true });

      expect((await http.patch(`/email/templates/${template.id}`, { body: { name: 'x' } })).status).toBe(404);
      const page = (await http.get('/email/templates')).body.data as PageShape<TemplateShape>;
      expect(page.meta.total).toBe(0);
    });

    it('keeps another workspace’s templates invisible', async () => {
      const other = await createTenantScenario();
      const foreign = await getSystemPrisma().emailTemplate.create({
        data: { tenantId: other.tenant.id, name: 'Foreign', key: 'foreign', subject: 's', body: 'b' },
      });

      const page = (await http.get('/email/templates')).body.data as PageShape<TemplateShape>;
      expect(page.items).toHaveLength(0);
      expect((await http.patch(`/email/templates/${foreign.id}`, { body: { name: 'x' } })).status).toBe(404);
      expect(
        (await http.post('/email/preview', { body: { templateId: foreign.id } })).status,
      ).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------

  describe('preview', () => {
    it('renders every merge group from the linked records', async () => {
      const { candidate, job } = await seedContext();
      const template = await createTemplate();

      const response = await http.post('/email/preview', {
        body: { templateId: template.id, entityType: 'CANDIDATE', entityId: candidate.id, jobId: job.id },
      });
      expect(response.status).toBe(201);

      const preview = response.body.data as PreviewShape;
      expect(preview.subject).toBe('Hi Priya — Staff Engineer at Northwind Trading');
      expect(preview.body).toContain('Hello Priya Shah,');
      expect(preview.body).toContain('Ada Admin');
      expect(preview.body).toContain('Acme Talent');
      expect(preview.missingFields).toEqual([]);
    });

    it('reports unresolved fields and lets mergeData fill them', async () => {
      const { candidate } = await seedContext();
      const body = 'Join at {{interview.meetingUrl}} — {{job.title}}';

      const bare = (await http.post('/email/preview', {
        body: { subject: 'Invite', body, entityType: 'CANDIDATE', entityId: candidate.id },
      })).body.data as PreviewShape;
      expect(bare.body).toBe('Join at  — ');
      expect(bare.missingFields).toEqual(['interview.meetingUrl', 'job.title']);

      const filled = (await http.post('/email/preview', {
        body: {
          subject: 'Invite',
          body,
          entityType: 'CANDIDATE',
          entityId: candidate.id,
          mergeData: { 'interview.meetingUrl': 'https://meet.example.test/abc' },
        },
      })).body.data as PreviewShape;
      expect(filled.body).toBe('Join at https://meet.example.test/abc — ');
      expect(filled.missingFields).toEqual(['job.title']);
    });

    it('never renders a key outside the whitelist, even when mergeData supplies it', async () => {
      const { candidate } = await seedContext();

      const preview = (await http.post('/email/preview', {
        body: {
          subject: 'x',
          body: 'Secret: [{{candidate.passwordHash}}] [{{tenant.id}}]',
          entityType: 'CANDIDATE',
          entityId: candidate.id,
          mergeData: { 'candidate.passwordHash': 'leaked', 'tenant.id': 'leaked' },
        },
      })).body.data as PreviewShape;

      expect(preview.body).toBe('Secret: [] []');
      // Unaddressable keys are dropped, not "missing".
      expect(preview.missingFields).toEqual([]);
    });

    it('resolves an interview’s candidate, job and slot from the interview alone', async () => {
      const { candidate, job } = await seedContext();
      const application = await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: scenario.stages[0] as string,
      });
      const scheduled = await http.post('/interviews', {
        body: {
          applicationId: application.id,
          scheduledStart: new Date(Date.now() + 86_400_000).toISOString(),
          meetingUrl: 'https://meet.example.test/xyz',
        },
      });
      expect(scheduled.status).toBe(201);
      const interviewId = (scheduled.body.data as { id: string }).id;

      const preview = (await http.post('/email/preview', {
        body: {
          subject: '{{candidate.firstName}} / {{job.title}}',
          body: '{{interview.meetingUrl}} {{interview.scheduledStart}}',
          entityType: 'INTERVIEW',
          entityId: interviewId,
        },
      })).body.data as PreviewShape;

      expect(preview.subject).toBe('Priya / Staff Engineer');
      expect(preview.body).toContain('https://meet.example.test/xyz');
      expect(preview.missingFields).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Send & message log
  // ---------------------------------------------------------------------------

  describe('send', () => {
    it('renders a template, stores the message, queues it and logs it on the timeline', async () => {
      const { candidate, job } = await seedContext();
      const template = await createTemplate();

      const response = await http.post('/email/send', {
        body: {
          to: [candidate.email],
          cc: ['manager@example.test'],
          templateId: template.id,
          entityType: 'CANDIDATE',
          entityId: candidate.id,
          candidateId: candidate.id,
          jobId: job.id,
        },
      });
      expect(response.status).toBe(201);

      const message = response.body.data as MessageShape;
      expect(message.direction).toBe('OUTBOUND');
      expect(message.subject).toBe('Hi Priya — Staff Engineer at Northwind Trading');
      expect(message.bodyText).toContain('Hello Priya Shah,');
      expect(message.toAddresses).toEqual([candidate.email]);
      expect(message.ccAddresses).toEqual(['manager@example.test']);
      expect(message.template?.id).toBe(template.id);
      expect(message.entityType).toBe('CANDIDATE');
      expect(message.entityId).toBe(candidate.id);
      expect(message.createdBy?.id).toBe(scenario.admin.id);
      expect(['QUEUED', 'SENT']).toContain(message.status);

      const activity = await getSystemPrisma().activity.findFirst({
        where: { emailMessageId: message.id },
      });
      expect(activity?.type).toBe('EMAIL');
      expect(activity?.direction).toBe('OUTBOUND');
      expect(activity?.entityType).toBe('CANDIDATE');
      expect(activity?.entityId).toBe(candidate.id);
      expect(activity?.candidateId).toBe(candidate.id);
      expect(activity?.jobId).toBe(job.id);
      expect(activity?.subject).toBe(message.subject);

      // The same entry is what the candidate timeline serves.
      const timeline = (await http.get(`/activities?entityType=CANDIDATE&entityId=${candidate.id}&type=EMAIL`))
        .body.data as PageShape<{ id: string }>;
      expect(timeline.items.map((item) => item.id)).toEqual([activity?.id]);
    });

    it('sends an ad-hoc message against a client', async () => {
      const { client } = await seedContext();

      const response = await http.post('/email/send', {
        body: {
          to: ['buyer@northwind.test'],
          subject: 'Catch-up about {{client.name}}',
          body: 'Thanks for the time today.',
          entityType: 'CLIENT',
          entityId: client.id,
        },
      });
      expect(response.status).toBe(201);

      const message = response.body.data as MessageShape;
      expect(message.subject).toBe('Catch-up about Northwind Trading');
      expect(message.template).toBeNull();

      const activity = await getSystemPrisma().activity.findFirst({ where: { emailMessageId: message.id } });
      expect(activity?.entityType).toBe('CLIENT');
      expect(activity?.entityId).toBe(client.id);
    });

    it('stores an unlinked message without inventing a timeline entry', async () => {
      const response = await http.post('/email/send', {
        body: { to: ['someone@example.test'], subject: 'Hi', body: 'Unlinked' },
      });
      expect(response.status).toBe(201);

      const message = response.body.data as MessageShape;
      expect(await getSystemPrisma().activity.count({ where: { emailMessageId: message.id } })).toBe(0);
    });

    it('validates the request before anything is stored', async () => {
      // Neither a template nor a full subject + body.
      expect(
        (await http.post('/email/send', { body: { to: ['a@example.test'], subject: 'Only a subject' } })).status,
      ).toBe(422);
      // No recipients.
      expect((await http.post('/email/send', { body: { to: [], subject: 's', body: 'b' } })).status).toBe(422);
      // A malformed recipient.
      expect(
        (await http.post('/email/send', { body: { to: ['not-an-email'], subject: 's', body: 'b' } })).status,
      ).toBe(422);
      // A template that does not exist.
      expect(
        (await http.post('/email/send', { body: { to: ['a@example.test'], templateId: 'ghost' } })).status,
      ).toBe(404);

      expect(await getSystemPrisma().emailMessage.count()).toBe(0);
    });
  });

  describe('message log', () => {
    it('lists messages newest first, filters by record and reads one back', async () => {
      const { candidate, client } = await seedContext();

      const first = (await http.post('/email/send', {
        body: { to: ['a@example.test'], subject: 'First', body: 'b', entityType: 'CANDIDATE', entityId: candidate.id },
      })).body.data as MessageShape;
      const second = (await http.post('/email/send', {
        body: { to: ['b@example.test'], subject: 'Second', body: 'b', entityType: 'CLIENT', entityId: client.id },
      })).body.data as MessageShape;

      const all = (await http.get('/email/messages')).body.data as PageShape<MessageShape>;
      expect(all.items.map((item) => item.id)).toEqual([second.id, first.id]);

      const forCandidate = (await http.get(`/email/messages?entityType=CANDIDATE&entityId=${candidate.id}`))
        .body.data as PageShape<MessageShape>;
      expect(forCandidate.items.map((item) => item.id)).toEqual([first.id]);

      const detail = await http.get(`/email/messages/${first.id}`);
      expect(detail.status).toBe(200);
      expect((detail.body.data as MessageShape).subject).toBe('First');

      expect((await http.get('/email/messages/does-not-exist')).status).toBe(404);
    });

    it('keeps another workspace’s messages invisible', async () => {
      const other = await createTenantScenario();
      const foreign = await getSystemPrisma().emailMessage.create({
        data: {
          tenantId: other.tenant.id,
          direction: 'OUTBOUND',
          fromAddress: 'no-reply@example.test',
          toAddresses: ['x@example.test'],
          subject: 'Foreign',
          status: 'SENT',
        },
      });

      const page = (await http.get('/email/messages')).body.data as PageShape<MessageShape>;
      expect(page.items).toHaveLength(0);
      expect((await http.get(`/email/messages/${foreign.id}`)).status).toBe(404);
    });
  });
});
