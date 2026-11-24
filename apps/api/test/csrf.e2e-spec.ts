import { createTenantScenario, TEST_PASSWORD, type TenantScenario } from './factories';
import { disconnectTestDatabases, resetDatabase } from './utils/db';
import { createTestApp, type TestApp } from './utils/test-app';
import { TestHttpClient } from './utils/test-http';

/**
 * Double-submit CSRF protection.
 *
 * The rule under test: a **cookie-authenticated write** must echo the readable
 * CSRF cookie in `x-csrf-token`. Everything else — safe methods, bearer-token
 * calls, public routes — is exempt, and the suite pins that down so a future
 * change cannot quietly widen the exemption.
 */
describe('CSRF protection (e2e)', () => {
  let testApp: TestApp;
  let http: TestHttpClient;
  let scenario: TenantScenario;
  let invite: Record<string, unknown>;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    scenario = await createTenantScenario();
    http = new TestHttpClient(testApp.server, testApp.prefix);
    invite = {
      email: 'invitee@example.test',
      firstName: 'Ivy',
      lastName: 'Invitee',
      roleIds: [scenario.roles.get('VIEWER') as string],
    };
  });

  afterAll(async () => {
    await testApp.close();
    await disconnectTestDatabases();
  });

  it('issues a readable CSRF cookie on login', async () => {
    await http.login(scenario.admin.email, TEST_PASSWORD);
    expect(http.csrfToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it('rejects a cookie-authenticated write with no CSRF header', async () => {
    await http.login(scenario.admin.email, TEST_PASSWORD);

    const response = await http.post('/users/invite', { body: invite, csrf: false });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('rejects a write whose CSRF header does not match the cookie', async () => {
    await http.login(scenario.admin.email, TEST_PASSWORD);

    const response = await http.post('/users/invite', {
      body: invite,
      csrf: false,
      headers: { 'x-csrf-token': 'a-token-from-somewhere-else' },
    });

    expect(response.status).toBe(403);
  });

  it('allows the write once the header matches', async () => {
    await http.login(scenario.admin.email, TEST_PASSWORD);

    const response = await http.post('/users/invite', { body: invite });

    expect(response.status).toBe(201);
  });

  it('exempts safe methods', async () => {
    await http.login(scenario.admin.email, TEST_PASSWORD);

    const response = await http.get('/users', { csrf: false });

    expect(response.status).toBe(200);
  });

  it('exempts bearer-token calls, which send nothing ambiently', async () => {
    await http.login(scenario.admin.email, TEST_PASSWORD);
    const token = http.accessToken as string;

    // Drop the cookies: this request proves identity with the header alone.
    http.clearCookies();
    const response = await http.get('/users', {
      csrf: false,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
  });

  it('exempts public routes', async () => {
    const response = await http.post('/auth/login', {
      csrf: false,
      body: { email: scenario.admin.email, password: TEST_PASSWORD },
    });

    expect(response.status).toBe(200);
  });
});
