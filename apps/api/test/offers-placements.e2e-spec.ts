import {
  createApplication,
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
 * Offers & placements (Phase 3, Module 4).
 *
 * An offer is raised against an application and, once accepted, produces the
 * placement that carries the money. These specs walk that chain end to end —
 * the lifecycle stamps, the board movement, the placement that accepting
 * creates — and then the read side, where the margin is the point of interest:
 * it is computed server-side and withheld from any caller without
 * `placement:view_margin`.
 *
 * Conventions, as elsewhere: domain validation is **422**, terminal-state
 * conflicts are **409**, and a record in another workspace is **404**.
 */

const DAY_MS = 86_400_000;

interface OfferShape {
  id: string;
  status: string;
  title: string | null;
  salaryCents: number | null;
  payRateCents: number | null;
  billRateCents: number | null;
  ratePeriod: string;
  currency: string;
  bonusCents: number | null;
  equityNote: string | null;
  startDate: string | null;
  expiresAt: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  declineReason: string | null;
  notes: string | null;
  application: {
    id: string;
    job: { id: string; title: string; referenceCode: string };
    candidate: { id: string; fullName: string };
    client: { id: string; name: string } | null;
  };
  placement: { id: string; status: string; startDate: string | null } | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface PlacementShape {
  id: string;
  status: string;
  applicationId: string;
  offerId: string | null;
  candidate: { id: string; fullName: string };
  job: { id: string; title: string } | null;
  client: { id: string; name: string } | null;
  recruiter: { id: string; fullName: string } | null;
  startDate: string | null;
  endDate: string | null;
  payRateCents: number | null;
  billRateCents: number | null;
  ratePeriod: string;
  currency: string;
  feeCents: number | null;
  feePercentage: number | null;
  guaranteeDays: number | null;
  notes: string | null;
  invoiceRef: string | null;
  margin: { marginCents: number | null; marginPercentage: number | null } | null;
  createdAt: string;
  updatedAt: string;
}

interface StatsShape {
  total: number;
  pending: number;
  active: number;
  completed: number;
  terminated: number;
  margin: {
    totalMarginCents: number;
    totalFeeCents: number;
    averageMarginPercentage: number | null;
    currency: string | null;
  } | null;
}

interface PageShape<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number };
}

describe('Offers & placements (e2e)', () => {
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
    await http.login(scenario.admin.email, TEST_PASSWORD);
  });

  afterAll(async () => {
    await testApp.close();
    await disconnectTestDatabases();
  });

  /** Stage indices in the tenant-default pipeline. */
  const OFFER_STAGE_INDEX = 5;
  const PLACEMENT_STAGE_INDEX = 6;

  function stageAt(index: number): string {
    const stageId = scenario.stages[index];
    if (!stageId) throw new Error(`The scenario has no stage at index ${index}`);
    return stageId;
  }

  /** A client-linked job with a candidate on it — everything an offer needs. */
  async function seedDeal(options: { stageIndex?: number; ownerId?: string } = {}) {
    const client = await createClient(scenario.tenant.id, { name: 'Northwind Trading' });
    const job = await createJob(scenario.tenant.id, { clientId: client.id, status: 'OPEN' });
    const candidate = await createCandidate(scenario.tenant.id);
    const application = await createApplication({
      tenantId: scenario.tenant.id,
      jobId: job.id,
      candidateId: candidate.id,
      stageId: stageAt(options.stageIndex ?? 0),
      ownerId: options.ownerId,
    });
    return { client, job, candidate, application };
  }

  async function raiseOffer(
    applicationId: string,
    body: Record<string, unknown> = {},
  ): Promise<OfferShape> {
    const response = await http.post('/offers', { body: { applicationId, ...body } });
    expect(response.status).toBe(201);
    return response.body.data as OfferShape;
  }

  function listOffers(query = ''): Promise<PageShape<OfferShape>> {
    return http.get(`/offers${query}`).then((response) => {
      expect(response.status).toBe(200);
      return response.body.data as PageShape<OfferShape>;
    });
  }

  function listPlacements(query = ''): Promise<PageShape<PlacementShape>> {
    return http.get(`/placements${query}`).then((response) => {
      expect(response.status).toBe(200);
      return response.body.data as PageShape<PlacementShape>;
    });
  }

  /** Raises an offer and accepts it, returning both ends of the chain. */
  async function place(
    applicationId: string,
    offerBody: Record<string, unknown> = {},
    acceptBody: Record<string, unknown> = {},
  ): Promise<{ offer: OfferShape; placement: PlacementShape }> {
    const raised = await raiseOffer(applicationId, offerBody);
    const accepted = await http.post(`/offers/${raised.id}/accept`, { body: acceptBody });
    expect(accepted.status).toBe(201);

    const offer = accepted.body.data as OfferShape;
    const placementId = offer.placement?.id;
    if (!placementId) throw new Error('Accepting the offer did not produce a placement');

    const placements = await listPlacements(`?applicationId=${applicationId}`);
    const placement = placements.items.find((item) => item.id === placementId);
    if (!placement) throw new Error('The placement is not readable back');
    return { offer, placement };
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    it('lets a viewer read offers and placements but change nothing', async () => {
      const { application } = await seedDeal();
      const { offer } = await place(application.id);

      http.clearCookies();
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      expect((await http.get('/offers')).status).toBe(200);
      expect((await http.get('/placements')).status).toBe(200);
      expect((await http.get('/placements/stats')).status).toBe(200);
      expect((await http.post('/offers', { body: { applicationId: application.id } })).status).toBe(403);
      expect((await http.patch(`/offers/${offer.id}`, { body: { title: 'Nope' } })).status).toBe(403);
      expect((await http.post(`/offers/${offer.id}/accept`, { body: {} })).status).toBe(403);
      expect((await http.delete(`/offers/${offer.id}`)).status).toBe(403);
    });

    it('lets a recruiter raise an offer but not send, accept or delete it', async () => {
      const { application } = await seedDeal();

      http.clearCookies();
      await http.login(scenario.recruiter.email, TEST_PASSWORD);

      const created = await http.post('/offers', { body: { applicationId: application.id } });
      expect(created.status).toBe(201);
      const offerId = (created.body.data as OfferShape).id;

      // RECRUITER's template deliberately omits `offer:update` and `offer:delete`.
      expect((await http.patch(`/offers/${offerId}`, { body: { status: 'SENT' } })).status).toBe(403);
      expect((await http.post(`/offers/${offerId}/accept`, { body: {} })).status).toBe(403);
      expect((await http.delete(`/offers/${offerId}`)).status).toBe(403);
    });

    it('lets an account manager accept an offer, since that is the closing step', async () => {
      const { application } = await seedDeal();
      const accountManager = await createUser({
        tenantId: scenario.tenant.id,
        roleKey: 'ACCOUNT_MANAGER',
        email: 'account-manager@example.test',
      });

      const raised = await raiseOffer(application.id);

      http.clearCookies();
      await http.login(accountManager.email, TEST_PASSWORD);

      const accepted = await http.post(`/offers/${raised.id}/accept`, { body: {} });
      expect(accepted.status).toBe(201);
      expect((accepted.body.data as OfferShape).status).toBe('ACCEPTED');
      // …but closing the offer is not the same as deleting it.
      expect((await http.delete(`/offers/${raised.id}`)).status).toBe(403);
    });

    it('returns 404 for an offer that does not exist', async () => {
      expect((await http.patch('/offers/does-not-exist', { body: { title: 'Ghost' } })).status).toBe(404);
      expect((await http.post('/offers/does-not-exist/accept', { body: {} })).status).toBe(404);
      expect((await http.delete('/offers/does-not-exist')).status).toBe(404);
      expect((await http.patch('/placements/does-not-exist', { body: { status: 'ACTIVE' } })).status).toBe(404);
      expect((await http.delete('/placements/does-not-exist')).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Raising an offer
  // ---------------------------------------------------------------------------

  describe('create', () => {
    it('raises a draft offer carrying the terms, and logs it on the timeline', async () => {
      const { application, job, candidate } = await seedDeal();

      const offer = await raiseOffer(application.id, {
        title: 'Senior Platform Engineer',
        salaryCents: 12_500_000,
        bonusCents: 1_000_000,
        equityNote: '0.05% over four years',
        startDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
        expiresAt: new Date(Date.now() + 7 * DAY_MS).toISOString(),
        notes: 'Verbal agreement reached on the call.',
      });

      expect(offer.status).toBe('DRAFT');
      expect(offer.title).toBe('Senior Platform Engineer');
      expect(offer.salaryCents).toBe(12_500_000);
      expect(offer.bonusCents).toBe(1_000_000);
      expect(offer.equityNote).toBe('0.05% over four years');
      expect(offer.notes).toBe('Verbal agreement reached on the call.');
      expect(offer.sentAt).toBeNull();
      expect(offer.respondedAt).toBeNull();
      expect(offer.placement).toBeNull();

      expect(offer.application.id).toBe(application.id);
      expect(offer.application.job.id).toBe(job.id);
      expect(offer.application.candidate.fullName).toContain('Casey');
      expect(offer.application.client?.name).toBe('Northwind Trading');
      expect(offer.createdBy?.id).toBe(scenario.admin.id);

      const activity = await getSystemPrisma().activity.findFirst({
        where: { applicationId: application.id, entityType: 'OFFER' },
      });
      expect(activity?.subject).toBe('Offer raised · Senior Platform Engineer');
      expect(activity?.jobId).toBe(job.id);
      expect(activity?.candidateId).toBe(candidate.id);
    });

    it('defaults the rate period and currency to the workspace conventions', async () => {
      const { application } = await seedDeal();

      const offer = await raiseOffer(application.id);

      expect(offer.ratePeriod).toBe('ANNUAL');
      expect(offer.currency).toBe('USD');
      expect(offer.title).toBeNull();
      expect(offer.salaryCents).toBeNull();
    });

    it('refuses an application that has been rejected or withdrawn', async () => {
      const { application } = await seedDeal();
      await getSystemPrisma().application.update({
        where: { id: application.id },
        data: { status: 'REJECTED' },
      });

      const response = await http.post('/offers', { body: { applicationId: application.id } });
      expect(response.status).toBe(422);
    });

    it('refuses an application from another workspace', async () => {
      const other = await createTenantScenario();
      const otherClient = await createClient(other.tenant.id);
      const otherJob = await createJob(other.tenant.id, { clientId: otherClient.id });
      const otherCandidate = await createCandidate(other.tenant.id);
      const foreign = await createApplication({
        tenantId: other.tenant.id,
        jobId: otherJob.id,
        candidateId: otherCandidate.id,
        stageId: other.stages[0] as string,
      });

      const response = await http.post('/offers', { body: { applicationId: foreign.id } });
      expect(response.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('stamps `sentAt` and walks the application onto the offer stage', async () => {
      const { application } = await seedDeal({ stageIndex: 2 });
      const offer = await raiseOffer(application.id);

      const response = await http.patch(`/offers/${offer.id}`, { body: { status: 'SENT' } });
      expect(response.status).toBe(200);

      const sent = response.body.data as OfferShape;
      expect(sent.status).toBe('SENT');
      expect(sent.sentAt).not.toBeNull();
      expect(sent.respondedAt).toBeNull();

      const prisma = getSystemPrisma();
      const moved = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
      expect(moved.stageId).toBe(stageAt(OFFER_STAGE_INDEX));

      const history = await prisma.stageHistory.findMany({ where: { applicationId: application.id } });
      expect(history).toHaveLength(1);
      expect(history[0]?.note).toBe('Offer sent');
      expect(history[0]?.toStageId).toBe(stageAt(OFFER_STAGE_INDEX));
      expect(history[0]?.changedById).toBe(scenario.admin.id);
    });

    it('stamps `respondedAt` on a terminal status and refuses anything after it', async () => {
      const { application } = await seedDeal();
      const offer = await raiseOffer(application.id);

      const declined = await http.patch(`/offers/${offer.id}`, {
        body: { status: 'DECLINED', declineReason: 'Accepted a counter-offer' },
      });
      expect(declined.status).toBe(200);

      const body = declined.body.data as OfferShape;
      expect(body.status).toBe('DECLINED');
      expect(body.respondedAt).not.toBeNull();
      expect(body.declineReason).toBe('Accepted a counter-offer');

      const afterwards = await http.patch(`/offers/${offer.id}`, { body: { status: 'SENT' } });
      expect(afterwards.status).toBe(409);

      // A plain edit to a finished offer is still allowed — the terms may need
      // correcting for the record.
      expect((await http.patch(`/offers/${offer.id}`, { body: { notes: 'N/A' } })).status).toBe(200);
    });

    it('rejects accepting through the plain update endpoint', async () => {
      const { application } = await seedDeal();
      const offer = await raiseOffer(application.id);

      const response = await http.patch(`/offers/${offer.id}`, { body: { status: 'ACCEPTED' } });
      expect(response.status).toBe(422);
      // Nothing was written.
      const untouched = await getSystemPrisma().offer.findUniqueOrThrow({ where: { id: offer.id } });
      expect(untouched.status).toBe('DRAFT');
    });

    it('never drags a candidate backwards down the board', async () => {
      const { application } = await seedDeal({ stageIndex: PLACEMENT_STAGE_INDEX });
      const offer = await raiseOffer(application.id);

      expect((await http.patch(`/offers/${offer.id}`, { body: { status: 'SENT' } })).status).toBe(200);

      const prisma = getSystemPrisma();
      const untouched = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
      expect(untouched.stageId).toBe(stageAt(PLACEMENT_STAGE_INDEX));
      expect(await prisma.stageHistory.count({ where: { applicationId: application.id } })).toBe(0);
    });

    it('does not touch timestamps on a plain edit', async () => {
      const { application } = await seedDeal();
      const offer = await raiseOffer(application.id, { title: 'Original' });

      const response = await http.patch(`/offers/${offer.id}`, { body: { title: 'Revised' } });
      expect(response.status).toBe(200);

      const body = response.body.data as OfferShape;
      expect(body.title).toBe('Revised');
      expect(body.status).toBe('DRAFT');
      expect(body.sentAt).toBeNull();
      expect(body.respondedAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance → placement
  // ---------------------------------------------------------------------------

  describe('accept', () => {
    it('creates the placement from the offer terms and marks the application placed', async () => {
      const { application, client, job } = await seedDeal({ ownerId: scenario.recruiter.id });
      const offer = await raiseOffer(application.id, {
        payRateCents: 4_000_000,
        billRateCents: 5_000_000,
        ratePeriod: 'ANNUAL',
        salaryCents: 5_000_000,
      });

      const startDate = new Date(Date.now() + 21 * DAY_MS).toISOString();
      const response = await http.post(`/offers/${offer.id}/accept`, {
        body: { startDate, notes: 'Starts after notice period.' },
      });
      expect(response.status).toBe(201);

      const accepted = response.body.data as OfferShape;
      expect(accepted.status).toBe('ACCEPTED');
      expect(accepted.respondedAt).not.toBeNull();
      expect(accepted.placement).not.toBeNull();
      expect(accepted.placement?.status).toBe('ACTIVE');
      expect(accepted.placement?.startDate).toBe(startDate);

      const placements = await listPlacements(`?applicationId=${application.id}`);
      expect(placements.meta.total).toBe(1);
      const placement = placements.items[0] as PlacementShape;

      expect(placement.offerId).toBe(offer.id);
      expect(placement.status).toBe('ACTIVE');
      expect(placement.payRateCents).toBe(4_000_000);
      expect(placement.billRateCents).toBe(5_000_000);
      expect(placement.currency).toBe('USD');
      expect(placement.recruiter?.id).toBe(scenario.recruiter.id);
      expect(placement.job?.id).toBe(job.id);
      expect(placement.client?.id).toBe(client.id);
      expect(placement.candidate.fullName).toContain('Casey');
      expect(placement.notes).toBe('Starts after notice period.');

      const prisma = getSystemPrisma();

      // The spread is computed once, from the offer's own rates.
      const row = await prisma.placement.findUniqueOrThrow({ where: { id: placement.id } });
      expect(row.marginCents).toBe(1_000_000);
      expect(row.marginPercentage?.toNumber()).toBe(20);

      // …and the application is closed out on the placement stage.
      const placed = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
      expect(placed.status).toBe('PLACED');
      expect(placed.stageId).toBe(stageAt(PLACEMENT_STAGE_INDEX));

      const history = await prisma.stageHistory.findMany({ where: { applicationId: application.id } });
      expect(history).toHaveLength(1);
      expect(history[0]?.note).toBe('Offer accepted');

      const activity = await prisma.activity.findFirst({
        where: { applicationId: application.id, subject: 'Offer accepted' },
      });
      expect(activity?.body).toBe('Starts after notice period.');
    });

    it('falls back to the offer’s own start date when the body omits one', async () => {
      const { application } = await seedDeal();
      const startDate = new Date(Date.now() + 14 * DAY_MS).toISOString();
      const offer = await raiseOffer(application.id, { startDate });

      const response = await http.post(`/offers/${offer.id}/accept`, { body: {} });
      expect(response.status).toBe(201);
      expect((response.body.data as OfferShape).placement?.startDate).toBe(startDate);
    });

    it('is idempotent — accepting twice does not raise a second placement', async () => {
      const { application } = await seedDeal();
      const offer = await raiseOffer(application.id);

      const first = await http.post(`/offers/${offer.id}/accept`, { body: {} });
      expect(first.status).toBe(201);
      const placementId = (first.body.data as OfferShape).placement?.id;

      const second = await http.post(`/offers/${offer.id}/accept`, { body: {} });
      expect(second.status).toBe(201);
      expect((second.body.data as OfferShape).placement?.id).toBe(placementId);

      expect(await getSystemPrisma().placement.count({ where: { applicationId: application.id } })).toBe(1);
    });

    it('refuses an offer that was already declined', async () => {
      const { application } = await seedDeal();
      const offer = await raiseOffer(application.id);
      await http.patch(`/offers/${offer.id}`, { body: { status: 'DECLINED' } });

      const response = await http.post(`/offers/${offer.id}/accept`, { body: {} });
      expect(response.status).toBe(409);
    });
  });

  // ---------------------------------------------------------------------------
  // Reading offers
  // ---------------------------------------------------------------------------

  describe('offer list', () => {
    it('filters by status, job, application and client', async () => {
      const first = await seedDeal();
      const second = await seedDeal();

      const firstOffer = await raiseOffer(first.application.id, { title: 'First' });
      const secondOffer = await raiseOffer(second.application.id, { title: 'Second' });
      await http.patch(`/offers/${secondOffer.id}`, { body: { status: 'SENT' } });

      expect((await listOffers(`?status=SENT`)).items.map((o) => o.id)).toEqual([secondOffer.id]);
      expect((await listOffers(`?jobId=${first.job.id}`)).items[0]?.id).toBe(firstOffer.id);
      expect((await listOffers(`?applicationId=${second.application.id}`)).items[0]?.id).toBe(secondOffer.id);
      expect((await listOffers(`?clientId=${first.client.id}`)).items[0]?.id).toBe(firstOffer.id);
      expect((await listOffers('?status=DRAFT')).meta.total).toBe(1);
    });

    it('searches titles and candidate names', async () => {
      const { application } = await seedDeal();
      await raiseOffer(application.id, { title: 'Principal Engineer' });

      expect((await listOffers('?q=Principal')).meta.total).toBe(1);
      expect((await listOffers('?q=Casey')).meta.total).toBe(1);
      expect((await listOffers('?q=NothingHere')).meta.total).toBe(0);
    });

    it('keeps another workspace’s offers invisible', async () => {
      const other = await createTenantScenario();
      const otherClient = await createClient(other.tenant.id);
      const otherJob = await createJob(other.tenant.id, { clientId: otherClient.id });
      const otherCandidate = await createCandidate(other.tenant.id);
      const otherApplication = await createApplication({
        tenantId: other.tenant.id,
        jobId: otherJob.id,
        candidateId: otherCandidate.id,
        stageId: other.stages[0] as string,
      });
      const foreign = await getSystemPrisma().offer.create({
        data: { tenantId: other.tenant.id, applicationId: otherApplication.id, createdById: other.admin.id },
      });

      expect((await listOffers()).items).toHaveLength(0);
      expect((await http.patch(`/offers/${foreign.id}`, { body: { title: 'x' } })).status).toBe(404);
    });

    it('soft-deletes an offer and hides it from reads', async () => {
      const { application } = await seedDeal();
      const offer = await raiseOffer(application.id);

      const response = await http.delete(`/offers/${offer.id}`);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ deleted: true });

      const row = await getSystemPrisma().offer.findUniqueOrThrow({ where: { id: offer.id } });
      expect(row.deletedAt).not.toBeNull();
      expect((await listOffers()).meta.total).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Reading placements
  // ---------------------------------------------------------------------------

  describe('placement list', () => {
    it('shows the margin to a caller who may see it', async () => {
      const { application } = await seedDeal();
      await place(application.id, { payRateCents: 3_000_000, billRateCents: 4_000_000 });

      const page = await listPlacements();
      const placement = page.items[0] as PlacementShape;
      expect(placement.margin).toEqual({ marginCents: 1_000_000, marginPercentage: 25 });
      // The rates themselves are part of the placement record.
      expect(placement.payRateCents).toBe(3_000_000);
      expect(placement.billRateCents).toBe(4_000_000);
    });

    it('withholds the margin from a recruiter who lacks `placement:view_margin`', async () => {
      const { application } = await seedDeal();
      await place(application.id, { payRateCents: 3_000_000, billRateCents: 4_000_000 });

      http.clearCookies();
      await http.login(scenario.recruiter.email, TEST_PASSWORD);

      const page = await listPlacements();
      expect(page.meta.total).toBe(1);
      expect(page.items[0]?.margin).toBeNull();

      const stats = (await http.get('/placements/stats')).body.data as StatsShape;
      expect(stats.margin).toBeNull();
      // The counts are not sensitive, so they still come through.
      expect(stats.total).toBe(1);
      expect(stats.active).toBe(1);
    });

    it('filters by status, client, job, recruiter and start-date window', async () => {
      const first = await seedDeal({ ownerId: scenario.recruiter.id });
      const second = await seedDeal({ ownerId: scenario.admin.id });

      const near = new Date(Date.now() + 5 * DAY_MS).toISOString();
      const far = new Date(Date.now() + 200 * DAY_MS).toISOString();
      const early = await place(first.application.id, {}, { startDate: near });
      const late = await place(second.application.id, {}, { startDate: far });

      expect((await listPlacements(`?clientId=${first.client.id}`)).items[0]?.id).toBe(early.placement.id);
      expect((await listPlacements(`?jobId=${second.job.id}`)).items[0]?.id).toBe(late.placement.id);
      expect((await listPlacements(`?recruiterId=${scenario.recruiter.id}`)).items[0]?.id).toBe(
        early.placement.id,
      );

      const window = new Date(Date.now() + 30 * DAY_MS).toISOString();
      expect((await listPlacements(`?to=${window}`)).items.map((p) => p.id)).toEqual([early.placement.id]);
      expect((await listPlacements(`?from=${window}`)).items.map((p) => p.id)).toEqual([late.placement.id]);

      expect((await http.patch(`/placements/${early.placement.id}`, { body: { status: 'COMPLETED' } })).status)
        .toBe(200);
      expect((await listPlacements('?status=COMPLETED')).items.map((p) => p.id)).toEqual([
        early.placement.id,
      ]);
    });

    it('scopes reads to the placements a caller owns when they hold only `read_own`', async () => {
      const mine = await seedDeal({ ownerId: scenario.recruiter.id });
      const theirs = await seedDeal({ ownerId: scenario.admin.id });
      const ownPlacement = await place(mine.application.id);
      await place(theirs.application.id);

      // Roles are editable, so a workspace can hand a recruiter own-record reads
      // without granting the whole tenant.
      const prisma = getSystemPrisma();
      const permissions = await prisma.permission.findMany({
        where: { key: { in: ['placement:read_all', 'placement:read_own'] } },
        select: { id: true, key: true },
      });
      const idFor = (key: string) => permissions.find((p) => p.key === key)?.id as string;
      const roleId = scenario.roles.get('RECRUITER') as string;

      await prisma.rolePermission.deleteMany({
        where: { roleId, permissionId: idFor('placement:read_all') },
      });
      await prisma.rolePermission.createMany({
        data: [{ tenantId: scenario.tenant.id, roleId, permissionId: idFor('placement:read_own') }],
        skipDuplicates: true,
      });

      // Log in after the change so the session picks up the new grants.
      http.clearCookies();
      await http.login(scenario.recruiter.email, TEST_PASSWORD);

      const page = await listPlacements();
      expect(page.meta.total).toBe(1);
      expect(page.items[0]?.id).toBe(ownPlacement.placement.id);
    });

    it('reports counts and margin totals', async () => {
      const first = await seedDeal();
      const second = await seedDeal();
      const third = await seedDeal();

      const a = await place(first.application.id, { payRateCents: 2_000_000, billRateCents: 4_000_000 });
      const b = await place(second.application.id, { payRateCents: 3_000_000, billRateCents: 4_000_000 });
      await place(third.application.id, { payRateCents: 1_000_000, billRateCents: 5_000_000 });

      await http.patch(`/placements/${a.placement.id}`, { body: { status: 'COMPLETED' } });
      await http.patch(`/placements/${b.placement.id}`, {
        body: { status: 'TERMINATED', feeCents: 250_000 },
      });

      const response = await http.get('/placements/stats');
      expect(response.status).toBe(200);
      const stats = response.body.data as StatsShape;

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.terminated).toBe(1);
      expect(stats.pending).toBe(0);

      // 2m + 1m + 4m across the three placements.
      expect(stats.margin?.totalMarginCents).toBe(7_000_000);
      expect(stats.margin?.totalFeeCents).toBe(250_000);
      expect(stats.margin?.currency).toBe('USD');
      expect(stats.margin?.averageMarginPercentage).toBeCloseTo((50 + 25 + 80) / 3, 1);
    });

    it('keeps another workspace’s placements invisible', async () => {
      const other = await createTenantScenario();
      const otherClient = await createClient(other.tenant.id);
      const otherJob = await createJob(other.tenant.id, { clientId: otherClient.id });
      const otherCandidate = await createCandidate(other.tenant.id);
      const otherApplication = await createApplication({
        tenantId: other.tenant.id,
        jobId: otherJob.id,
        candidateId: otherCandidate.id,
        stageId: other.stages[0] as string,
      });
      const foreign = await getSystemPrisma().placement.create({
        data: { tenantId: other.tenant.id, applicationId: otherApplication.id },
      });

      expect((await listPlacements()).items).toHaveLength(0);
      expect((await http.patch(`/placements/${foreign.id}`, { body: { status: 'ACTIVE' } })).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Correcting a placement
  // ---------------------------------------------------------------------------

  describe('placement update', () => {
    it('recomputes the margin when a rate changes', async () => {
      const { application } = await seedDeal();
      const { placement } = await place(application.id, {
        payRateCents: 3_000_000,
        billRateCents: 4_000_000,
      });
      expect(placement.margin?.marginCents).toBe(1_000_000);

      const response = await http.patch(`/placements/${placement.id}`, {
        body: { billRateCents: 5_000_000, feeCents: 500_000, guaranteeDays: 90 },
      });
      expect(response.status).toBe(200);

      const updated = response.body.data as PlacementShape;
      expect(updated.billRateCents).toBe(5_000_000);
      expect(updated.margin).toEqual({ marginCents: 2_000_000, marginPercentage: 40 });
      expect(updated.feeCents).toBe(500_000);
      expect(updated.guaranteeDays).toBe(90);
    });

    it('closes the placement with an end date when it completes', async () => {
      const { application } = await seedDeal();
      const { placement } = await place(application.id, {}, { startDate: new Date().toISOString() });
      expect(placement.endDate).toBeNull();

      const response = await http.patch(`/placements/${placement.id}`, {
        body: { status: 'COMPLETED' },
      });
      expect(response.status).toBe(200);

      const updated = response.body.data as PlacementShape;
      expect(updated.status).toBe('COMPLETED');
      expect(updated.endDate).not.toBeNull();
    });

    it('honours an explicit end date over the automatic one', async () => {
      const { application } = await seedDeal();
      const { placement } = await place(application.id);
      const endDate = new Date(Date.now() + 60 * DAY_MS).toISOString();

      const response = await http.patch(`/placements/${placement.id}`, {
        body: { status: 'TERMINATED', endDate },
      });
      expect(response.status).toBe(200);
      expect((response.body.data as PlacementShape).endDate).toBe(endDate);
    });

    it('reassigns the recruiter and refuses an unknown one', async () => {
      const { application } = await seedDeal();
      const { placement } = await place(application.id);

      const response = await http.patch(`/placements/${placement.id}`, {
        body: { recruiterId: scenario.recruiter.id },
      });
      expect(response.status).toBe(200);
      expect((response.body.data as PlacementShape).recruiter?.id).toBe(scenario.recruiter.id);

      expect(
        (await http.patch(`/placements/${placement.id}`, { body: { recruiterId: 'ghost' } })).status,
      ).toBe(404);
    });

    it('soft-deletes a placement', async () => {
      const { application } = await seedDeal();
      const { placement } = await place(application.id);

      const response = await http.delete(`/placements/${placement.id}`);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ deleted: true });

      const row = await getSystemPrisma().placement.findUniqueOrThrow({ where: { id: placement.id } });
      expect(row.deletedAt).not.toBeNull();
      expect((await listPlacements()).meta.total).toBe(0);
    });
  });
});
