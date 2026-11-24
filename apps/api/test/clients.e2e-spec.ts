import {
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
 * Clients & contacts (Phase 3, Module 1).
 *
 * Exercises the whole `/clients` and `/contacts` surface: the read/write
 * permission split, the `_own` vs `_all` visibility model, the CRUD lifecycle,
 * the "no open requisitions" deletion guards, primary-contact exclusivity and
 * the workspace roll-up stats.
 */

interface ClientOwnerShape {
  id: string;
  fullName: string;
}

interface ClientContactShape {
  id: string;
  clientId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  isPrimary: boolean;
}

interface ClientListItemShape {
  id: string;
  name: string;
  status: string;
  industry: string | null;
  owner: ClientOwnerShape | null;
  openJobs: number;
  totalJobs: number;
  contactCount: number;
}

interface ClientDetailShape extends ClientListItemShape {
  contacts: ClientContactShape[];
  jobs: { id: string; title: string; status: string; applicantCount: number }[];
  placements: { id: string; candidateName: string }[];
}

interface ClientStatsShape {
  byStatus: Record<string, number>;
  total: number;
  withOpenJobs: number;
  activePlacements: number;
}

interface PageShape<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number };
}

describe('Clients & contacts (e2e)', () => {
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

  function listClients(query = ''): Promise<PageShape<ClientListItemShape>> {
    return http.get(`/clients${query}`).then((response) => {
      expect(response.status).toBe(200);
      return response.body.data as PageShape<ClientListItemShape>;
    });
  }

  /**
   * A user holding **only** `client:read_own` / `contact:read_own`, which is
   * what proves the owner scoping really narrows the query rather than relying
   * on the tenant-wide read every built-in role happens to carry.
   */
  async function createOwnScopeUser() {
    const prisma = getSystemPrisma();
    const tenantId = scenario.tenant.id;

    const user = await createUser({
      tenantId,
      email: 'own-scope@example.test',
      firstName: 'Owen',
      lastName: 'Owner',
    });

    const permissions = await prisma.permission.findMany({
      where: { key: { in: ['client:read_own', 'contact:read_own'] } },
      select: { id: true },
    });

    const role = await prisma.role.create({
      data: { tenantId, name: 'Own-scope tester', priority: 1, isSystem: false },
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
    it('lets a viewer read clients and stats but not write them', async () => {
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      expect((await http.get('/clients')).status).toBe(200);
      expect((await http.get('/clients/stats')).status).toBe(200);
      expect((await http.post('/clients', { body: { name: 'Blocked' } })).status).toBe(403);
      expect((await http.patch('/clients/anything', { body: { name: 'Nope' } })).status).toBe(403);
      expect((await http.delete('/clients/anything')).status).toBe(403);
    });

    it('blocks a viewer from adding contacts', async () => {
      const client = await createClient(scenario.tenant.id);
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      const response = await http.post(`/clients/${client.id}/contacts`, {
        body: { firstName: 'Sam', lastName: 'Blocked' },
      });
      expect(response.status).toBe(403);
    });

    it('gives a recruiter read access but not create or delete', async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);

      expect((await http.get('/clients')).status).toBe(200);
      expect((await http.post('/clients', { body: { name: 'Recruiter client' } })).status).toBe(403);
      expect((await http.delete('/clients/anything')).status).toBe(403);
    });

    it('lets an admin run the full lifecycle', async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);

      const created = await http.post('/clients', { body: { name: 'Northwind Trading' } });
      expect(created.status).toBe(201);

      const client = created.body.data as ClientDetailShape;
      expect((await http.patch(`/clients/${client.id}`, { body: { name: 'Northwind' } })).status).toBe(200);
      expect((await http.delete(`/clients/${client.id}`)).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('defaults a new client to PROSPECT and assigns the creator as owner', async () => {
      const response = await http.post('/clients', {
        body: { name: 'Acme Industrial', industry: 'Manufacturing', city: 'Pune', country: 'India' },
      });

      expect(response.status).toBe(201);
      const client = response.body.data as ClientDetailShape;
      expect(client.status).toBe('PROSPECT');
      expect(client.industry).toBe('Manufacturing');
      expect(client.owner?.id).toBe(scenario.admin.id);
      expect(client.contacts).toEqual([]);
      expect(client.jobs).toEqual([]);
      expect(client.placements).toEqual([]);
    });

    it('persists edits and reads them back on the detail endpoint', async () => {
      const created = await http.post('/clients', {
        body: { name: 'Globex', defaultBillRateCents: 12_500, paymentTermsDays: 30, currency: 'usd' },
      });
      const clientId = (created.body.data as ClientDetailShape).id;

      const updated = await http.patch(`/clients/${clientId}`, {
        body: { status: 'ACTIVE', legalName: 'Globex Corporation', website: 'https://globex.test' },
      });
      expect(updated.status).toBe(200);

      const detail = await http.get(`/clients/${clientId}`);
      const client = detail.body.data as ClientDetailShape & {
        legalName: string | null;
        website: string | null;
        currency: string | null;
        defaultBillRateCents: number | null;
      };
      expect(client.status).toBe('ACTIVE');
      expect(client.legalName).toBe('Globex Corporation');
      expect(client.website).toBe('https://globex.test');
      expect(client.defaultBillRateCents).toBe(12_500);
      expect(client.currency).toBe('USD');
    });

    it('filters by status, industry and free-text search', async () => {
      await createClient(scenario.tenant.id, { name: 'Northwind Trading', status: 'ACTIVE' });
      await createClient(scenario.tenant.id, { name: 'Globex', status: 'PROSPECT', industry: 'Energy' });

      expect((await listClients('?status=ACTIVE')).items).toHaveLength(1);
      expect((await listClients('?industry=energy')).items).toHaveLength(1);
      expect((await listClients('?q=northwind')).items).toHaveLength(1);
      expect((await listClients('?q=nothing-matches')).items).toHaveLength(0);
    });

    it('sorts and paginates the list', async () => {
      await createClient(scenario.tenant.id, { name: 'Alpha' });
      await createClient(scenario.tenant.id, { name: 'Bravo' });
      await createClient(scenario.tenant.id, { name: 'Charlie' });

      const ascending = await listClients('?sortBy=name&sortDir=asc');
      expect(ascending.items.map((client) => client.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);

      const firstPage = await listClients('?pageSize=2&sortBy=name&sortDir=asc');
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.meta.total).toBe(3);
    });

    it('hides a soft-deleted client from the list', async () => {
      const client = await createClient(scenario.tenant.id);

      expect((await http.delete(`/clients/${client.id}`)).status).toBe(200);
      expect(await listClients()).toEqual(expect.objectContaining({ items: [] }));
      expect((await http.get(`/clients/${client.id}`)).status).toBe(404);
    });

    it('returns 404 for a client that does not exist', async () => {
      expect((await http.get('/clients/does-not-exist')).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Owner scoping
  // ---------------------------------------------------------------------------

  describe('owner scoping', () => {
    it('shows a read_own user only the clients they own', async () => {
      const ownScope = await createOwnScopeUser();

      await createClient(scenario.tenant.id, { name: 'Someone else', ownerId: scenario.admin.id });
      const mine = await createClient(scenario.tenant.id, { name: 'Mine', ownerId: ownScope.id });

      await http.login(ownScope.email, TEST_PASSWORD);

      const page = await listClients();
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.id).toBe(mine.id);
    });

    it('narrows an all-access caller to their own clients with mine=true', async () => {
      await createClient(scenario.tenant.id, { name: 'Admin owned', ownerId: scenario.admin.id });
      await createClient(scenario.tenant.id, { name: 'Recruiter owned', ownerId: scenario.recruiter.id });

      await http.login(scenario.admin.email, TEST_PASSWORD);

      expect((await listClients()).items).toHaveLength(2);
      const mine = await listClients('?mine=true');
      expect(mine.items).toHaveLength(1);
      expect(mine.items[0]?.name).toBe('Admin owned');
    });

    it('filters by an explicit ownerId', async () => {
      await createClient(scenario.tenant.id, { name: 'Admin owned', ownerId: scenario.admin.id });
      await createClient(scenario.tenant.id, { name: 'Recruiter owned', ownerId: scenario.recruiter.id });

      await http.login(scenario.admin.email, TEST_PASSWORD);

      const filtered = await listClients(`?ownerId=${scenario.recruiter.id}`);
      expect(filtered.items).toHaveLength(1);
      expect(filtered.items[0]?.name).toBe('Recruiter owned');
    });

    it('keeps another workspace’s clients invisible', async () => {
      const other = await createTenantScenario();
      const foreign = await createClient(other.tenant.id, { name: 'Foreign client' });

      await http.login(scenario.admin.email, TEST_PASSWORD);

      expect((await listClients()).items).toHaveLength(0);
      expect((await http.get(`/clients/${foreign.id}`)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Deletion guards
  // ---------------------------------------------------------------------------

  describe('deletion guards', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('refuses to delete a client with an open requisition', async () => {
      const client = await createClient(scenario.tenant.id);
      const job = await createJob(scenario.tenant.id, { clientId: client.id, status: 'OPEN' });

      const blocked = await http.delete(`/clients/${client.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.message).toContain('open requisition');

      await getSystemPrisma().job.update({ where: { id: job.id }, data: { status: 'CLOSED' } });
      expect((await http.delete(`/clients/${client.id}`)).status).toBe(200);
    });

    it('refuses to delete a contact referenced by an open requisition', async () => {
      const client = await createClient(scenario.tenant.id);
      const created = await http.post(`/clients/${client.id}/contacts`, {
        body: { firstName: 'Priya', lastName: 'Sharma' },
      });
      const contact = created.body.data as ClientContactShape;

      const job = await createJob(scenario.tenant.id, { clientId: client.id, contactId: contact.id });

      const blocked = await http.delete(`/contacts/${contact.id}`);
      expect(blocked.status).toBe(409);

      await getSystemPrisma().job.update({ where: { id: job.id }, data: { status: 'CLOSED' } });
      expect((await http.delete(`/contacts/${contact.id}`)).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------------------

  describe('contacts', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('adds, lists, edits and removes contacts on a client', async () => {
      const client = await createClient(scenario.tenant.id);

      const created = await http.post(`/clients/${client.id}/contacts`, {
        body: {
          firstName: 'Dana',
          lastName: 'Lee',
          email: 'dana@globex.test',
          title: 'Head of Talent',
        },
      });
      expect(created.status).toBe(201);
      const contact = created.body.data as ClientContactShape;
      expect(contact.fullName).toBe('Dana Lee');
      expect(contact.isPrimary).toBe(true);

      const listed = await http.get(`/clients/${client.id}/contacts`);
      expect(listed.status).toBe(200);
      expect(listed.body.data).toHaveLength(1);

      const updated = await http.patch(`/contacts/${contact.id}`, { body: { department: 'People' } });
      expect(updated.status).toBe(200);
      expect((updated.body.data as ClientContactShape).title).toBe('Head of Talent');

      expect((await http.delete(`/contacts/${contact.id}`)).status).toBe(200);
      const after = await http.get(`/clients/${client.id}/contacts`);
      expect(after.body.data).toHaveLength(0);
    });

    it('keeps exactly one primary contact per client', async () => {
      const client = await createClient(scenario.tenant.id);

      const first = await http.post(`/clients/${client.id}/contacts`, {
        body: { firstName: 'First', lastName: 'Primary' },
      });
      const second = await http.post(`/clients/${client.id}/contacts`, {
        body: { firstName: 'Second', lastName: 'Primary', isPrimary: true },
      });

      const listed = await http.get(`/clients/${client.id}/contacts`);
      const contacts = listed.body.data as ClientContactShape[];
      expect(contacts).toHaveLength(2);

      // The newest primary wins and is listed first; the first was demoted.
      expect(contacts[0]?.id).toBe((second.body.data as ClientContactShape).id);
      expect(contacts[0]?.isPrimary).toBe(true);
      expect(contacts[1]?.id).toBe((first.body.data as ClientContactShape).id);
      expect(contacts[1]?.isPrimary).toBe(false);
    });

    it('promotes the first contact to primary without being asked', async () => {
      const client = await createClient(scenario.tenant.id);

      const first = await http.post(`/clients/${client.id}/contacts`, {
        body: { firstName: 'First', lastName: 'Contact' },
      });
      expect((first.body.data as ClientContactShape).isPrimary).toBe(true);

      // A second contact added without the flag must not steal primary.
      const second = await http.post(`/clients/${client.id}/contacts`, {
        body: { firstName: 'Second', lastName: 'Contact' },
      });
      expect((second.body.data as ClientContactShape).isPrimary).toBe(false);
    });

    it('promotes a contact to primary through an edit', async () => {
      const client = await createClient(scenario.tenant.id);

      const first = await http.post(`/clients/${client.id}/contacts`, {
        body: { firstName: 'First', lastName: 'Contact' },
      });
      const second = await http.post(`/clients/${client.id}/contacts`, {
        body: { firstName: 'Second', lastName: 'Contact' },
      });

      const promoted = await http.patch(`/contacts/${(second.body.data as ClientContactShape).id}`, {
        body: { isPrimary: true },
      });
      expect(promoted.status).toBe(200);
      expect((promoted.body.data as ClientContactShape).isPrimary).toBe(true);

      const listed = await http.get(`/clients/${client.id}/contacts`);
      const byId = new Map(
        (listed.body.data as ClientContactShape[]).map((contact) => [contact.id, contact]),
      );
      expect(byId.get((first.body.data as ClientContactShape).id)?.isPrimary).toBe(false);
    });

    it('surfaces the contact count and the primary contact on the detail payload', async () => {
      const client = await createClient(scenario.tenant.id);
      await http.post(`/clients/${client.id}/contacts`, {
        body: { firstName: 'Dana', lastName: 'Lee', isPrimary: true },
      });

      const detail = await http.get(`/clients/${client.id}`);
      const record = detail.body.data as ClientDetailShape;
      expect(record.contactCount).toBe(1);
      expect(record.contacts[0]?.fullName).toBe('Dana Lee');
    });

    it('rejects a 404 when the parent client does not exist', async () => {
      const response = await http.post('/clients/does-not-exist/contacts', {
        body: { firstName: 'Dana', lastName: 'Lee' },
      });
      expect(response.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Detail roll-ups & stats
  // ---------------------------------------------------------------------------

  describe('roll-ups', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('counts open and total requisitions per client', async () => {
      const client = await createClient(scenario.tenant.id, { name: 'Rollup Co' });
      await createJob(scenario.tenant.id, { clientId: client.id, status: 'OPEN' });
      await createJob(scenario.tenant.id, { clientId: client.id, status: 'ON_HOLD' });
      await createJob(scenario.tenant.id, { clientId: client.id, status: 'CLOSED' });

      const page = await listClients('?q=rollup');
      expect(page.items[0]?.openJobs).toBe(2);
      expect(page.items[0]?.totalJobs).toBe(3);

      const detail = await http.get(`/clients/${client.id}`);
      expect((detail.body.data as ClientDetailShape).jobs).toHaveLength(3);
    });

    it('reports workspace stats by status', async () => {
      await createClient(scenario.tenant.id, { name: 'Active one', status: 'ACTIVE' });
      await createClient(scenario.tenant.id, { name: 'Active two', status: 'ACTIVE' });
      await createClient(scenario.tenant.id, { name: 'Prospect', status: 'PROSPECT' });

      const response = await http.get('/clients/stats');
      expect(response.status).toBe(200);

      const stats = response.body.data as ClientStatsShape;
      expect(stats.total).toBe(3);
      expect(stats.byStatus.ACTIVE).toBe(2);
      expect(stats.byStatus.PROSPECT).toBe(1);
      expect(stats.byStatus.CHURNED).toBe(0);
    });

    it('counts clients with at least one open requisition', async () => {
      const withJob = await createClient(scenario.tenant.id, { name: 'Has open job' });
      await createClient(scenario.tenant.id, { name: 'Idle client' });
      await createJob(scenario.tenant.id, { clientId: withJob.id, status: 'OPEN' });

      const response = await http.get('/clients/stats');
      expect((response.body.data as ClientStatsShape).withOpenJobs).toBe(1);
    });
  });
});
