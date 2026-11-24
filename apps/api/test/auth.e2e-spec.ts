import { createTenantScenario, createUser, ensurePlanCatalogue, TEST_PASSWORD } from './factories';
import { disconnectTestDatabases, resetDatabase } from './utils/db';
import { createTestApp, type TestApp } from './utils/test-app';
import { TestHttpClient } from './utils/test-http';

/**
 * Credential and session lifecycle.
 *
 * These run against the real guard pipeline, the real cookie names and the real
 * refresh-token rotation, because that is where session bugs actually live —
 * a mocked service would pass no matter what the guards did.
 */
describe('Auth (e2e)', () => {
  let testApp: TestApp;
  let http: TestHttpClient;

  beforeAll(async () => {
    testApp = await createTestApp();
    await ensurePlanCatalogue();
  });

  beforeEach(async () => {
    await resetDatabase();
    http = new TestHttpClient(testApp.server, testApp.prefix);
  });

  afterAll(async () => {
    await testApp.close();
    await disconnectTestDatabases();
  });

  describe('signup', () => {
    it('provisions a workspace, issues cookies and returns a usable session', async () => {
      const response = await http.post('/auth/signup', {
        body: {
          companyName: 'Northwind Talent',
          firstName: 'Nina',
          lastName: 'Nova',
          email: 'nina@northwind.test',
          password: TEST_PASSWORD,
          acceptedTerms: true,
        },
      });

      expect(response.status).toBe(201);
      const session = response.body.data;
      expect(session.user.email).toBe('nina@northwind.test');
      expect(session.tenant.slug).toBe('northwind-talent');
      expect(session.user.permissions).toContain('tenant:read');

      // Tokens live in httpOnly cookies only — never in the body.
      expect(http.accessToken).toBeDefined();
      expect(http.refreshToken).toBeDefined();
      expect(http.csrfToken).toBeDefined();
      expect(session.accessToken).toBeUndefined();

      const reloaded = await http.get('/auth/session');
      expect(reloaded.status).toBe(200);
      expect(reloaded.body.data.tenant.slug).toBe('northwind-talent');
    });

    it('rejects an invalid payload with 422 and the validation error code', async () => {
      const response = await http.post('/auth/signup', {
        body: {
          companyName: 'X',
          firstName: 'Nina',
          lastName: 'Nova',
          email: 'not-an-email',
          password: 'short',
          acceptedTerms: false,
        },
      });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('login', () => {
    it('signs an active, verified user in', async () => {
      const scenario = await createTenantScenario();

      const response = await http.login(scenario.admin.email, TEST_PASSWORD);

      expect(response.status).toBe(200);
      expect(response.body.data.user.id).toBe(scenario.admin.id);
      expect(http.accessToken).toBeDefined();
    });

    it('rejects a wrong password without leaking whether the account exists', async () => {
      const scenario = await createTenantScenario();

      const wrongPassword = await http.login(scenario.admin.email, 'NotThePassword1');
      expect(wrongPassword.status).toBe(401);
      expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');

      const unknownUser = await http.login('nobody@example.test', TEST_PASSWORD);
      expect(unknownUser.status).toBe(401);
      expect(unknownUser.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('refuses an account that has not confirmed its email', async () => {
      const scenario = await createTenantScenario();
      const pending = await createUser({
        tenantId: scenario.tenant.id,
        email: 'pending@example.test',
        roleKey: 'RECRUITER',
        emailVerified: false,
      });

      const response = await http.login(pending.email, TEST_PASSWORD);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token', async () => {
      const scenario = await createTenantScenario();
      await http.login(scenario.admin.email, TEST_PASSWORD);
      const first = http.refreshToken;

      const rotated = await http.post('/auth/refresh');

      expect(rotated.status).toBe(200);
      expect(http.refreshToken).toBeDefined();
      expect(http.refreshToken).not.toBe(first);
    });

    it('revokes the whole family when a rotated token is replayed', async () => {
      const scenario = await createTenantScenario();
      await http.login(scenario.admin.email, TEST_PASSWORD);
      const first = http.refreshToken as string;

      const rotated = await http.post('/auth/refresh');
      expect(rotated.status).toBe(200);
      const second = http.refreshToken as string;

      // Replay the token that was already exchanged.
      http.setCookie('tf_rt', first);
      const replay = await http.post('/auth/refresh');
      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe('TOKEN_REUSED');

      // Reuse detection is only useful if it kills the descendant too.
      http.setCookie('tf_rt', second);
      const afterReuse = await http.post('/auth/refresh');
      expect(afterReuse.status).toBe(401);
    });

    it('rejects a refresh with no token at all', async () => {
      const response = await http.post('/auth/refresh', { body: {} });
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('logout', () => {
    it('clears the session cookies and stops authenticating', async () => {
      const scenario = await createTenantScenario();
      await http.login(scenario.admin.email, TEST_PASSWORD);

      const logout = await http.post('/auth/logout');
      expect(logout.status).toBe(204);
      expect(http.accessToken).toBeUndefined();
      expect(http.refreshToken).toBeUndefined();

      const session = await http.get('/auth/session');
      expect(session.status).toBe(401);
    });
  });

  describe('session', () => {
    it('refuses an anonymous request', async () => {
      const response = await http.get('/auth/session');
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
    });
  });
});
