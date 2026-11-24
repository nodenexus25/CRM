import { createCandidate, createTenantScenario, TEST_PASSWORD, type TenantScenario } from './factories';
import { disconnectTestDatabases, getRlsPrisma, resetDatabase } from './utils/db';
import { createTestApp, type TestApp } from './utils/test-app';
import { TestHttpClient } from './utils/test-http';

/**
 * Tenant isolation, all three layers.
 *
 *  1. Request context + guards decide which workspace a request runs in.
 *  2. The Prisma extension refuses to run a scoped query with no tenant.
 *  3. Postgres RLS returns nothing when `app.tenant_id` is unset.
 *
 * Layer 2 is checked through the application's own `PrismaService`; layer 3
 * through a separate connection that logs in as the non-owner, NOBYPASSRLS
 * role, so the policies genuinely bind.
 */
describe('Tenant isolation (e2e)', () => {
  let testApp: TestApp;
  let http: TestHttpClient;
  let alpha: TenantScenario;
  let beta: TenantScenario;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    alpha = await createTenantScenario({ name: 'Alpha Staffing' });
    beta = await createTenantScenario({ name: 'Beta Staffing' });
    http = new TestHttpClient(testApp.server, testApp.prefix);
  });

  afterAll(async () => {
    await testApp.close();
    await disconnectTestDatabases();
  });

  describe('across workspaces', () => {
    beforeEach(async () => {
      await http.login(alpha.admin.email, TEST_PASSWORD);
    });

    it('does not expose another workspace’s record by id', async () => {
      const response = await http.get(`/users/${beta.admin.id}`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('cannot update a record it cannot see', async () => {
      const response = await http.patch(`/users/${beta.admin.id}`, {
        body: { firstName: 'Hijacked' },
      });

      expect(response.status).toBe(404);
    });

    it('cannot delete a record from another workspace', async () => {
      const response = await http.delete(`/users/${beta.admin.id}`);

      expect(response.status).toBe(404);
    });

    it('lists only its own members', async () => {
      const response = await http.get('/users?pageSize=100');

      expect(response.status).toBe(200);
      const ids = (response.body.data.items as { id: string }[]).map((item) => item.id);
      expect(ids).toContain(alpha.admin.id);
      expect(ids).not.toContain(beta.admin.id);
      expect(response.body.data.meta.total).toBe(3);
    });

    it('scopes the workspace endpoint to the caller’s tenant', async () => {
      const response = await http.get('/workspace');

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(alpha.tenant.id);
      expect(response.body.data.name).toBe('Alpha Staffing');
    });
  });

  describe('without a tenant in context', () => {
    it('refuses a scoped query instead of returning every row', async () => {
      await createCandidate(alpha.tenant.id);
      await createCandidate(beta.tenant.id);

      // Outside a request there is no tenant, so the extension must fail loud
      // rather than silently widening the query to every workspace.
      await expect(testApp.prisma.client.candidate.findMany()).rejects.toThrow(
        /no tenant context/i,
      );
    });
  });

  describe('row level security', () => {
    it('returns zero rows when `app.tenant_id` is unset', async () => {
      await createCandidate(alpha.tenant.id);
      await createCandidate(beta.tenant.id);

      const rows = await getRlsPrisma().$queryRawUnsafe<{ id: string }[]>(
        'SELECT id FROM candidates',
      );

      expect(rows).toHaveLength(0);
    });

    it('returns only the scoped workspace’s rows once `app.tenant_id` is set', async () => {
      const alphaCandidate = await createCandidate(alpha.tenant.id);
      await createCandidate(beta.tenant.id);

      const rows = await getRlsPrisma().$transaction(async (tx) => {
        await tx.$queryRawUnsafe("SELECT set_config('app.tenant_id', $1, true)", alpha.tenant.id);
        return tx.$queryRawUnsafe<{ id: string }[]>('SELECT id FROM candidates');
      });

      expect(rows.map((row) => row.id)).toEqual([alphaCandidate.id]);
    });
  });
});
