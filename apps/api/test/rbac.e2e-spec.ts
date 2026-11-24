import { createTenantScenario, TEST_PASSWORD, type TenantScenario } from './factories';
import { disconnectTestDatabases, resetDatabase } from './utils/db';
import { createTestApp, type TestApp } from './utils/test-app';
import { TestHttpClient } from './utils/test-http';

/**
 * Role-based access control.
 *
 * The three built-in roles used here span the spectrum: `TENANT_ADMIN` holds
 * every tenant permission, `RECRUITER` holds the operational set, and `VIEWER`
 * holds only read permissions. Asserting both the allowed *and* the refused
 * calls is what makes these tests worth having — a guard that returned `true`
 * unconditionally would fail the second half.
 */
describe('RBAC (e2e)', () => {
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

  describe('VIEWER', () => {
    beforeEach(async () => {
      await http.login(scenario.viewer.email, TEST_PASSWORD);
    });

    it('may read collections', async () => {
      const response = await http.get('/users');
      expect(response.status).toBe(200);
    });

    it('may not update a user', async () => {
      const response = await http.patch(`/users/${scenario.recruiter.id}`, {
        body: { firstName: 'Changed' },
      });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('may not invite a user', async () => {
      const response = await http.post('/users/invite', {
        body: {
          email: 'someone@example.test',
          firstName: 'Some',
          lastName: 'One',
          roleIds: [scenario.roles.get('VIEWER') as string],
        },
      });

      expect(response.status).toBe(403);
    });

    it('may not remove a user', async () => {
      const response = await http.delete(`/users/${scenario.recruiter.id}`);
      expect(response.status).toBe(403);
    });

    it('has no write permissions at all in its effective set', async () => {
      const response = await http.get('/users/me/permissions');

      expect(response.status).toBe(200);
      const permissions = response.body.data.permissions as string[];
      expect(permissions).toContain('user:read');
      expect(permissions).not.toContain('user:update');
      expect(permissions).not.toContain('user:delete');
      expect(permissions.some((key) => key.startsWith('platform:'))).toBe(false);
    });
  });

  describe('RECRUITER', () => {
    beforeEach(async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);
    });

    it('may read users and the workspace profile', async () => {
      expect((await http.get('/users')).status).toBe(200);
      expect((await http.get('/workspace')).status).toBe(200);
    });

    it('may not change roles or people — that is an admin action', async () => {
      expect((await http.get('/roles')).status).toBe(403);
      expect(
        (await http.patch(`/users/${scenario.viewer.id}`, { body: { firstName: 'Nope' } })).status,
      ).toBe(403);
      expect((await http.delete(`/users/${scenario.viewer.id}`)).status).toBe(403);
    });

    it('holds the operational permissions its template grants', async () => {
      const response = await http.get('/users/me/permissions');
      const permissions = response.body.data.permissions as string[];

      expect(permissions).toEqual(
        expect.arrayContaining(['job:create', 'job:clone', 'candidate:import', 'pipeline:read']),
      );
    });
  });

  describe('TENANT_ADMIN', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('may update a user', async () => {
      const response = await http.patch(`/users/${scenario.viewer.id}`, {
        body: { firstName: 'Updated' },
      });

      expect(response.status).toBe(200);
      expect(response.body.data.firstName).toBe('Updated');
    });

    it('may read roles and the audit-scoped user detail', async () => {
      expect((await http.get('/roles')).status).toBe(200);
      expect((await http.get(`/users/${scenario.viewer.id}`)).status).toBe(200);
    });

    it('holds every tenant permission but no platform permission', async () => {
      const response = await http.get('/users/me/permissions');
      const permissions = response.body.data.permissions as string[];

      expect(permissions).toContain('user:update');
      expect(permissions).toContain('role:manage');
      expect(permissions.some((key) => key.startsWith('platform:'))).toBe(false);
    });
  });
});
