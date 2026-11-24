import { createTenantScenario, TEST_PASSWORD, type TenantScenario } from './factories';
import { disconnectTestDatabases, resetDatabase } from './utils/db';
import { createTestApp, type TestApp } from './utils/test-app';
import { TestHttpClient } from './utils/test-http';

/**
 * Saved views (Module 4).
 *
 * Exercises `/saved-views`: the read/write permission split, the CRUD lifecycle,
 * owner-only edit/delete rules and the private-vs-shared visibility model.
 */

interface SavedViewShape {
  id: string;
  entity: string;
  name: string;
  filters: Record<string, unknown>;
  columns: string[];
  visibility: string;
  isDefault: boolean;
  ownerId: string | null;
  isOwn: boolean;
}

describe('Saved views (e2e)', () => {
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

  function listViews(query = ''): Promise<SavedViewShape[]> {
    return http.get(`/saved-views${query}`).then((response) => {
      expect(response.status).toBe(200);
      return response.body.data as SavedViewShape[];
    });
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    it('lets a viewer list views but not create them', async () => {
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      expect((await http.get('/saved-views')).status).toBe(200);
      expect(
        (await http.post('/saved-views', { body: { entity: 'JOB', name: 'Blocked' } })).status,
      ).toBe(403);
    });

    it('lets a recruiter create, update and delete their own views', async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);

      const created = await http.post('/saved-views', {
        body: { entity: 'JOB', name: 'My hot jobs', filters: { priority: 'HIGH' } },
      });
      expect(created.status).toBe(201);
      const view = created.body.data as SavedViewShape;

      const updated = await http.patch(`/saved-views/${view.id}`, { body: { name: 'Renamed' } });
      expect(updated.status).toBe(200);
      expect((updated.body.data as SavedViewShape).name).toBe('Renamed');

      expect((await http.delete(`/saved-views/${view.id}`)).status).toBe(200);
      expect(await listViews()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    beforeEach(async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);
    });

    it('persists the filter payload and marks the view as owned', async () => {
      const created = await http.post('/saved-views', {
        body: {
          entity: 'APPLICATION',
          name: 'Stale submissions',
          filters: { staleOnly: true },
          columns: ['candidate', 'stage'],
          sortBy: 'stageEnteredAt',
          sortDir: 'asc',
        },
      });

      const view = created.body.data as SavedViewShape;
      expect(view.filters).toEqual({ staleOnly: true });
      expect(view.columns).toEqual(['candidate', 'stage']);
      expect(view.ownerId).toBe(scenario.recruiter.id);
      expect(view.isOwn).toBe(true);
      expect(view.visibility).toBe('PRIVATE');
    });

    it('filters the list by entity', async () => {
      await http.post('/saved-views', { body: { entity: 'JOB', name: 'Jobs view' } });
      await http.post('/saved-views', { body: { entity: 'CANDIDATE', name: 'Candidates view' } });

      expect(await listViews()).toHaveLength(2);
      expect(await listViews('?entity=JOB')).toHaveLength(1);
    });

    it('rejects a duplicate name for the same entity', async () => {
      await http.post('/saved-views', { body: { entity: 'JOB', name: 'Duplicated' } });
      const second = await http.post('/saved-views', { body: { entity: 'JOB', name: 'Duplicated' } });
      expect(second.status).toBe(409);
    });
  });

  // ---------------------------------------------------------------------------
  // Ownership & sharing
  // ---------------------------------------------------------------------------

  describe('ownership', () => {
    it('keeps a private view invisible to other users and uneditable', async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);
      const created = await http.post('/saved-views', {
        body: { entity: 'JOB', name: 'Recruiter private' },
      });
      const view = created.body.data as SavedViewShape;

      await http.login(scenario.admin.email, TEST_PASSWORD);

      expect(await listViews()).toHaveLength(0);
      expect((await http.patch(`/saved-views/${view.id}`, { body: { name: 'Nope' } })).status).toBe(403);
      expect((await http.delete(`/saved-views/${view.id}`)).status).toBe(403);
    });

    it('shares a TENANT view with every member but keeps it read-only for others', async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);
      const created = await http.post('/saved-views', {
        body: { entity: 'JOB', name: 'Team hot jobs', visibility: 'TENANT' },
      });
      const view = created.body.data as SavedViewShape;

      await http.login(scenario.admin.email, TEST_PASSWORD);

      const views = await listViews();
      const shared = views.find((entry) => entry.id === view.id);
      expect(shared).toBeDefined();
      expect(shared?.isOwn).toBe(false);

      // The admin can read it but not mutate it.
      expect((await http.patch(`/saved-views/${view.id}`, { body: { name: 'Hijacked' } })).status).toBe(
        403,
      );
    });
  });
});
