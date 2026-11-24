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
 * Pipeline configuration (Module 1).
 *
 * Covers the tenant-default stage set, the atomic reorder, the delete-with-move
 * contract and the per-job override, plus the rejection-reason catalogue.
 *
 * The stage list is intentionally not paginated — a pipeline is a small ordered
 * collection the Kanban board renders in full — so these tests assert ordering
 * rather than `meta`.
 */
describe('Pipeline (e2e)', () => {
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

  const DEFAULT_KEYS = [
    'sourced',
    'screening',
    'submitted',
    'client-review',
    'interview',
    'offer',
    'placed',
    'rejected',
    'withdrawn',
  ];

  interface StageItem {
    id: string;
    key: string;
    name: string;
    type: string;
    category: string;
    color: string;
    order: number;
    isDefault: boolean;
    isTerminal: boolean;
    slaDays: number | null;
    applicationCount: number;
  }

  async function listStages(): Promise<StageItem[]> {
    const response = await http.get('/pipeline/stages');
    expect(response.status).toBe(200);
    return response.body.data as StageItem[];
  }

  /** The scenario's default stages are a plain array; index access is optional. */
  function stageIdAt(index: number): string {
    const id = scenario.stages[index];
    if (!id) throw new Error(`The scenario has no default stage at index ${index}`);
    return id;
  }

  function stageAt(stages: StageItem[], index: number): StageItem {
    const stage = stages[index];
    if (!stage) throw new Error(`The pipeline has no stage at index ${index}`);
    return stage;
  }

  function reasonIdAt(index: number): string {
    const id = scenario.rejectionReasons[index];
    if (!id) throw new Error(`The scenario has no rejection reason at index ${index}`);
    return id;
  }

  describe('permissions', () => {
    it('lets a viewer read the pipeline but not change it', async () => {
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      expect((await http.get('/pipeline/stages')).status).toBe(200);
      expect(
        (await http.post('/pipeline/stages', {
          body: { key: 'extra', name: 'Extra', type: 'SCREENING' },
        })).status,
      ).toBe(403);
    });

    it('holds `pipeline:manage` back from a recruiter', async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);

      expect((await http.get('/pipeline/stages')).status).toBe(200);

      const response = await http.post('/pipeline/stages', {
        body: { key: 'extra', name: 'Extra', type: 'SCREENING' },
      });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /pipeline/stages', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('returns the workspace pipeline in order', async () => {
      const stages = await listStages();

      expect(stages.map((stage) => stage.key)).toEqual(DEFAULT_KEYS);
      expect(stages[0]).toMatchObject({ key: 'sourced', isDefault: true, category: 'ACTIVE' });
      expect(stages.find((stage) => stage.key === 'screening')?.slaDays).toBe(3);
      expect(stages.find((stage) => stage.key === 'placed')).toMatchObject({
        category: 'HIRED',
        isTerminal: true,
      });
    });
  });

  describe('stage CRUD', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('appends a new stage to the end of the pipeline', async () => {
      const response = await http.post('/pipeline/stages', {
        body: { key: 'reference-check', name: 'Reference check', type: 'SCREENING' },
      });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        key: 'reference-check',
        name: 'Reference check',
        category: 'ACTIVE',
        isTerminal: false,
        order: DEFAULT_KEYS.length,
        applicationCount: 0,
      });
    });

    it('refuses a duplicate key and a duplicate name', async () => {
      const duplicateKey = await http.post('/pipeline/stages', {
        body: { key: 'screening', name: 'Another screening', type: 'SCREENING' },
      });
      expect(duplicateKey.status).toBe(409);
      expect(duplicateKey.body.code).toBe('CONFLICT');

      const duplicateName = await http.post('/pipeline/stages', {
        body: { key: 'another-screening', name: 'Screening', type: 'SCREENING' },
      });
      expect(duplicateName.status).toBe(409);
    });

    it('renames and restyles a stage', async () => {
      const screening = (await listStages()).find((stage) => stage.key === 'screening')!;

      const response = await http.patch(`/pipeline/stages/${screening.id}`, {
        body: { name: 'Screening call', color: '#111827', slaDays: 5 },
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        name: 'Screening call',
        color: '#111827',
        slaDays: 5,
      });
    });

    it('marks a stage terminal when its category is no longer active', async () => {
      const screening = (await listStages()).find((stage) => stage.key === 'screening')!;

      const response = await http.patch(`/pipeline/stages/${screening.id}`, {
        body: { category: 'REJECTED' },
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ category: 'REJECTED', isTerminal: true });
    });

    it('keeps the intake stage active', async () => {
      const intake = stageAt(await listStages(), 0);

      const response = await http.patch(`/pipeline/stages/${intake.id}`, {
        body: { category: 'REJECTED' },
      });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('PUT /pipeline/stages/reorder', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('rewrites the order in one transaction', async () => {
      const before = await listStages();
      const payload = {
        stages: before.map((stage, index) => ({
          id: stage.id,
          order: before.length - 1 - index,
        })),
      };

      const response = await http.put('/pipeline/stages/reorder', { body: payload });

      expect(response.status).toBe(200);
      expect((response.body.data as StageItem[]).map((stage) => stage.id)).toEqual(
        [...before].reverse().map((stage) => stage.id),
      );
      expect((await listStages()).map((stage) => stage.id)).toEqual(
        [...before].reverse().map((stage) => stage.id),
      );
    });

    it('rejects a stage listed twice', async () => {
      const before = await listStages();
      const response = await http.put('/pipeline/stages/reorder', {
        body: {
          stages: [
            { id: stageAt(before, 0).id, order: 0 },
            { id: stageAt(before, 0).id, order: 1 },
          ],
        },
      });

      expect(response.status).toBe(422);
    });

    it('rejects a stage that is not in this workspace', async () => {
      const response = await http.put('/pipeline/stages/reorder', {
        body: { stages: [{ id: 'stage-from-another-workspace', order: 0 }] },
      });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('DELETE /pipeline/stages/:id', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('deletes a stage that nobody occupies', async () => {
      const created = await http.post('/pipeline/stages', {
        body: { key: 'reference-check', name: 'Reference check', type: 'SCREENING' },
      });

      const response = await http.delete(`/pipeline/stages/${created.body.data.id}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ deleted: true, movedApplications: 0 });
      expect((await listStages()).map((stage) => stage.key)).not.toContain('reference-check');
    });

    it('requires a destination once the stage holds applications', async () => {
      const [tenantId] = [scenario.tenant.id];
      const job = await createJob(tenantId);
      const candidate = await createCandidate(tenantId);
      await createApplication({
        tenantId,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: stageIdAt(1),
      });

      const blocked = await http.delete(`/pipeline/stages/${stageIdAt(1)}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('CONFLICT');
      expect(blocked.body.message).toContain('1 application');
    });

    it('moves applications and records stage history before retiring the stage', async () => {
      const tenantId = scenario.tenant.id;
      const job = await createJob(tenantId);
      const candidate = await createCandidate(tenantId);
      const application = await createApplication({
        tenantId,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: stageIdAt(1),
      });

      const response = await http.delete(
        `/pipeline/stages/${stageIdAt(1)}?moveToStageId=${stageIdAt(2)}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ deleted: true, movedApplications: 1 });

      const prisma = getSystemPrisma();
      const moved = await prisma.application.findUnique({ where: { id: application.id } });
      expect(moved?.stageId).toBe(stageIdAt(2));

      const history = await prisma.stageHistory.findMany({
        where: { applicationId: application.id },
      });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        fromStageId: stageIdAt(1),
        toStageId: stageIdAt(2),
      });

      // Soft-deleted, so the stage leaves the pipeline but the history row keeps
      // resolving the stage the candidate came from.
      expect((await listStages()).map((stage) => stage.key)).not.toContain('screening');
    });

    it('never deletes the intake stage', async () => {
      const intake = stageAt(await listStages(), 0);
      expect(intake.isDefault).toBe(true);

      const response = await http.delete(`/pipeline/stages/${intake.id}`);
      expect(response.status).toBe(422);
    });

    it('refuses a destination that is the stage being deleted', async () => {
      const tenantId = scenario.tenant.id;
      const job = await createJob(tenantId);
      const candidate = await createCandidate(tenantId);
      await createApplication({
        tenantId,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: stageIdAt(1),
      });

      const response = await http.delete(
        `/pipeline/stages/${stageIdAt(1)}?moveToStageId=${stageIdAt(1)}`,
      );
      expect(response.status).toBe(422);
    });
  });

  describe('PUT /jobs/:jobId/stages', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('materialises the workspace pipeline onto a job and applies the edit', async () => {
      const job = await createJob(scenario.tenant.id);
      const defaults = await listStages();

      const response = await http.put(`/jobs/${job.id}/stages`, {
        body: {
          stages: defaults.map((stage) => ({
            key: stage.key,
            name: stage.key === 'screening' ? 'Screening call' : stage.name,
            type: stage.type,
            category: stage.category,
            color: stage.color,
            slaDays: stage.slaDays,
            isTerminal: stage.isTerminal,
          })),
        },
      });

      expect(response.status).toBe(200);
      const stages = response.body.data as StageItem[];
      expect(stages).toHaveLength(DEFAULT_KEYS.length);
      expect(stages.find((stage) => stage.key === 'screening')?.name).toBe('Screening call');

      // The tenant default set is untouched — the job owns its own copy.
      const tenantStages = await getSystemPrisma().jobPipelineStage.findMany({
        where: { tenantId: scenario.tenant.id, jobId: null, deletedAt: null },
      });
      expect(tenantStages).toHaveLength(DEFAULT_KEYS.length);
      expect(tenantStages.find((stage) => stage.key === 'screening')?.name).toBe('Screening');
    });

    it('repoints an application onto the job copy of its stage', async () => {
      const tenantId = scenario.tenant.id;
      const job = await createJob(tenantId);
      const candidate = await createCandidate(tenantId);
      const application = await createApplication({
        tenantId,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: stageIdAt(1),
      });

      const defaults = await listStages();
      const response = await http.put(`/jobs/${job.id}/stages`, {
        body: {
          stages: defaults.map((stage) => ({
            key: stage.key,
            name: stage.name,
            type: stage.type,
            category: stage.category,
            color: stage.color,
          })),
        },
      });

      expect(response.status).toBe(200);
      const jobStages = response.body.data as StageItem[];
      const jobScreening = jobStages.find((stage) => stage.key === 'screening')!;
      expect(jobScreening.id).not.toBe(stageIdAt(1));

      const moved = await getSystemPrisma().application.findUnique({ where: { id: application.id } });
      expect(moved?.stageId).toBe(jobScreening.id);
    });

    it('blocks dropping a job stage that still holds applications', async () => {
      const tenantId = scenario.tenant.id;
      const job = await createJob(tenantId);
      const candidate = await createCandidate(tenantId);
      await createApplication({
        tenantId,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: stageIdAt(1),
      });

      const defaults = await listStages();
      const response = await http.put(`/jobs/${job.id}/stages`, {
        body: {
          stages: defaults
            .filter((stage) => stage.key !== 'screening')
            .map((stage) => ({
              key: stage.key,
              name: stage.name,
              type: stage.type,
              category: stage.category,
              color: stage.color,
            })),
        },
      });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CONFLICT');
    });

    it('rejects a stage id that belongs to another job', async () => {
      const job = await createJob(scenario.tenant.id);
      const other = await createJob(scenario.tenant.id);

      // Give the other job its own copy of the pipeline so the id is real but
      // does not belong to the job being edited.
      const defaults = await listStages();
      await http.put(`/jobs/${other.id}/stages`, {
        body: {
          stages: defaults.map((stage) => ({
            key: stage.key,
            name: stage.name,
            type: stage.type,
            category: stage.category,
            color: stage.color,
          })),
        },
      });
      const foreign = await getSystemPrisma().jobPipelineStage.findFirst({
        where: { jobId: other.id, key: 'screening' },
      });

      const response = await http.put(`/jobs/${job.id}/stages`, {
        body: {
          stages: [
            {
              id: foreign!.id,
              key: 'screening',
              name: 'Screening',
              type: 'SCREENING',
              category: 'ACTIVE',
              color: '#0ea5e9',
            },
          ],
        },
      });

      expect(response.status).toBe(422);
    });
  });

  describe('rejection reasons', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('lists the built-in reasons', async () => {
      const response = await http.get('/pipeline/rejection-reasons');

      expect(response.status).toBe(200);
      const reasons = response.body.data as { key: string; isSystem: boolean }[];
      expect(reasons).toHaveLength(scenario.rejectionReasons.length);
      expect(reasons.every((reason) => reason.isSystem)).toBe(true);
      expect(reasons[0]?.key).toBe('not-a-fit');
    });

    it('adds a custom reason and refuses a duplicate key', async () => {
      const created = await http.post('/pipeline/rejection-reasons', {
        body: { key: 'failed-background-check', label: 'Failed background check' },
      });

      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        key: 'failed-background-check',
        isSystem: false,
        isActive: true,
      });

      const duplicate = await http.post('/pipeline/rejection-reasons', {
        body: { key: 'failed-background-check', label: 'Duplicate' },
      });
      expect(duplicate.status).toBe(409);
    });

    it('protects built-in reasons from deletion but allows deactivating them', async () => {
      const systemReasonId = reasonIdAt(0);

      const deleted = await http.delete(`/pipeline/rejection-reasons/${systemReasonId}`);
      expect(deleted.status).toBe(422);

      const deactivated = await http.patch(`/pipeline/rejection-reasons/${systemReasonId}`, {
        body: { isActive: false },
      });
      expect(deactivated.status).toBe(200);

      const active = await http.get('/pipeline/rejection-reasons');
      expect((active.body.data as { id: string }[]).map((reason) => reason.id)).not.toContain(
        systemReasonId,
      );

      const all = await http.get('/pipeline/rejection-reasons?includeInactive=true');
      expect((all.body.data as { id: string }[]).map((reason) => reason.id)).toContain(
        systemReasonId,
      );
    });

    it('deletes a custom reason', async () => {
      const created = await http.post('/pipeline/rejection-reasons', {
        body: { key: 'no-show', label: 'No show' },
      });

      const response = await http.delete(`/pipeline/rejection-reasons/${created.body.data.id}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ deleted: true });
      const remaining = await http.get('/pipeline/rejection-reasons');
      expect((remaining.body.data as { key: string }[]).map((reason) => reason.key)).not.toContain(
        'no-show',
      );
    });

    it('404s for a reason that does not exist', async () => {
      const response = await http.patch('/pipeline/rejection-reasons/missing-reason', {
        body: { label: 'Whatever' },
      });
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });
  });
});
