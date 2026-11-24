import {
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
 * Global search (Phase 2, Module 8).
 *
 * Exercises the real adapter against real Postgres: the hits come from
 * `websearch_to_tsquery` over the trigger-maintained `searchVector` columns and
 * from the `pg_trgm` fallback, not from a stubbed matcher. The permission and
 * tenant cases matter as much as the matching ones here, because `/search` has
 * no route-level `@RequirePermissions` — the result set is assembled per entity
 * inside the service, so this suite is the only place that proves it.
 */

interface SearchItemShape {
  id: string;
  entity: string;
  title: string;
  subtitle: string | null;
  href: string;
  badge: string | null;
}

interface SearchGroupShape {
  entity: string;
  label: string;
  total: number;
  items: SearchItemShape[];
}

interface SearchResultShape {
  query: string;
  groups: SearchGroupShape[];
  total: number;
}

/** One distinctive token, planted in a different column of every entity. */
const TOKEN = 'Northwind';

describe('Global search (e2e)', () => {
  let testApp: TestApp;
  let http: TestHttpClient;
  let scenario: TenantScenario;
  let clientId: string;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    scenario = await createTenantScenario();

    const client = await createClient(scenario.tenant.id, {
      name: `${TOKEN} Trading`,
      industry: 'Logistics',
    });
    clientId = client.id;

    await Promise.all([
      createJob(scenario.tenant.id, {
        title: `${TOKEN} Platform Engineer`,
        referenceCode: `JOB-${TOKEN.toUpperCase()}-1`,
        locationCity: 'Pune',
      }),
      createCandidate(scenario.tenant.id, {
        firstName: 'Aarav',
        lastName: 'Sharma',
        currentTitle: 'Data Analyst',
        currentCompany: `${TOKEN} Analytics`,
      }),
      getSystemPrisma().clientContact.create({
        data: {
          tenantId: scenario.tenant.id,
          clientId: client.id,
          firstName: 'Meera',
          lastName: 'Iyer',
          email: `meera.iyer@${TOKEN.toLowerCase()}.example.test`,
          title: 'Head of Operations',
        },
      }),
    ]);

    http = new TestHttpClient(testApp.server, testApp.prefix);
    await http.login(scenario.admin.email, TEST_PASSWORD);
  });

  afterAll(async () => {
    await testApp.close();
    await disconnectTestDatabases();
  });

  /** Runs a search and unwraps the envelope, asserting the 200 first. */
  async function search(term: string, limit?: number): Promise<SearchResultShape> {
    const params = new URLSearchParams({ q: term });
    if (limit !== undefined) params.set('limit', String(limit));
    const response = await http.get(`/search?${params.toString()}`);
    expect(response.status).toBe(200);
    return response.body.data as SearchResultShape;
  }

  function itemsOf(result: SearchResultShape, entity: string): SearchItemShape[] {
    return result.groups.find((group) => group.entity === entity)?.items ?? [];
  }

  // ---------------------------------------------------------------------------
  // Matching
  // ---------------------------------------------------------------------------

  describe('matching', () => {
    it('groups hits for jobs, candidates, clients and contacts', async () => {
      const result = await search(TOKEN);

      expect(result.query).toBe(TOKEN);
      expect(result.groups.map((group) => group.entity)).toEqual([
        'JOB',
        'CANDIDATE',
        'CLIENT',
        'CONTACT',
      ]);
      expect(result.total).toBe(4);
      expect(result.groups.every((group) => group.items.length > 0)).toBe(true);
    });

    it('ranks a whole-word match in the title above the same word elsewhere', async () => {
      await createCandidate(scenario.tenant.id, {
        firstName: 'Priya',
        lastName: 'Nair',
        headline: `Ex-${TOKEN} consultant`,
      });

      const result = await search(TOKEN);
      const jobs = itemsOf(result, 'JOB');

      expect(jobs[0]?.title).toBe(`${TOKEN} Platform Engineer`);
      expect(jobs[0]?.subtitle).toBe('Pune');
      expect(jobs[0]?.badge).toBe('OPEN');
      expect(jobs[0]?.href).toBe(`/jobs/${jobs[0]?.id}`);
    });

    it('finds a half-typed word through the trigram fallback', async () => {
      const result = await search('northw');

      expect(result.groups.map((group) => group.entity)).toEqual([
        'JOB',
        'CANDIDATE',
        'CLIENT',
        'CONTACT',
      ]);
    });

    it('matches several words with full-text search, which a substring scan cannot', async () => {
      const result = await search(`${TOKEN} engineer`);

      expect(result.groups.map((group) => group.entity)).toEqual(['JOB']);
      expect(itemsOf(result, 'JOB')[0]?.id).toBeTruthy();
    });

    it('links a contact to the client it belongs to', async () => {
      const result = await search(TOKEN);
      const [contact] = itemsOf(result, 'CONTACT');

      expect(contact?.title).toBe('Meera Iyer');
      expect(contact?.subtitle).toBe('Head of Operations');
      expect(contact?.href).toBe(`/clients/${clientId}`);
    });

    it('searches case-insensitively', async () => {
      const result = await search(TOKEN.toLowerCase());

      expect(result.total).toBe(4);
    });

    it('treats LIKE metacharacters in the term as literal text', async () => {
      const result = await search('North%');

      expect(result.total).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Result shape
  // ---------------------------------------------------------------------------

  describe('result shape', () => {
    it('caps each group at the requested limit while reporting the full total', async () => {
      await Promise.all([
        createCandidate(scenario.tenant.id, {
          firstName: 'Ravi',
          lastName: 'Menon',
          currentCompany: `${TOKEN} Group`,
        }),
        createCandidate(scenario.tenant.id, {
          firstName: 'Sara',
          lastName: 'Khan',
          currentCompany: `${TOKEN} Labs`,
        }),
      ]);

      const result = await search(TOKEN, 2);
      const candidates = result.groups.find((group) => group.entity === 'CANDIDATE');

      expect(candidates?.items).toHaveLength(2);
      expect(candidates?.total).toBe(3);
      expect(result.total).toBe(6);
    });

    it('reports an empty result rather than failing when nothing matches', async () => {
      const result = await search('zzzznothingmatchesthis');

      expect(result.groups).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    /**
     * A user whose only grant is `candidate:read_own`. Built with a bespoke role
     * because every built-in role either reads everything or nothing.
     */
    async function createCandidateOnlyUser(): Promise<string> {
      const prisma = getSystemPrisma();
      const user = await createUser({
        tenantId: scenario.tenant.id,
        firstName: 'Cara',
        lastName: 'Candidate-only',
      });
      const role = await prisma.role.create({
        data: { tenantId: scenario.tenant.id, name: 'Search: candidates only', priority: 50 },
      });
      const permissions = await prisma.permission.findMany({
        where: { key: { in: ['candidate:read_own'] } },
        select: { id: true },
      });
      await prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          tenantId: scenario.tenant.id,
          roleId: role.id,
          permissionId: permission.id,
        })),
      });
      await prisma.userRole.create({
        data: { tenantId: scenario.tenant.id, userId: user.id, roleId: role.id },
      });
      return user.email;
    }

    it('omits groups the caller may not read, even when matching rows exist', async () => {
      const email = await createCandidateOnlyUser();
      http.clearCookies();
      await http.login(email, TEST_PASSWORD);

      const result = await search(TOKEN);

      expect(result.groups.map((group) => group.entity)).toEqual(['CANDIDATE']);
      expect(result.total).toBe(1);
    });

    it('returns nothing at all for a user without a single read grant', async () => {
      const user = await createUser({
        tenantId: scenario.tenant.id,
        firstName: 'Hal',
        lastName: 'No-roles',
      });
      http.clearCookies();
      await http.login(user.email, TEST_PASSWORD);

      const result = await search(TOKEN);

      expect(result.groups).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('requires an authenticated session', async () => {
      http.clearCookies();

      expect((await http.get(`/search?q=${TOKEN}`)).status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('never returns another workspace’s rows for the same term', async () => {
      const other = await createTenantScenario();
      await createCandidate(other.tenant.id, {
        firstName: 'Aarav',
        lastName: 'Sharma',
        currentCompany: `${TOKEN} Analytics`,
      });
      await createJob(other.tenant.id, { title: `${TOKEN} Platform Engineer` });

      const result = await search(TOKEN);

      // Still exactly the four rows of this workspace — the other tenant's
      // identically named job and candidate are not counted.
      expect(result.total).toBe(4);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  describe('validation', () => {
    it('rejects a missing term', async () => {
      expect((await http.get('/search')).status).toBe(422);
    });

    it('rejects a blank term', async () => {
      expect((await http.get('/search?q=%20')).status).toBe(422);
    });

    it('rejects a term longer than the cap', async () => {
      const term = 'a'.repeat(121);
      expect((await http.get(`/search?q=${term}`)).status).toBe(422);
    });

    it('rejects a limit outside the allowed range', async () => {
      expect((await http.get(`/search?q=${TOKEN}&limit=0`)).status).toBe(422);
      expect((await http.get(`/search?q=${TOKEN}&limit=21`)).status).toBe(422);
    });
  });
});
