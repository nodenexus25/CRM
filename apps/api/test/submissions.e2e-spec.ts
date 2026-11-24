import {
  createApplication,
  createCandidate,
  createClient,
  createJob,
  createTenantScenario,
  createUser,
  TEST_PASSWORD,
  type TenantScenario,
} from './factories';
import { disconnectTestDatabases, getSystemPrisma, resetDatabase } from './utils/db';
import { createTestApp, type TestApp } from './utils/test-app';
import { TestHttpClient } from './utils/test-http';

/**
 * Submissions (Phase 3, Module 2).
 *
 * A submission rides on `Application`, so these specs exercise the client-facing
 * lifecycle on top of it: sending a candidate to a client (and advancing the
 * pipeline to the `SUBMISSION` stage), the client-facing status transitions,
 * recording feedback, and the workspace-wide `/submissions` list with its
 * filters and owner scoping.
 */

interface SubmissionListItemShape {
  id: string;
  submissionStatus: string;
  applicationStatus: string;
  job: { id: string; title: string; referenceCode: string };
  client: { id: string; name: string } | null;
  candidate: { id: string; fullName: string };
  stage: { id: string; name: string; color: string };
  owner: { id: string; fullName: string } | null;
  submittedAt: string | null;
  submittedBy: { id: string; fullName: string } | null;
  ageDays: number;
  hasFeedback: boolean;
}

interface SubmissionDetailShape extends SubmissionListItemShape {
  candidate: { id: string; fullName: string; avatarUrl: string | null; email: string | null };
  contact: { id: string; fullName: string; email: string | null; title: string | null } | null;
  resume: { id: string; fileName: string } | null;
  clientFeedback: string | null;
  clientFeedbackAt: string | null;
  events: { id: string; kind: string; subject: string; body: string | null }[];
}

interface PageShape<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number };
}

describe('Submissions (e2e)', () => {
  let testApp: TestApp;
  let http: TestHttpClient;
  let scenario: TenantScenario;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    scenario = await createTenantScenario();
    http = new TestHttpClient(testApp.server, testApp.prefix);
  });

  afterAll(async () => {
    await testApp.close();
    await disconnectTestDatabases();
  });

  function stageAt(index: number): string {
    const stageId = scenario.stages[index];
    if (!stageId) throw new Error(`The scenario has no stage at index ${index}`);
    return stageId;
  }

  function listSubmissions(query = ''): Promise<PageShape<SubmissionListItemShape>> {
    return http.get(`/submissions${query}`).then((response) => {
      expect(response.status).toBe(200);
      return response.body.data as PageShape<SubmissionListItemShape>;
    });
  }

  /** A client-linked job with a candidate on it — everything a submission needs. */
  async function seedSubmittable(options: { stageIndex?: number; ownerId?: string } = {}) {
    const client = await createClient(scenario.tenant.id, { name: 'Northwind Trading' });
    const job = await createJob(scenario.tenant.id, { clientId: client.id, status: 'OPEN' });
    const candidate = await createCandidate(scenario.tenant.id);
    const application = await createApplication({
      tenantId: scenario.tenant.id,
      jobId: job.id,
      candidateId: candidate.id,
      stageId: stageAt(options.stageIndex ?? 0),
      ownerId: options.ownerId,
    });
    return { client, job, candidate, application };
  }

  async function addContact(clientId: string, firstName = 'Dana', lastName = 'Lee') {
    return getSystemPrisma().clientContact.create({
      data: { tenantId: scenario.tenant.id, clientId, firstName, lastName, email: 'dana@globex.test' },
    });
  }

  /**
   * A user holding **only** `application:read_own`, which is what proves the
   * list really narrows to the caller's own applications.
   */
  async function createOwnScopeUser() {
    const prisma = getSystemPrisma();
    const tenantId = scenario.tenant.id;

    const user = await createUser({
      tenantId,
      email: 'submissions-own@example.test',
      firstName: 'Owen',
      lastName: 'Owner',
    });

    const permissions = await prisma.permission.findMany({
      where: { key: { in: ['application:read_own'] } },
      select: { id: true },
    });

    const role = await prisma.role.create({
      data: { tenantId, name: 'Submission own-scope', priority: 1, isSystem: false },
    });

    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({
        tenantId,
        roleId: role.id,
        permissionId: permission.id,
      })),
    });
    await prisma.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id } });

    return user;
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    it('lets a viewer read submissions but not submit, transition or give feedback', async () => {
      const { application } = await seedSubmittable();
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      expect((await http.get('/submissions')).status).toBe(200);
      expect((await http.get(`/applications/${application.id}/submission`)).status).toBe(200);
      expect((await http.post(`/applications/${application.id}/submit`, { body: {} })).status).toBe(403);
      expect(
        (await http.patch(`/applications/${application.id}/submission`, { body: { status: 'SHORTLISTED' } }))
          .status,
      ).toBe(403);
      expect(
        (await http.post(`/applications/${application.id}/submission/feedback`, { body: { feedback: 'No' } }))
          .status,
      ).toBe(403);
    });

    it('lets a recruiter submit a candidate and work the client status', async () => {
      const { application } = await seedSubmittable();
      await http.login(scenario.recruiter.email, TEST_PASSWORD);

      expect((await http.post(`/applications/${application.id}/submit`, { body: {} })).status).toBe(201);
      expect(
        (await http.patch(`/applications/${application.id}/submission`, { body: { status: 'SHORTLISTED' } }))
          .status,
      ).toBe(200);
      expect(
        (await http.post(`/applications/${application.id}/submission/feedback`, {
          body: { feedback: 'Strong profile, book a call.' },
        })).status,
      ).toBe(201);
    });

    it('returns 404 for a submission that does not exist', async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);

      expect((await http.get('/applications/does-not-exist/submission')).status).toBe(404);
      expect((await http.post('/applications/does-not-exist/submit', { body: {} })).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Submitting
  // ---------------------------------------------------------------------------

  describe('submit', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('stamps the submission, advances to the SUBMISSION stage and records the trail', async () => {
      const { application, client } = await seedSubmittable({ stageIndex: 0 });
      const contact = await addContact(client.id);

      const response = await http.post(`/applications/${application.id}/submit`, {
        body: { contactId: contact.id, note: 'Great fit for the platform team.' },
      });
      expect(response.status).toBe(201);

      const detail = response.body.data as SubmissionDetailShape;
      expect(detail.submissionStatus).toBe('SUBMITTED');
      expect(detail.submittedAt).not.toBeNull();
      expect(detail.submittedBy?.id).toBe(scenario.admin.id);
      expect(detail.stage.id).toBe(stageAt(2));
      expect(detail.stage.name).toBe('Submitted to client');
      expect(detail.contact?.id).toBe(contact.id);
      expect(detail.ageDays).toBe(0);

      // The pipeline move is written to the stage history…
      const history = await getSystemPrisma().stageHistory.findMany({
        where: { applicationId: application.id },
      });
      expect(history).toHaveLength(1);
      expect(history[0]?.toStageId).toBe(stageAt(2));

      // …and the submission itself is an activity on the timeline.
      const activity = await getSystemPrisma().activity.findFirst({
        where: { applicationId: application.id, type: 'SUBMISSION' },
      });
      expect(activity?.subject).toContain('Northwind Trading');
      expect(activity?.body).toBe('Great fit for the platform team.');
      expect(activity?.contactId).toBe(contact.id);

      expect(detail.events.some((event) => event.kind === 'SUBMITTED')).toBe(true);
    });

    it('does not move the application when it is already on the SUBMISSION stage', async () => {
      const { application } = await seedSubmittable({ stageIndex: 2 });

      const response = await http.post(`/applications/${application.id}/submit`, { body: {} });
      expect(response.status).toBe(201);

      expect((response.body.data as SubmissionDetailShape).stage.id).toBe(stageAt(2));
      const history = await getSystemPrisma().stageHistory.findMany({
        where: { applicationId: application.id },
      });
      expect(history).toHaveLength(0);
    });

    it('attaches a tailored résumé owned by the candidate', async () => {
      const { application, candidate } = await seedSubmittable();
      const resume = await getSystemPrisma().candidateResume.create({
        data: {
          tenantId: scenario.tenant.id,
          candidateId: candidate.id,
          fileName: 'casey-client.pdf',
          storageKey: 'resumes/casey-client.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 24_000,
        },
      });

      const response = await http.post(`/applications/${application.id}/submit`, {
        body: { resumeId: resume.id },
      });
      expect(response.status).toBe(201);
      expect((response.body.data as SubmissionDetailShape).resume?.fileName).toBe('casey-client.pdf');
    });

    it('refuses a résumé that belongs to another candidate', async () => {
      const { application } = await seedSubmittable();
      const stranger = await createCandidate(scenario.tenant.id);
      const foreign = await getSystemPrisma().candidateResume.create({
        data: {
          tenantId: scenario.tenant.id,
          candidateId: stranger.id,
          fileName: 'stranger.pdf',
          storageKey: 'resumes/stranger.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 10_000,
        },
      });

      const response = await http.post(`/applications/${application.id}/submit`, {
        body: { resumeId: foreign.id },
      });
      expect(response.status).toBe(422);
    });

    it('refuses a contact that belongs to a different client', async () => {
      const { application } = await seedSubmittable();
      const otherClient = await createClient(scenario.tenant.id, { name: 'Globex' });
      const foreignContact = await addContact(otherClient.id, 'Wrong', 'Client');

      const response = await http.post(`/applications/${application.id}/submit`, {
        body: { contactId: foreignContact.id },
      });
      expect(response.status).toBe(422);
    });

    it('rejects a second submission while the first is still open', async () => {
      const { application } = await seedSubmittable();

      expect((await http.post(`/applications/${application.id}/submit`, { body: {} })).status).toBe(201);
      const again = await http.post(`/applications/${application.id}/submit`, { body: {} });

      expect(again.status).toBe(409);
      expect(again.body.message).toContain('already');
    });

    it('allows re-submitting a candidate the client rejected', async () => {
      const { application } = await seedSubmittable();

      expect((await http.post(`/applications/${application.id}/submit`, { body: {} })).status).toBe(201);
      await getSystemPrisma().application.update({
        where: { id: application.id },
        data: { submissionStatus: 'REJECTED', clientFeedback: 'Not a fit' },
      });

      const resent = await http.post(`/applications/${application.id}/submit`, { body: {} });
      expect(resent.status).toBe(201);

      const detail = resent.body.data as SubmissionDetailShape;
      expect(detail.submissionStatus).toBe('SUBMITTED');
      // A fresh round clears the previous round's feedback.
      expect(detail.clientFeedback).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Client-facing status
  // ---------------------------------------------------------------------------

  describe('status transitions', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('moves the client status and logs it on the timeline', async () => {
      const { application } = await seedSubmittable();
      await http.post(`/applications/${application.id}/submit`, { body: {} });

      const response = await http.patch(`/applications/${application.id}/submission`, {
        body: { status: 'SHORTLISTED', note: 'Client wants a call.' },
      });
      expect(response.status).toBe(200);

      const detail = response.body.data as SubmissionDetailShape;
      expect(detail.submissionStatus).toBe('SHORTLISTED');
      expect(detail.applicationStatus).toBe('ACTIVE');
      expect(
        detail.events.some((event) => event.kind === 'STATUS' && event.subject.includes('Shortlisted')),
      ).toBe(true);
    });

    it('refuses to change the client status before the candidate has been sent', async () => {
      const { application } = await seedSubmittable();

      const response = await http.patch(`/applications/${application.id}/submission`, {
        body: { status: 'SHORTLISTED' },
      });
      expect(response.status).toBe(422);
    });

    it('treats a transition to the current status as a no-op', async () => {
      const { application } = await seedSubmittable();
      await http.post(`/applications/${application.id}/submit`, { body: {} });
      await http.patch(`/applications/${application.id}/submission`, {
        body: { status: 'SHORTLISTED' },
      });

      const response = await http.patch(`/applications/${application.id}/submission`, {
        body: { status: 'SHORTLISTED' },
      });
      expect(response.status).toBe(200);
      expect((response.body.data as SubmissionDetailShape).submissionStatus).toBe('SHORTLISTED');

      // A repeat of the same status must not add a second timeline entry.
      const events = await getSystemPrisma().activity.count({
        where: { applicationId: application.id, type: 'SUBMISSION' },
      });
      expect(events).toBe(2); // the submit itself, plus the one real transition
    });
  });

  // ---------------------------------------------------------------------------
  // Feedback
  // ---------------------------------------------------------------------------

  describe('feedback', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('stores the client feedback and classifies it as a FEEDBACK event', async () => {
      const { application } = await seedSubmittable();
      await http.post(`/applications/${application.id}/submit`, { body: {} });

      const response = await http.post(`/applications/${application.id}/submission/feedback`, {
        body: { feedback: 'Happy to interview — send availability.' },
      });
      expect(response.status).toBe(201);

      const detail = response.body.data as SubmissionDetailShape;
      expect(detail.clientFeedback).toBe('Happy to interview — send availability.');
      expect(detail.clientFeedbackAt).not.toBeNull();
      expect(detail.events.some((event) => event.kind === 'FEEDBACK')).toBe(true);
    });

    it('refuses feedback before the candidate has been sent', async () => {
      const { application } = await seedSubmittable();

      const response = await http.post(`/applications/${application.id}/submission/feedback`, {
        body: { feedback: 'Too early' },
      });
      expect(response.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  describe('list', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('shows only applications that have actually been sent', async () => {
      const { application: draft } = await seedSubmittable();
      const sent = await seedSubmittable();
      await http.post(`/applications/${sent.application.id}/submit`, { body: {} });

      const page = await listSubmissions();
      expect(page.meta.total).toBe(1);
      expect(page.items[0]?.id).toBe(sent.application.id);
      expect(page.items[0]?.id).not.toBe(draft.id);
      expect(page.items[0]?.submissionStatus).toBe('SUBMITTED');
      expect(page.items[0]?.client?.name).toBe('Northwind Trading');
    });

    it('filters by submission status, client, job and recruiter', async () => {
      const first = await seedSubmittable({ ownerId: scenario.recruiter.id });
      const second = await seedSubmittable();
      await http.post(`/applications/${first.application.id}/submit`, { body: {} });
      await http.post(`/applications/${second.application.id}/submit`, { body: {} });
      await http.patch(`/applications/${second.application.id}/submission`, {
        body: { status: 'SHORTLISTED' },
      });

      expect((await listSubmissions('?status=SHORTLISTED')).items[0]?.id).toBe(second.application.id);
      expect((await listSubmissions(`?clientId=${first.client.id}`)).items[0]?.id).toBe(
        first.application.id,
      );
      expect((await listSubmissions(`?jobId=${second.job.id}`)).items[0]?.id).toBe(second.application.id);
      expect((await listSubmissions(`?recruiterId=${scenario.recruiter.id}`)).items[0]?.id).toBe(
        first.application.id,
      );
    });

    it('filters by the date the submission went out', async () => {
      const { application } = await seedSubmittable();
      await http.post(`/applications/${application.id}/submit`, { body: {} });

      const future = new Date(Date.now() + 86_400_000).toISOString();
      expect((await listSubmissions(`?from=${future}`)).items).toHaveLength(0);
      expect((await listSubmissions(`?from=${future}`)).meta.total).toBe(0);
    });

    it('flags rows that already carry client feedback', async () => {
      const { application } = await seedSubmittable();
      await http.post(`/applications/${application.id}/submit`, { body: {} });
      await http.post(`/applications/${application.id}/submission/feedback`, {
        body: { feedback: 'Interested' },
      });

      expect((await listSubmissions()).items[0]?.hasFeedback).toBe(true);
    });

    it('narrows a read_own caller to the applications they own', async () => {
      const ownScope = await createOwnScopeUser();

      const mine = await seedSubmittable({ ownerId: ownScope.id });
      const theirs = await seedSubmittable({ ownerId: scenario.admin.id });
      await http.post(`/applications/${mine.application.id}/submit`, { body: {} });
      await http.post(`/applications/${theirs.application.id}/submit`, { body: {} });

      http.clearCookies();
      await http.login(ownScope.email, TEST_PASSWORD);

      const page = await listSubmissions();
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.id).toBe(mine.application.id);
    });

    it('keeps another workspace’s submissions invisible', async () => {
      const other = await createTenantScenario();
      const otherClient = await createClient(other.tenant.id);
      const otherJob = await createJob(other.tenant.id, { clientId: otherClient.id });
      const otherCandidate = await createCandidate(other.tenant.id);
      const foreign = await createApplication({
        tenantId: other.tenant.id,
        jobId: otherJob.id,
        candidateId: otherCandidate.id,
        stageId: other.stages[0] as string,
      });
      await getSystemPrisma().application.update({
        where: { id: foreign.id },
        data: { submissionStatus: 'SUBMITTED', submittedAt: new Date(), submittedById: other.admin.id },
      });

      expect((await listSubmissions()).items).toHaveLength(0);
      expect((await http.get(`/applications/${foreign.id}/submission`)).status).toBe(404);
    });
  });
});
