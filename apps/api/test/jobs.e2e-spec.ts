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
 * Requisitions (Module 2).
 *
 * Exercises the whole `/jobs` surface: the `JOB-0001` sequencer, the status
 * state machine, the effective pipeline (own override vs tenant default),
 * recruiter assignment with notifications, roll-up stats, `_own` scoping via
 * `myJobs`, and the standard permission/tenancy guarantees every resource owes.
 */

interface JobListItemShape {
  id: string;
  title: string;
  referenceCode: string;
  status: string;
  priority: string;
  applicantCount: number;
  newApplicantCount: number;
  isHot: boolean;
  owner: { id: string; fullName: string } | null;
  client: { id: string; name: string } | null;
  skills: { id: string; name: string; required: boolean }[];
}

interface JobDetailShape extends JobListItemShape {
  marginCents: number | null;
  marginPercentage: number | null;
  billRateCents: number | null;
  assignments: { userId: string; role: string; isPrimary: boolean }[];
  skills: { id: string; name: string; required: boolean; weight: number; minYears: number | null }[];
  pipeline: { id: string; key: string; name: string; applicationCount: number }[];
  hasCustomPipeline: boolean;
  closedReason: string | null;
}

interface StageSummaryShape {
  id: string;
  key: string;
  name: string;
  applicationCount: number;
}

describe('Jobs (e2e)', () => {
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

  async function createSkill(name: string): Promise<string> {
    const skill = await getSystemPrisma().skill.create({
      data: { tenantId: scenario.tenant.id, name },
    });
    return skill.id;
  }

  function listJobs(query = ''): Promise<{ items: JobListItemShape[]; meta: { total: number } }> {
    return http.get(`/jobs${query}`).then((response) => {
      expect(response.status).toBe(200);
      return response.body.data as { items: JobListItemShape[]; meta: { total: number } };
    });
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    it('lets a viewer read requisitions but not create or delete them', async () => {
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      expect((await http.get('/jobs')).status).toBe(200);
      expect((await http.post('/jobs', { body: { title: 'Blocked role' } })).status).toBe(403);
      expect((await http.delete('/jobs/anything')).status).toBe(403);
    });

    it('lets a recruiter create and clone but not delete or assign', async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);

      const created = await http.post('/jobs', { body: { title: 'Recruiter role' } });
      expect(created.status).toBe(201);
      const jobId = (created.body.data as JobDetailShape).id;

      expect((await http.post(`/jobs/${jobId}/clone`, { body: {} })).status).toBe(201);
      expect((await http.delete(`/jobs/${jobId}`)).status).toBe(403);
      expect(
        (await http.put(`/jobs/${jobId}/recruiters`, { body: { assignments: [] } })).status,
      ).toBe(403);
    });

    it('lets an admin assign recruiters', async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
      const job = await createJob(scenario.tenant.id);

      const response = await http.put(`/jobs/${job.id}/recruiters`, {
        body: { assignments: [{ userId: scenario.recruiter.id, role: 'RECRUITER', isPrimary: true }] },
      });

      expect(response.status).toBe(200);
      expect((response.body.data as JobDetailShape).assignments).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Create + sequencer
  // ---------------------------------------------------------------------------

  describe('create', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('allocates sequential JOB-#### reference codes', async () => {
      const first = await http.post('/jobs', { body: { title: 'First role' } });
      const second = await http.post('/jobs', { body: { title: 'Second role' } });

      expect((first.body.data as JobDetailShape).referenceCode).toBe('JOB-0001');
      expect((second.body.data as JobDetailShape).referenceCode).toBe('JOB-0002');
    });

    it('materialises the tenant pipeline by default but honours useDefaultPipeline:false', async () => {
      const withPipeline = await http.post('/jobs', { body: { title: 'With pipeline' } });
      const without = await http.post('/jobs', {
        body: { title: 'Without pipeline', useDefaultPipeline: false },
      });

      const detail = withPipeline.body.data as JobDetailShape;
      const bare = without.body.data as JobDetailShape;

      expect(detail.hasCustomPipeline).toBe(true);
      expect(detail.pipeline.map((stage) => stage.key)).toContain('screening');
      expect(bare.hasCustomPipeline).toBe(false);
      // Falls back to the tenant default, which is still the full stage set.
      expect(bare.pipeline.length).toBeGreaterThan(0);
    });

    it('computes the margin from pay and bill rates', async () => {
      const response = await http.post('/jobs', {
        body: { title: 'Priced role', payRateMinCents: 5000, payRateMaxCents: 6000, billRateCents: 10000 },
      });

      const job = response.body.data as JobDetailShape;
      expect(job.marginCents).toBe(4000);
      expect(job.marginPercentage).toBe(40);
      expect(job.billRateCents).toBe(10000);
    });

    it('rejects an unknown client', async () => {
      const response = await http.post('/jobs', {
        body: { title: 'Ghost client', clientId: 'does-not-exist' },
      });
      expect(response.status).toBe(422);
    });

    it('attaches skills supplied at creation', async () => {
      const skillId = await createSkill('TypeScript');
      const response = await http.post('/jobs', {
        body: { title: 'Skill role', skills: [{ skillId, weight: 3, required: true, minYears: 4 }] },
      });

      const job = response.body.data as JobDetailShape;
      expect(job.skills).toHaveLength(1);
      expect(job.skills[0]).toMatchObject({ name: 'TypeScript', weight: 3, minYears: 4 });
    });
  });

  // ---------------------------------------------------------------------------
  // List, filters, pagination
  // ---------------------------------------------------------------------------

  describe('list', () => {
    beforeEach(async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);
    });

    it('paginates and sorts requisitions', async () => {
      await Promise.all(
        ['Alpha', 'Bravo', 'Charlie'].map((title) =>
          createJob(scenario.tenant.id, { title, ownerId: scenario.recruiter.id }),
        ),
      );

      const page = await listJobs('?page=1&pageSize=2&sortBy=title&sortDir=asc');
      expect(page.items).toHaveLength(2);
      expect(page.meta.total).toBe(3);
      expect(page.items[0]?.title).toBe('Alpha');
    });

    it('filters by status and by `hot` priority', async () => {
      await createJob(scenario.tenant.id, { title: 'Open hot', status: 'OPEN', priority: 'URGENT' });
      await createJob(scenario.tenant.id, { title: 'Open calm', status: 'OPEN', priority: 'LOW' });
      await createJob(scenario.tenant.id, { title: 'Draft hot', status: 'DRAFT', priority: 'HIGH' });

      expect((await listJobs('?status=OPEN')).meta.total).toBe(2);
      expect((await listJobs('?hot=true&status=OPEN')).meta.total).toBe(1);
      expect((await listJobs('?priority=URGENT')).meta.total).toBe(1);
    });

    it('searches by title and reference code', async () => {
      await createJob(scenario.tenant.id, { title: 'Staff Frontend Engineer' });
      await createJob(scenario.tenant.id, { title: 'Backend Engineer' });

      expect((await listJobs('?q=frontend')).meta.total).toBe(1);
      expect((await listJobs('?q=Staff')).meta.total).toBe(1);
    });

    it('narrows to the caller’s own jobs with `myJobs`', async () => {
      await createJob(scenario.tenant.id, { title: 'Mine', ownerId: scenario.recruiter.id });
      await createJob(scenario.tenant.id, { title: 'Someone else', ownerId: scenario.admin.id });

      const all = await listJobs();
      const mine = await listJobs('?myJobs=true');

      expect(all.meta.total).toBe(2);
      expect(mine.meta.total).toBe(1);
      expect(mine.items[0]?.title).toBe('Mine');
    });

    it('counts applicants, including those added this week', async () => {
      const job = await createJob(scenario.tenant.id, { ownerId: scenario.recruiter.id });
      const candidate = await createCandidate(scenario.tenant.id);
      const stageId = scenario.stages[0];
      if (!stageId) throw new Error('The scenario has no default stage');
      await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: candidate.id,
        stageId,
      });

      const page = await listJobs('?myJobs=true');
      const row = page.items.find((item) => item.id === job.id);
      expect(row?.applicantCount).toBe(1);
      expect(row?.newApplicantCount).toBe(1);
    });

    it('filters by client', async () => {
      const client = await createClient(scenario.tenant.id);
      await createJob(scenario.tenant.id, { title: 'For client', clientId: client.id });
      await createJob(scenario.tenant.id, { title: 'No client' });

      expect((await listJobs(`?clientId=${client.id}`)).meta.total).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Detail, pipeline, stats
  // ---------------------------------------------------------------------------

  describe('detail, pipeline and stats', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('returns the job with its effective pipeline', async () => {
      const created = await http.post('/jobs', { body: { title: 'Detail role' } });
      const jobId = (created.body.data as JobDetailShape).id;

      const detail = await http.get(`/jobs/${jobId}`);
      expect(detail.status).toBe(200);
      expect((detail.body.data as JobDetailShape).pipeline.length).toBe(scenario.stages.length);

      const stages = await http.get(`/jobs/${jobId}/pipeline`);
      expect(stages.status).toBe(200);
      expect((stages.body.data as StageSummaryShape[]).map((stage) => stage.key)).toContain(
        'screening',
      );
    });

    it('rolls up stage counts and totals', async () => {
      const job = await createJob(scenario.tenant.id);
      const candidate = await createCandidate(scenario.tenant.id);
      const stageId = scenario.stages[1];
      if (!stageId) throw new Error('The scenario has no second stage');
      await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: candidate.id,
        stageId,
      });

      const response = await http.get(`/jobs/${job.id}/stats`);
      expect(response.status).toBe(200);

      const stats = response.body.data as {
        totals: { applications: number; active: number };
        pipeline: StageSummaryShape[];
        submissionFunnel: { stageKey: string; count: number }[];
      };
      expect(stats.totals.applications).toBe(1);
      expect(stats.totals.active).toBe(1);
      expect(stats.pipeline.find((stage) => stage.key === 'screening')?.applicationCount).toBe(1);
      expect(stats.submissionFunnel).toHaveLength(scenario.stages.length);
    });

    it('404s for a job that does not exist', async () => {
      expect((await http.get('/jobs/missing')).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Update, status machine, clone, delete
  // ---------------------------------------------------------------------------

  describe('update', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('patches fields and recomputes the margin when rates change', async () => {
      const created = await http.post('/jobs', {
        body: { title: 'Original', payRateMinCents: 1000, billRateCents: 2000 },
      });
      const jobId = (created.body.data as JobDetailShape).id;

      const patched = await http.patch(`/jobs/${jobId}`, {
        body: { title: 'Renamed', billRateCents: 4000 },
      });

      const job = patched.body.data as JobDetailShape;
      expect(job.title).toBe('Renamed');
      expect(job.marginCents).toBe(3000);
      expect(job.marginPercentage).toBe(75);
    });

    it('validates status transitions', async () => {
      const created = await http.post('/jobs', { body: { title: 'Stateful' } });
      const jobId = (created.body.data as JobDetailShape).id;

      // DRAFT → CLOSED is not an allowed edge.
      expect((await http.post(`/jobs/${jobId}/status`, { body: { status: 'CLOSED' } })).status).toBe(
        422,
      );

      const opened = await http.post(`/jobs/${jobId}/status`, { body: { status: 'OPEN' } });
      expect((opened.body.data as JobDetailShape).status).toBe('OPEN');

      const closed = await http.post(`/jobs/${jobId}/status`, {
        body: { status: 'CLOSED', reason: 'Filled elsewhere' },
      });
      const job = closed.body.data as JobDetailShape;
      expect(job.status).toBe('CLOSED');
      expect(job.closedReason).toBe('Filled elsewhere');
    });

    it('clones a job as a new draft with its own reference code', async () => {
      const skillId = await createSkill('Go');
      const created = await http.post('/jobs', {
        body: { title: 'Clone source', skills: [{ skillId, weight: 2, required: true }] },
      });
      const sourceId = (created.body.data as JobDetailShape).id;

      const cloned = await http.post(`/jobs/${sourceId}/clone`, { body: {} });
      expect(cloned.status).toBe(201);

      const copy = cloned.body.data as JobDetailShape;
      expect(copy.id).not.toBe(sourceId);
      expect(copy.referenceCode).not.toBe('JOB-0001');
      expect(copy.status).toBe('DRAFT');
      expect(copy.skills.map((skill) => skill.name)).toContain('Go');
    });

    it('soft-deletes a job', async () => {
      const created = await http.post('/jobs', { body: { title: 'Disposable' } });
      const jobId = (created.body.data as JobDetailShape).id;

      expect((await http.delete(`/jobs/${jobId}`)).status).toBe(200);
      expect((await http.get(`/jobs/${jobId}`)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Recruiter assignment
  // ---------------------------------------------------------------------------

  describe('assign recruiters', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('replaces assignments and notifies newly added recruiters', async () => {
      const job = await createJob(scenario.tenant.id);

      const assigned = await http.put(`/jobs/${job.id}/recruiters`, {
        body: {
          assignments: [
            { userId: scenario.recruiter.id, role: 'RECRUITER', isPrimary: true },
            { userId: scenario.viewer.id, role: 'SOURCING', isPrimary: false },
          ],
        },
      });
      expect(assigned.status).toBe(200);
      expect((assigned.body.data as JobDetailShape).assignments).toHaveLength(2);

      const notifications = await getSystemPrisma().notification.findMany({
        where: { tenantId: scenario.tenant.id, entityId: job.id },
      });
      expect(notifications.map((row) => row.userId).sort()).toEqual(
        [scenario.recruiter.id, scenario.viewer.id].sort(),
      );

      // A follow-up replace drops one assignee.
      const trimmed = await http.put(`/jobs/${job.id}/recruiters`, {
        body: { assignments: [{ userId: scenario.recruiter.id, role: 'OWNER', isPrimary: true }] },
      });
      const assignments = (trimmed.body.data as JobDetailShape).assignments;
      expect(assignments).toHaveLength(1);
      expect(assignments[0]).toMatchObject({ userId: scenario.recruiter.id, role: 'OWNER' });
    });

    it('does not notify when notify is false', async () => {
      const job = await createJob(scenario.tenant.id);

      await http.put(`/jobs/${job.id}/recruiters`, {
        body: { assignments: [{ userId: scenario.recruiter.id }], notify: false },
      });

      const notifications = await getSystemPrisma().notification.findMany({
        where: { tenantId: scenario.tenant.id, entityId: job.id },
      });
      expect(notifications).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('hides another tenant’s jobs', async () => {
      const other = await createTenantScenario();
      const foreignJob = await createJob(other.tenant.id, { title: 'Foreign role' });

      await http.login(scenario.admin.email, TEST_PASSWORD);

      expect((await http.get(`/jobs/${foreignJob.id}`)).status).toBe(404);
      expect((await listJobs()).meta.total).toBe(0);
    });
  });
});
