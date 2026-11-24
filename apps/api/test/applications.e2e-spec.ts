import {
  createApplication,
  createCandidate,
  createJob,
  createTenantScenario,
  TEST_PASSWORD,
  type TenantScenario,
} from './factories';
import { disconnectTestDatabases, getSystemPrisma, resetDatabase } from './utils/db';
import { createTestApp, type TestApp } from './utils/test-app';
import { TestHttpClient } from './utils/test-http';

/**
 * Applications (Module 3).
 *
 * Exercises the whole `/applications` surface and the job board: add-to-pipeline
 * with duplicate skipping, the Kanban board, the core stage-move operation (with
 * stage history, activity and rejection handling), reject/withdraw shortcuts,
 * soft/hard removal, the SLA `staleOnly` filter, and the standard permission and
 * tenancy guarantees every resource owes.
 */

interface ApplicationListItemShape {
  id: string;
  job: { id: string; title: string; referenceCode: string };
  candidate: { id: string; fullName: string };
  stage: { id: string; name: string; category: string };
  status: string;
  isRejected?: boolean;
  rejectedReason?: string | null;
  daysInStage: number;
  slaBreached: boolean;
}

interface ApplicationDetailShape extends ApplicationListItemShape {
  candidate: { id: string; fullName: string; avatarUrl: string | null; email: string | null };
  rejectedAt: string | null;
  history: { id: string; fromStage: { id: string } | null; toStage: { id: string } }[];
}

interface AddToPipelineShape {
  added: ApplicationDetailShape[];
  skipped: { candidateId: string; reason: string }[];
}

interface BoardShape {
  job: { id: string; title: string };
  columns: {
    stage: { id: string; key: string; category: string; slaDays: number | null };
    total: number;
    cards: { id: string; candidateId: string; stageId: string }[];
  }[];
}

interface StageHistoryRow {
  id: string;
  fromStage: { id: string; name: string } | null;
  toStage: { id: string; name: string };
  changedBy: { id: string; fullName: string } | null;
}

describe('Applications (e2e)', () => {
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

  function listApplications(
    query = '',
  ): Promise<{ items: ApplicationListItemShape[]; meta: { total: number } }> {
    return http.get(`/applications${query}`).then((response) => {
      expect(response.status).toBe(200);
      return response.body.data as { items: ApplicationListItemShape[]; meta: { total: number } };
    });
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    it('lets a viewer read applications but not create, move or delete them', async () => {
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      expect((await http.get('/applications')).status).toBe(200);
      expect(
        (await http.post('/applications', { body: { jobId: 'x', candidateIds: ['y'] } })).status,
      ).toBe(403);
      expect(
        (await http.post('/applications/anything/move', { body: { toStageId: 'z' } })).status,
      ).toBe(403);
      expect((await http.delete('/applications/anything')).status).toBe(403);
    });

    it('lets a recruiter add to the pipeline but not delete', async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);
      const job = await createJob(scenario.tenant.id);
      const candidate = await createCandidate(scenario.tenant.id);

      const created = await http.post('/applications', {
        body: { jobId: job.id, candidateIds: [candidate.id] },
      });
      expect(created.status).toBe(201);
      const applicationId = (created.body.data as AddToPipelineShape).added[0]?.id;
      if (!applicationId) throw new Error('The application was not created');

      expect((await http.delete(`/applications/${applicationId}`)).status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Add to pipeline
  // ---------------------------------------------------------------------------

  describe('add to pipeline', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('adds candidates to the first stage and skips duplicates on a re-add', async () => {
      const job = await createJob(scenario.tenant.id);
      const [first, second] = await Promise.all([
        createCandidate(scenario.tenant.id),
        createCandidate(scenario.tenant.id),
      ]);

      const created = await http.post('/applications', {
        body: { jobId: job.id, candidateIds: [first.id, second.id] },
      });
      expect(created.status).toBe(201);

      const result = created.body.data as AddToPipelineShape;
      expect(result.added).toHaveLength(2);
      expect(result.skipped).toHaveLength(0);
      expect(result.added.every((app) => app.stage.id === stageAt(0))).toBe(true);

      // Re-adding the same candidates reports them instead of failing.
      const again = await http.post('/applications', {
        body: { jobId: job.id, candidateIds: [first.id, second.id] },
      });
      const repeat = again.body.data as AddToPipelineShape;
      expect(repeat.added).toHaveLength(0);
      expect(repeat.skipped).toHaveLength(2);
      expect(repeat.skipped.every((entry) => entry.reason === 'Already in this pipeline')).toBe(true);
    });

    it('records an initial stage-history row and a SYSTEM activity', async () => {
      const job = await createJob(scenario.tenant.id);
      const candidate = await createCandidate(scenario.tenant.id);

      const created = await http.post('/applications', {
        body: { jobId: job.id, candidateIds: [candidate.id] },
      });
      const applicationId = (created.body.data as AddToPipelineShape).added[0]?.id;
      if (!applicationId) throw new Error('The application was not created');

      const history = await getSystemPrisma().stageHistory.findMany({ where: { applicationId } });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ fromStageId: null, toStageId: stageAt(0) });

      const activity = await getSystemPrisma().activity.findFirst({
        where: { applicationId, type: 'SYSTEM' },
      });
      expect(activity?.subject).toBe('Added to pipeline');
    });

    it('rejects an unknown job', async () => {
      const candidate = await createCandidate(scenario.tenant.id);
      const response = await http.post('/applications', {
        body: { jobId: 'does-not-exist', candidateIds: [candidate.id] },
      });
      expect(response.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Board
  // ---------------------------------------------------------------------------

  describe('board', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('renders one column per effective stage with the job’s cards', async () => {
      const job = await createJob(scenario.tenant.id);
      const candidate = await createCandidate(scenario.tenant.id);
      await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: stageAt(1),
      });

      const response = await http.get(`/jobs/${job.id}/board`);
      expect(response.status).toBe(200);

      const board = response.body.data as BoardShape;
      expect(board.job.id).toBe(job.id);
      expect(board.columns).toHaveLength(scenario.stages.length);

      const screening = board.columns.find((column) => column.stage.id === stageAt(1));
      expect(screening?.cards).toHaveLength(1);
      expect(screening?.cards[0]?.candidateId).toBe(candidate.id);
    });

    it('404s for a job that does not exist', async () => {
      expect((await http.get('/jobs/missing/board')).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Stage move (the core operation)
  // ---------------------------------------------------------------------------

  describe('move stage', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('moves the application, writes stage history, an activity and notifies the owner', async () => {
      const job = await createJob(scenario.tenant.id);
      const candidate = await createCandidate(scenario.tenant.id);
      const application = await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: stageAt(0),
        ownerId: scenario.recruiter.id,
      });

      const response = await http.post(`/applications/${application.id}/move`, {
        body: { toStageId: stageAt(1) },
      });
      expect(response.status).toBe(201);
      expect((response.body.data as ApplicationDetailShape).stage.id).toBe(stageAt(1));

      const history = await getSystemPrisma().stageHistory.findMany({
        where: { applicationId: application.id },
      });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ fromStageId: stageAt(0), toStageId: stageAt(1) });

      const activity = await getSystemPrisma().activity.findFirst({
        where: { applicationId: application.id, type: 'STAGE_CHANGE' },
      });
      expect(activity?.subject).toContain('Moved to');

      // The owner (a different user) is notified.
      const notification = await getSystemPrisma().notification.findFirst({
        where: { entityId: application.id, userId: scenario.recruiter.id },
      });
      expect(notification?.type).toBe('application.stage_changed');
    });

    it('requires a rejection reason when moving into a REJECTED stage', async () => {
      const job = await createJob(scenario.tenant.id);
      const candidate = await createCandidate(scenario.tenant.id);
      const application = await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: stageAt(0),
      });

      const missing = await http.post(`/applications/${application.id}/move`, {
        body: { toStageId: stageAt(7) },
      });
      expect(missing.status).toBe(422);

      const reasonId = scenario.rejectionReasons[0];
      if (!reasonId) throw new Error('The scenario has no rejection reasons');

      const rejected = await http.post(`/applications/${application.id}/move`, {
        body: { toStageId: stageAt(7), rejectionReasonId: reasonId },
      });
      expect(rejected.status).toBe(201);

      const detail = rejected.body.data as ApplicationDetailShape;
      expect(detail.status).toBe('REJECTED');
      expect(detail.rejectedReason).toBeTruthy();
      expect(detail.rejectedAt).not.toBeNull();
    });

    it('rejects a destination stage that is not on this job', async () => {
      const job = await createJob(scenario.tenant.id);
      const candidate = await createCandidate(scenario.tenant.id);
      const application = await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: stageAt(0),
      });

      const response = await http.post(`/applications/${application.id}/move`, {
        body: { toStageId: 'not-a-real-stage' },
      });
      expect(response.status).toBe(422);
    });

    it('rejects and withdraws through their shortcut endpoints', async () => {
      const job = await createJob(scenario.tenant.id);
      const candidate = await createCandidate(scenario.tenant.id);
      const application = await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: stageAt(0),
      });

      const reasonId = scenario.rejectionReasons[0];
      if (!reasonId) throw new Error('The scenario has no rejection reasons');

      const rejected = await http.post(`/applications/${application.id}/reject`, {
        body: { rejectionReasonId: reasonId },
      });
      expect(rejected.status).toBe(201);
      expect((rejected.body.data as ApplicationDetailShape).status).toBe('REJECTED');

      const withdrawn = await http.post(`/applications/${application.id}/withdraw`, {
        body: {},
      });
      expect(withdrawn.status).toBe(201);
      expect((withdrawn.body.data as ApplicationDetailShape).status).toBe('WITHDRAWN');
    });
  });

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  describe('history', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('returns stage history newest-first', async () => {
      const job = await createJob(scenario.tenant.id);
      const candidate = await createCandidate(scenario.tenant.id);
      const application = await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: stageAt(0),
      });

      await http.post(`/applications/${application.id}/move`, { body: { toStageId: stageAt(1) } });
      await http.post(`/applications/${application.id}/move`, { body: { toStageId: stageAt(2) } });

      const response = await http.get(`/applications/${application.id}/history`);
      expect(response.status).toBe(200);

      const history = response.body.data as StageHistoryRow[];
      expect(history).toHaveLength(2);
      expect(history[0]?.toStage.id).toBe(stageAt(2));
      expect(history[1]?.toStage.id).toBe(stageAt(1));
    });
  });

  // ---------------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------------

  describe('list filters', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('flags only applications that have breached their stage SLA', async () => {
      const job = await createJob(scenario.tenant.id);
      const [slow, fresh] = await Promise.all([
        createCandidate(scenario.tenant.id),
        createCandidate(scenario.tenant.id),
      ]);
      const stale = await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: slow.id,
        stageId: stageAt(1),
      });
      await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: fresh.id,
        stageId: stageAt(1),
      });

      // Push one application ten days into the past; the screening stage SLA is 3.
      const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
      await getSystemPrisma().application.update({
        where: { id: stale.id },
        data: { stageEnteredAt: tenDaysAgo },
      });

      const page = await listApplications('?staleOnly=true');
      expect(page.meta.total).toBe(1);
      expect(page.items[0]?.id).toBe(stale.id);
    });

    it('filters by job and by stage', async () => {
      const job = await createJob(scenario.tenant.id);
      const otherJob = await createJob(scenario.tenant.id);
      const candidate = await createCandidate(scenario.tenant.id);
      await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: stageAt(3),
      });

      expect((await listApplications(`?jobId=${job.id}`)).meta.total).toBe(1);
      expect((await listApplications(`?jobId=${otherJob.id}`)).meta.total).toBe(0);
      expect((await listApplications(`?stageId=${stageAt(3)}`)).meta.total).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Removal
  // ---------------------------------------------------------------------------

  describe('remove', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('soft-removes by default and hard-deletes when asked', async () => {
      const job = await createJob(scenario.tenant.id);
      const candidate = await createCandidate(scenario.tenant.id);
      const application = await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: stageAt(0),
      });

      expect((await http.delete(`/applications/${application.id}`)).status).toBe(200);

      const soft = await getSystemPrisma().application.findUnique({
        where: { id: application.id },
      });
      expect(soft?.deletedAt).not.toBeNull();
      expect(soft?.status).toBe('WITHDRAWN');

      const second = await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: (await createCandidate(scenario.tenant.id)).id,
        stageId: stageAt(0),
      });
      expect((await http.delete(`/applications/${second.id}?mode=HARD`)).status).toBe(200);

      const gone = await getSystemPrisma().application.findUnique({ where: { id: second.id } });
      expect(gone).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('hides another tenant’s applications', async () => {
      const other = await createTenantScenario();
      const foreignJob = await createJob(other.tenant.id);
      const foreignCandidate = await createCandidate(other.tenant.id);
      const foreignStage = other.stages[0];
      if (!foreignStage) throw new Error('The foreign scenario has no stages');
      const foreign = await createApplication({
        tenantId: other.tenant.id,
        jobId: foreignJob.id,
        candidateId: foreignCandidate.id,
        stageId: foreignStage,
      });

      await http.login(scenario.admin.email, TEST_PASSWORD);

      expect((await http.get(`/applications/${foreign.id}`)).status).toBe(404);
      expect((await listApplications()).meta.total).toBe(0);
    });
  });
});
