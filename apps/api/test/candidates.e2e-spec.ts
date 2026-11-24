import {
  createCandidate,
  createTenantScenario,
  TEST_PASSWORD,
  type TenantScenario,
} from './factories';
import { disconnectTestDatabases, getSystemPrisma, resetDatabase } from './utils/db';
import { createTestApp, type TestApp } from './utils/test-app';
import { TestHttpClient } from './utils/test-http';

/**
 * Candidates (Module 4).
 *
 * Covers the `/candidates` and `/candidate-lists` surfaces: CRUD, the paged
 * filter set, the boolean full-text search compiled to `tsquery`, duplicate
 * detection (exact normalised identifiers plus `pg_trgm` fuzzy matching),
 * merging, every sub-resource, hotlists, and the permission / tenancy
 * guarantees every resource owes.
 */

interface CandidateListItemShape {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  currentCompany: string | null;
  status: string;
  isHot: boolean;
  isArchived: boolean;
  tags: string[];
  skills: { id: string; name: string }[];
  lists: { id: string; name: string }[];
  hasResume: boolean;
  activeApplicationCount: number;
}

interface CandidateDetailShape extends CandidateListItemShape {
  headline: string | null;
  locationCity: string | null;
  workAuthorization: string;
  emails: { id: string; address: string; isPrimary: boolean }[];
  phones: { id: string; number: string; isPrimary: boolean }[];
  experiences: { id: string; company: string; title: string }[];
  educations: { id: string; institution: string }[];
  candidateSkills: { skillId: string; name: string; years: number | null; isPrimary: boolean }[];
  certifications: { id: string; name: string }[];
  languages: { id: string; name: string; proficiency: string }[];
  customFields: Record<string, unknown>;
}

interface DuplicateResponseShape {
  groups: {
    matchType: string;
    score: number;
    candidates: { id: string; fullName: string }[];
  }[];
  scanned: number;
}

interface ListSummaryShape {
  id: string;
  name: string;
  color: string | null;
  memberCount: number;
}

describe('Candidates (e2e)', () => {
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

  function createSkill(name: string) {
    return getSystemPrisma().skill.create({ data: { tenantId: scenario.tenant.id, name } });
  }

  function listCandidates(
    query = '',
  ): Promise<{ items: CandidateListItemShape[]; meta: { total: number } }> {
    return http.get(`/candidates${query}`).then((response) => {
      expect(response.status).toBe(200);
      return response.body.data as { items: CandidateListItemShape[]; meta: { total: number } };
    });
  }

  async function createViaApi(body: Record<string, unknown>): Promise<CandidateDetailShape> {
    const response = await http.post('/candidates', { body });
    expect(response.status).toBe(201);
    return response.body.data as CandidateDetailShape;
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    it('lets a viewer read candidates but not create, edit, merge or delete them', async () => {
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      expect((await http.get('/candidates')).status).toBe(200);
      expect((await http.post('/candidates', { body: { firstName: 'A', lastName: 'B' } })).status).toBe(403);
      expect((await http.patch('/candidates/x', { body: { firstName: 'A' } })).status).toBe(403);
      expect((await http.delete('/candidates/x')).status).toBe(403);
      expect(
        (await http.post('/candidates/merge', { body: { primaryId: 'a', duplicateIds: ['b'] } })).status,
      ).toBe(403);
    });

    it('lets a recruiter create but not merge or delete', async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);
      const created = await http.post('/candidates', {
        body: { firstName: 'Rex', lastName: 'Hire' },
      });
      expect(created.status).toBe(201);

      expect(
        (await http.post('/candidates/merge', { body: { primaryId: 'a', duplicateIds: ['b'] } })).status,
      ).toBe(403);
      expect((await http.delete(`/candidates/${(created.body.data as CandidateDetailShape).id}`)).status).toBe(403);
    });

    it('hides PII from a caller without candidate:view_pii', async () => {
      const candidate = await createCandidate(scenario.tenant.id, {
        email: 'hidden@example.test',
        phone: '+1 555 0100',
      });

      await http.login(scenario.viewer.email, TEST_PASSWORD);
      const detail = await http.get(`/candidates/${candidate.id}`);
      expect(detail.status).toBe(200);
      expect((detail.body.data as CandidateDetailShape).email).toBeNull();
      expect((detail.body.data as CandidateDetailShape).phone).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  describe('crud', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('creates a candidate with nested collections and derives the primary contact', async () => {
      const skill = await createSkill('TypeScript');

      const created = await createViaApi({
        firstName: 'Ada',
        lastName: 'Lovelace',
        currentCompany: 'Analytical Engines',
        isHot: true,
        tags: ['senior', 'remote'],
        emails: [{ address: 'ada@example.test', isPrimary: true }],
        phones: [{ number: '+1 555 0111', isPrimary: true }],
        experiences: [{ company: 'Analytical Engines', title: 'Principal Engineer', isCurrent: true }],
        educations: [{ institution: 'Cambridge' }],
        skills: [{ skillId: skill.id, years: 12, isPrimary: true }],
        certifications: [{ name: 'CSP' }],
        languages: [{ name: 'English', proficiency: 'NATIVE' }],
      });

      expect(created.fullName).toBe('Ada Lovelace');
      expect(created.email).toBe('ada@example.test');
      expect(created.phone).toBe('+1 555 0111');
      expect(created.emails).toHaveLength(1);
      expect(created.experiences).toHaveLength(1);
      expect(created.candidateSkills).toHaveLength(1);
      expect(created.candidateSkills[0]?.name).toBe('TypeScript');
    });

    it('updates the profile and refreshes the normalised duplicate columns', async () => {
      const created = await createViaApi({
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@example.test',
      });

      const response = await http.patch(`/candidates/${created.id}`, {
        body: { headline: 'Rear Admiral', email: 'Grace.Hopper@example.test' },
      });
      expect(response.status).toBe(200);
      expect((response.body.data as CandidateDetailShape).headline).toBe('Rear Admiral');

      const row = await getSystemPrisma().candidate.findUnique({ where: { id: created.id } });
      expect(row?.emailNormalized).toBe('grace.hopper@example.test');
    });

    it('reassigns the owner and soft-deletes the candidate', async () => {
      const created = await createViaApi({ firstName: 'Owner', lastName: 'Change' });

      const reassigned = await http.patch(`/candidates/${created.id}/owner`, {
        body: { ownerId: scenario.recruiter.id },
      });
      expect(reassigned.status).toBe(200);

      const row = await getSystemPrisma().candidate.findUnique({ where: { id: created.id } });
      expect(row?.ownerId).toBe(scenario.recruiter.id);

      expect((await http.delete(`/candidates/${created.id}`)).status).toBe(200);
      const deleted = await getSystemPrisma().candidate.findUnique({ where: { id: created.id } });
      expect(deleted?.deletedAt).not.toBeNull();
      expect((await http.get(`/candidates/${created.id}`)).status).toBe(404);
    });

    it('rejects an unknown owner or skill', async () => {
      const owner = await http.post('/candidates', {
        body: { firstName: 'Bad', lastName: 'Owner', ownerId: 'missing-user' },
      });
      expect(owner.status).toBe(422);

      const skill = await http.post('/candidates', {
        body: { firstName: 'Bad', lastName: 'Skill', skills: [{ skillId: 'missing-skill' }] },
      });
      expect(skill.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // Sub-resources
  // ---------------------------------------------------------------------------

  describe('sub-resources', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('adds, promotes and removes emails while keeping the primary contact in sync', async () => {
      const created = await createViaApi({ firstName: 'Email', lastName: 'Person' });

      const first = await http.post(`/candidates/${created.id}/emails`, {
        body: { address: 'first@example.test', isPrimary: true },
      });
      expect(first.status).toBe(201);
      expect((first.body.data as CandidateDetailShape).email).toBe('first@example.test');

      const second = await http.post(`/candidates/${created.id}/emails`, {
        body: { address: 'second@example.test', isPrimary: true },
      });
      const detail = second.body.data as CandidateDetailShape;
      // Exactly one primary, and the denormalised column follows it.
      expect(detail.emails.filter((email) => email.isPrimary).map((email) => email.address)).toEqual([
        'second@example.test',
      ]);
      expect(detail.email).toBe('second@example.test');

      const target = detail.emails.find((email) => email.address === 'second@example.test');
      if (!target) throw new Error('The second email was not stored');

      const removed = await http.delete(`/candidates/${created.id}/emails/${target.id}`);
      const afterRemove = removed.body.data as CandidateDetailShape;
      expect(afterRemove.emails.map((email) => email.address)).toEqual(['first@example.test']);
      expect(afterRemove.email).toBe('first@example.test');
    });

    it('manages phones, experiences, education, skills, certifications and languages', async () => {
      const created = await createViaApi({ firstName: 'Rich', lastName: 'Profile' });
      const skill = await createSkill('Go');

      const phone = await http.post(`/candidates/${created.id}/phones`, {
        body: { number: '+44 20 7946 0000', isPrimary: true },
      });
      expect((phone.body.data as CandidateDetailShape).phone).toBe('+44 20 7946 0000');

      const experience = await http.post(`/candidates/${created.id}/experiences`, {
        body: { company: 'Acme', title: 'Engineer', isCurrent: true },
      });
      expect((experience.body.data as CandidateDetailShape).experiences).toHaveLength(1);

      const education = await http.post(`/candidates/${created.id}/educations`, {
        body: { institution: 'MIT' },
      });
      expect((education.body.data as CandidateDetailShape).educations).toHaveLength(1);

      const skillAdded = await http.post(`/candidates/${created.id}/skills`, {
        body: { skillId: skill.id, years: 5 },
      });
      expect((skillAdded.body.data as CandidateDetailShape).candidateSkills[0]?.name).toBe('Go');

      const certification = await http.post(`/candidates/${created.id}/certifications`, {
        body: { name: 'AWS SAA' },
      });
      expect((certification.body.data as CandidateDetailShape).certifications).toHaveLength(1);

      const language = await http.post(`/candidates/${created.id}/languages`, {
        body: { name: 'Kannada', proficiency: 'NATIVE' },
      });
      expect((language.body.data as CandidateDetailShape).languages).toHaveLength(1);

      const removed = await http.delete(`/candidates/${created.id}/skills/${skill.id}`);
      expect((removed.body.data as CandidateDetailShape).candidateSkills).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Duplicate detection
  // ---------------------------------------------------------------------------

  describe('duplicates', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('blocks a create that matches an existing email unless allowDuplicate is set', async () => {
      await createViaApi({ firstName: 'Dup', lastName: 'Base', email: 'dup@example.test' });

      const blocked = await http.post('/candidates', {
        body: { firstName: 'Dup', lastName: 'Other', email: 'DUP@example.test' },
      });
      expect(blocked.status).toBe(409);
      expect((blocked.body as { code?: string }).code).toBe('CONFLICT');

      const allowed = await http.post('/candidates', {
        body: { firstName: 'Dup', lastName: 'Other', email: 'DUP@example.test', allowDuplicate: true },
      });
      expect(allowed.status).toBe(201);
    });

    it('reports exact identifier groups and fuzzy name matches', async () => {
      await createViaApi({
        firstName: 'Katherine',
        lastName: 'Johnson',
        email: 'katherine@example.test',
        currentCompany: 'NASA',
      });

      const response = await http.post('/candidates/duplicates', {
        body: { email: 'KATHERINE@example.test' },
      });
      expect(response.status).toBe(201);
      const exact = response.body.data as DuplicateResponseShape;
      expect(exact.groups.some((group) => group.matchType === 'EMAIL')).toBe(true);

      const fuzzy = await http.post('/candidates/duplicates', {
        body: { firstName: 'Katherin', lastName: 'Jonson', currentCompany: 'Nasa', fuzzyThreshold: 0.5 },
      });
      const fuzzyBody = fuzzy.body.data as DuplicateResponseShape;
      expect(fuzzyBody.groups.some((group) => group.matchType === 'FUZZY')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Merge
  // ---------------------------------------------------------------------------

  describe('merge', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('absorbs duplicates into the primary and reassigns their children', async () => {
      const primary = await createViaApi({ firstName: 'Primary', lastName: 'Record' });
      const duplicate = await createViaApi({
        firstName: 'Duplicate',
        lastName: 'Record',
        headline: 'Filled from the duplicate',
      });

      await http.post(`/candidates/${duplicate.id}/experiences`, {
        body: { company: 'Duplicate Co', title: 'Engineer' },
      });

      const response = await http.post('/candidates/merge', {
        body: { primaryId: primary.id, duplicateIds: [duplicate.id] },
      });
      expect(response.status).toBe(201);

      const merged = response.body.data as CandidateDetailShape;
      expect(merged.headline).toBe('Filled from the duplicate');
      expect(merged.experiences).toHaveLength(1);

      const absorbed = await getSystemPrisma().candidate.findUnique({ where: { id: duplicate.id } });
      expect(absorbed?.deletedAt).not.toBeNull();

      const moved = await getSystemPrisma().candidateExperience.findMany({
        where: { candidateId: primary.id },
      });
      expect(moved).toHaveLength(1);
    });

    it('refuses to merge a candidate into itself', async () => {
      const only = await createViaApi({ firstName: 'Lonely', lastName: 'Record' });
      const response = await http.post('/candidates/merge', {
        body: { primaryId: only.id, duplicateIds: [only.id] },
      });
      expect(response.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // Filters & search
  // ---------------------------------------------------------------------------

  describe('list filters and search', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('filters by status, hot flag and location', async () => {
      await createViaApi({ firstName: 'Hot', lastName: 'One', isHot: true, locationCity: 'Pune' });
      await createViaApi({ firstName: 'Cold', lastName: 'Two', status: 'PASSIVE', locationCity: 'Berlin' });

      expect((await listCandidates()).meta.total).toBe(2);
      expect((await listCandidates('?isHot=true')).meta.total).toBe(1);
      expect((await listCandidates('?status=PASSIVE')).meta.total).toBe(1);
      expect((await listCandidates('?location=pune')).meta.total).toBe(1);
    });

    it('scopes to the caller’s own candidates when asked', async () => {
      await createViaApi({ firstName: 'Mine', lastName: 'One', ownerId: scenario.admin.id });
      await createViaApi({ firstName: 'Theirs', lastName: 'Two', ownerId: scenario.recruiter.id });

      const mine = await listCandidates('?myCandidates=true');
      expect(mine.meta.total).toBe(1);
      expect(mine.items[0]?.firstName).toBe('Mine');
    });

    it('applies a boolean full-text query', async () => {
      await createCandidate(scenario.tenant.id, {
        firstName: 'Java',
        lastName: 'Spring',
        currentTitle: 'Senior Java Engineer',
        currentCompany: 'Springworks',
      });
      await createCandidate(scenario.tenant.id, {
        firstName: 'Rust',
        lastName: 'Lang',
        currentTitle: 'Systems Engineer',
        currentCompany: 'Ferris',
      });

      const hit = await listCandidates('?q=java');
      expect(hit.meta.total).toBe(1);

      const excluded = await listCandidates('?q=java%20NOT%20rust');
      expect(excluded.meta.total).toBe(1);

      const miss = await listCandidates('?q=rust%20AND%20java');
      expect(miss.meta.total).toBe(0);
    });

    it('filters by skill id', async () => {
      const skill = await createSkill('Kubernetes');
      const created = await createViaApi({ firstName: 'Skill', lastName: 'Holder' });
      await http.post(`/candidates/${created.id}/skills`, { body: { skillId: skill.id } });
      await createViaApi({ firstName: 'No', lastName: 'Skills' });

      const filtered = await listCandidates(`?skillIds=${skill.id}`);
      expect(filtered.meta.total).toBe(1);
      expect(filtered.items[0]?.id).toBe(created.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Hotlists
  // ---------------------------------------------------------------------------

  describe('hotlists', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('creates a hotlist, tracks membership and rejects duplicate names', async () => {
      const first = await createViaApi({ firstName: 'Pool', lastName: 'One' });
      const second = await createViaApi({ firstName: 'Pool', lastName: 'Two' });

      const created = await http.post('/candidate-lists', {
        body: { name: 'Bench Sales', color: '#10b981' },
      });
      expect(created.status).toBe(201);
      const list = created.body.data as ListSummaryShape;
      expect(list.memberCount).toBe(0);

      const clash = await http.post('/candidate-lists', { body: { name: 'Bench Sales' } });
      expect(clash.status).toBe(409);

      const added = await http.post(`/candidate-lists/${list.id}/members`, {
        body: { candidateIds: [first.id, second.id] },
      });
      expect(added.status).toBe(201);
      expect((added.body.data as ListSummaryShape).memberCount).toBe(2);

      const page = await http.get('/candidate-lists');
      expect((page.body.data as { items: ListSummaryShape[] }).items[0]?.memberCount).toBe(2);

      // Filtering candidates by the list returns only its members.
      expect((await listCandidates(`?listId=${list.id}`)).meta.total).toBe(2);

      const removed = await http.delete(`/candidate-lists/${list.id}/members`, {
        body: { candidateIds: [first.id] },
      });
      expect((removed.body.data as ListSummaryShape).memberCount).toBe(1);

      expect((await http.delete(`/candidate-lists/${list.id}`)).status).toBe(200);
      expect((await http.get(`/candidate-lists/${list.id}`)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('hides another workspace’s candidates and hotlists', async () => {
      const other = await createTenantScenario();
      const foreign = await createCandidate(other.tenant.id);
      const foreignList = await getSystemPrisma().candidateList.create({
        data: { tenantId: other.tenant.id, name: 'Foreign pool' },
      });

      await http.login(scenario.admin.email, TEST_PASSWORD);

      expect((await http.get(`/candidates/${foreign.id}`)).status).toBe(404);
      expect((await http.get(`/candidate-lists/${foreignList.id}`)).status).toBe(404);
      expect((await listCandidates()).meta.total).toBe(0);
    });
  });
});
