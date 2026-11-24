import {
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
 * Bulk actions (Phase 2, Module 6).
 *
 * Drives the two-step flow against real infrastructure: the request path
 * resolves the selection and persists a `PENDING` row, then the `bulk` worker
 * applies it in batches. Every case polls `GET /bulk-operations/:id` until the
 * run reaches a terminal state, which is exactly how the UI tracks progress —
 * so nothing about the queue or the worker is stubbed.
 */

interface BulkOperationShape {
  id: string;
  type: string;
  status: string;
  totalItems: number;
  processedItems: number;
  succeededItems: number;
  failedItems: number;
  progress: number;
  errors: { id: string; message: string }[];
  resultKey: string | null;
  createdBy: { id: string; fullName: string } | null;
}

interface CandidateItemShape {
  id: string;
  status: string;
  isArchived: boolean;
  tags: string[];
}

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED']);

/** Every bulk type with the smallest payload that passes validation. */
const MINIMAL_BODIES: Record<string, Record<string, unknown>> = {
  CANDIDATE_TAGS: { add: ['reviewed'], remove: [] },
  CANDIDATE_OWNER: { ownerId: null },
  CANDIDATE_STATUS: { status: 'ACTIVE' },
  CANDIDATE_ADD_TO_JOB: { jobId: 'job-placeholder' },
  CANDIDATE_ADD_TO_LIST: { listId: 'list-placeholder' },
  CANDIDATE_DELETE: {},
  CANDIDATE_EXPORT: { columns: [] },
  JOB_STATUS: { status: 'ON_HOLD' },
  JOB_PRIORITY: { priority: 'HIGH' },
  JOB_ASSIGN_RECRUITERS: { userIds: ['user-placeholder'] },
};

describe('Bulk operations (e2e)', () => {
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

  function asAdmin(): Promise<unknown> {
    return http.login(scenario.admin.email, TEST_PASSWORD);
  }

  async function createOperation(body: Record<string, unknown>): Promise<BulkOperationShape> {
    const response = await http.post('/bulk-operations', { body });
    expect(response.status).toBe(201);
    return response.body.data as BulkOperationShape;
  }

  /** Polls the detail endpoint until the worker reaches a terminal state. */
  async function waitForOperation(id: string): Promise<BulkOperationShape> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const response = await http.get(`/bulk-operations/${id}`);
      expect(response.status).toBe(200);
      const operation = response.body.data as BulkOperationShape;
      if (TERMINAL_STATUSES.has(operation.status)) return operation;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Bulk operation ${id} did not finish in time`);
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    it('refuses every bulk action for a viewer, even though it may read the workspace', async () => {
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      for (const [type, payload] of Object.entries(MINIMAL_BODIES)) {
        const response = await http.post('/bulk-operations', {
          body: { type, selection: { ids: ['placeholder-id'] }, payload },
        });
        expect({ type, status: response.status }).toEqual({ type, status: 403 });
      }
    });

    it('lets a recruiter tag candidates but not reassign recruiters on jobs', async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);

      const allowed = await http.post('/bulk-operations', {
        body: {
          type: 'CANDIDATE_TAGS',
          selection: { ids: ['placeholder-id'] },
          payload: { add: ['reviewed'] },
        },
      });
      expect(allowed.status).toBe(201);

      // RECRUITER holds `job:bulk_update` but not `job:assign`, so this exact
      // action is the one it must be refused.
      const refused = await http.post('/bulk-operations', {
        body: {
          type: 'JOB_ASSIGN_RECRUITERS',
          selection: { ids: ['placeholder-id'] },
          payload: { userIds: [scenario.recruiter.id] },
        },
      });
      expect(refused.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Candidate tags
  // ---------------------------------------------------------------------------

  describe('candidate tags', () => {
    beforeEach(asAdmin);

    it('applies added tags to an explicit id list and reports the run summary', async () => {
      const candidates = await Promise.all([
        createCandidate(scenario.tenant.id, { tags: ['existing'] }),
        createCandidate(scenario.tenant.id),
        createCandidate(scenario.tenant.id),
      ]);

      const created = await createOperation({
        type: 'CANDIDATE_TAGS',
        selection: { ids: candidates.map((candidate) => candidate.id) },
        payload: { add: ['vip'], remove: ['existing'] },
      });

      expect(created.status).toBe('PENDING');
      expect(created.totalItems).toBe(3);

      const finished = await waitForOperation(created.id);
      expect(finished.status).toBe('COMPLETED');
      expect(finished.totalItems).toBe(3);
      expect(finished.processedItems).toBe(3);
      expect(finished.succeededItems).toBe(3);
      expect(finished.failedItems).toBe(0);
      expect(finished.progress).toBe(100);
      expect(finished.createdBy?.id).toBe(scenario.admin.id);

      const rows = await getSystemPrisma().candidate.findMany({
        where: { id: { in: candidates.map((candidate) => candidate.id) } },
        orderBy: { id: 'asc' },
      });
      for (const row of rows) expect(row.tags).toContain('vip');
      expect(rows.find((row) => row.id === candidates[0].id)?.tags).not.toContain('existing');
    });
  });

  // ---------------------------------------------------------------------------
  // Uniform candidate updates
  // ---------------------------------------------------------------------------

  describe('candidate owner and status', () => {
    beforeEach(asAdmin);

    it('reassigns the owner of many candidates at once', async () => {
      const candidates = await Promise.all([
        createCandidate(scenario.tenant.id),
        createCandidate(scenario.tenant.id),
      ]);

      const created = await createOperation({
        type: 'CANDIDATE_OWNER',
        selection: { ids: candidates.map((candidate) => candidate.id) },
        payload: { ownerId: scenario.recruiter.id },
      });
      const finished = await waitForOperation(created.id);

      expect(finished.status).toBe('COMPLETED');
      expect(finished.succeededItems).toBe(2);

      const rows = await getSystemPrisma().candidate.findMany({
        where: { id: { in: candidates.map((candidate) => candidate.id) } },
      });
      for (const row of rows) expect(row.ownerId).toBe(scenario.recruiter.id);
    });

    it('changes candidate status without archiving them', async () => {
      const candidates = await Promise.all([
        createCandidate(scenario.tenant.id),
        createCandidate(scenario.tenant.id),
      ]);

      const created = await createOperation({
        type: 'CANDIDATE_STATUS',
        selection: { ids: candidates.map((candidate) => candidate.id) },
        payload: { status: 'PASSIVE' },
      });
      const finished = await waitForOperation(created.id);

      expect(finished.status).toBe('COMPLETED');
      expect(finished.succeededItems).toBe(2);

      const rows = await getSystemPrisma().candidate.findMany({
        where: { id: { in: candidates.map((candidate) => candidate.id) } },
      });
      for (const row of rows) {
        expect(row.status).toBe('PASSIVE');
        expect(row.isArchived).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Job operations
  // ---------------------------------------------------------------------------

  describe('job operations', () => {
    beforeEach(asAdmin);

    it('changes job priority for many jobs at once', async () => {
      const jobs = await Promise.all([
        createJob(scenario.tenant.id),
        createJob(scenario.tenant.id),
      ]);

      const created = await createOperation({
        type: 'JOB_PRIORITY',
        selection: { ids: jobs.map((job) => job.id) },
        payload: { priority: 'URGENT' },
      });
      const finished = await waitForOperation(created.id);

      expect(finished.status).toBe('COMPLETED');
      expect(finished.succeededItems).toBe(2);

      const rows = await getSystemPrisma().job.findMany({
        where: { id: { in: jobs.map((job) => job.id) } },
      });
      for (const row of rows) expect(row.priority).toBe('URGENT');
    });

    it('closes jobs and records the supplied reason', async () => {
      const jobs = await Promise.all([
        createJob(scenario.tenant.id, { status: 'OPEN' }),
        createJob(scenario.tenant.id, { status: 'OPEN' }),
      ]);

      const created = await createOperation({
        type: 'JOB_STATUS',
        selection: { ids: jobs.map((job) => job.id) },
        payload: { status: 'CLOSED', reason: 'Filled internally' },
      });
      const finished = await waitForOperation(created.id);

      expect(finished.status).toBe('COMPLETED');
      expect(finished.succeededItems).toBe(2);

      const rows = await getSystemPrisma().job.findMany({
        where: { id: { in: jobs.map((job) => job.id) } },
      });
      for (const row of rows) {
        expect(row.status).toBe('CLOSED');
        expect(row.closedReason).toBe('Filled internally');
        expect(row.closedAt).not.toBeNull();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Add to pipeline
  // ---------------------------------------------------------------------------

  describe('add to job', () => {
    beforeEach(asAdmin);

    it('adds many candidates to a job pipeline, defaulting to the first stage', async () => {
      const job = await createJob(scenario.tenant.id);
      const candidates = await Promise.all([
        createCandidate(scenario.tenant.id),
        createCandidate(scenario.tenant.id),
      ]);

      const created = await createOperation({
        type: 'CANDIDATE_ADD_TO_JOB',
        selection: { ids: candidates.map((candidate) => candidate.id) },
        payload: { jobId: job.id },
      });
      const finished = await waitForOperation(created.id);

      expect(finished.status).toBe('COMPLETED');
      expect(finished.succeededItems).toBe(2);

      const applications = await getSystemPrisma().application.findMany({ where: { jobId: job.id } });
      expect(applications).toHaveLength(2);
      expect(applications.map((application) => application.stageId)).toEqual(
        applications.map(() => scenario.stages[0]),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Filter-based selection
  // ---------------------------------------------------------------------------

  describe('filter-based selection', () => {
    beforeEach(asAdmin);

    it('resolves "select all matching" server-side and matches the list count', async () => {
      await Promise.all([
        createCandidate(scenario.tenant.id, { status: 'ACTIVE' }),
        createCandidate(scenario.tenant.id, { status: 'ACTIVE' }),
        createCandidate(scenario.tenant.id, { status: 'ACTIVE' }),
        createCandidate(scenario.tenant.id, { status: 'PASSIVE' }),
      ]);

      const list = await http.get('/candidates?status=ACTIVE');
      expect(list.status).toBe(200);
      const listTotal = (list.body.data as { meta: { total: number } }).meta.total;
      expect(listTotal).toBe(3);

      const created = await createOperation({
        type: 'CANDIDATE_TAGS',
        selection: { all: true, filters: { status: 'ACTIVE' } },
        payload: { add: ['matching'] },
      });
      expect(created.totalItems).toBe(listTotal);

      const finished = await waitForOperation(created.id);
      expect(finished.status).toBe('COMPLETED');
      expect(finished.totalItems).toBe(3);
      expect(finished.succeededItems).toBe(3);

      const tagged = await getSystemPrisma().candidate.count({
        where: { tenantId: scenario.tenant.id, tags: { has: 'matching' } },
      });
      expect(tagged).toBe(3);
    });

    it('rejects a filter that matches nothing', async () => {
      const response = await http.post('/bulk-operations', {
        body: {
          type: 'CANDIDATE_TAGS',
          selection: { all: true, filters: { q: 'zzz-nothing-will-match' } },
          payload: { add: ['x'] },
        },
      });
      expect(response.status).toBe(422);
      expect(response.body.message).toContain('Nothing matched');
    });
  });

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  describe('export', () => {
    beforeEach(asAdmin);

    it('writes a CSV to storage and returns a download link', async () => {
      const candidates = await Promise.all([
        createCandidate(scenario.tenant.id, { firstName: 'Ada', email: 'ada@example.test' }),
        createCandidate(scenario.tenant.id, { firstName: 'Grace', email: 'grace@example.test' }),
      ]);

      const created = await createOperation({
        type: 'CANDIDATE_EXPORT',
        selection: { ids: candidates.map((candidate) => candidate.id) },
        payload: { columns: ['firstName', 'email'] },
      });
      const finished = await waitForOperation(created.id);

      expect(finished.status).toBe('COMPLETED');
      expect(finished.succeededItems).toBe(2);
      expect(finished.resultKey).toBeTruthy();

      const result = await http.get(`/bulk-operations/${created.id}/result`);
      expect(result.status).toBe(200);
      const downloadUrl = (result.body.data as { downloadUrl: string }).downloadUrl;
      expect(downloadUrl).toContain('http');

      const csv = await fetch(downloadUrl).then((response) => response.text());
      const lines = csv.trimEnd().split('\r\n');
      expect(lines[0]).toBe('First name,Email');
      expect(lines).toHaveLength(3);
      expect(csv).toContain('ada@example.test');
    });
  });

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  describe('delete', () => {
    beforeEach(asAdmin);

    it('soft-deletes candidates and removes them from list responses', async () => {
      const candidates = await Promise.all([
        createCandidate(scenario.tenant.id),
        createCandidate(scenario.tenant.id),
      ]);
      const kept = await createCandidate(scenario.tenant.id);

      const created = await createOperation({
        type: 'CANDIDATE_DELETE',
        selection: { ids: candidates.map((candidate) => candidate.id) },
        payload: {},
      });
      const finished = await waitForOperation(created.id);
      expect(finished.status).toBe('COMPLETED');
      expect(finished.succeededItems).toBe(2);

      const rows = await getSystemPrisma().candidate.findMany({
        where: { id: { in: candidates.map((candidate) => candidate.id) } },
      });
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.deletedAt).not.toBeNull();

      const list = await http.get('/candidates');
      const items = (list.body.data as { items: CandidateItemShape[] }).items;
      expect(items.map((item) => item.id)).toEqual([kept.id]);
      expect((list.body.data as { meta: { total: number } }).meta.total).toBe(1);

      expect((await http.get(`/candidates/${candidates[0].id}`)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('skips a foreign id, records it as a failure and never touches the other workspace', async () => {
      const other = await createTenantScenario();
      const foreign = await createCandidate(other.tenant.id, { tags: ['untouched'] });
      const own = await createCandidate(scenario.tenant.id);

      await asAdmin();
      const created = await createOperation({
        type: 'CANDIDATE_TAGS',
        selection: { ids: [own.id, foreign.id] },
        payload: { add: ['reviewed'] },
      });

      const finished = await waitForOperation(created.id);
      expect(finished.status).toBe('COMPLETED');
      expect(finished.totalItems).toBe(2);
      expect(finished.succeededItems).toBe(1);
      expect(finished.failedItems).toBe(1);
      expect(finished.errors.map((error) => error.id)).toContain(foreign.id);

      const ownRow = await getSystemPrisma().candidate.findUnique({ where: { id: own.id } });
      expect(ownRow?.tags).toContain('reviewed');

      const foreignRow = await getSystemPrisma().candidate.findUnique({ where: { id: foreign.id } });
      expect(foreignRow?.tags).toEqual(['untouched']);
    });
  });

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  describe('history', () => {
    beforeEach(asAdmin);

    it('lists operations with progress and removes a finished one', async () => {
      const candidate = await createCandidate(scenario.tenant.id);
      const created = await createOperation({
        type: 'CANDIDATE_TAGS',
        selection: { ids: [candidate.id] },
        payload: { add: ['reviewed'] },
      });
      await waitForOperation(created.id);

      const list = await http.get('/bulk-operations?type=CANDIDATE_TAGS&status=COMPLETED');
      expect(list.status).toBe(200);
      const body = list.body.data as { items: BulkOperationShape[]; meta: { total: number } };
      expect(body.meta.total).toBe(1);
      expect(body.items[0]?.id).toBe(created.id);
      expect(body.items[0]?.progress).toBe(100);
      expect(body.items[0]?.createdBy?.id).toBe(scenario.admin.id);

      const removed = await http.delete(`/bulk-operations/${created.id}`);
      expect(removed.status).toBe(200);
      expect((removed.body.data as { deleted: boolean }).deleted).toBe(true);

      expect((await http.get(`/bulk-operations/${created.id}`)).status).toBe(404);
      const after = await http.get('/bulk-operations');
      expect((after.body.data as { meta: { total: number } }).meta.total).toBe(0);
    });

    it('refuses to remove an operation that is still active', async () => {
      const base = {
        tenantId: scenario.tenant.id,
        type: 'CANDIDATE_TAGS' as const,
        createdById: scenario.admin.id,
      };

      const pending = await getSystemPrisma().bulkOperation.create({
        data: { ...base, status: 'PENDING' },
      });
      const processing = await getSystemPrisma().bulkOperation.create({
        data: { ...base, status: 'PROCESSING' },
      });

      expect((await http.delete(`/bulk-operations/${pending.id}`)).status).toBe(409);
      expect((await http.delete(`/bulk-operations/${processing.id}`)).status).toBe(409);
    });

    it('returns 404 for an operation that belongs to another workspace', async () => {
      const other = await createTenantScenario();
      const foreign = await getSystemPrisma().bulkOperation.create({
        data: {
          tenantId: other.tenant.id,
          type: 'CANDIDATE_TAGS',
          status: 'COMPLETED',
          createdById: other.admin.id,
        },
      });

      await asAdmin();
      expect((await http.get(`/bulk-operations/${foreign.id}`)).status).toBe(404);
      expect((await http.delete(`/bulk-operations/${foreign.id}`)).status).toBe(404);
    });
  });
});
