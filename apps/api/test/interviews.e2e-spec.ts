import {
  createApplication,
  createCandidate,
  createClient,
  createJob,
  createTenantScenario,
  TEST_PASSWORD,
  type TenantScenario,
} from './factories';
import { disconnectTestDatabases, getSystemPrisma, resetDatabase } from './utils/db';
import { createTestApp, type TestApp } from './utils/test-app';
import { TestHttpClient } from './utils/test-http';

/**
 * Interviews (Phase 3, Module 3).
 *
 * An interview belongs to an application, so these specs exercise scheduling on
 * top of the application lifecycle: the panel, the reschedule/status semantics,
 * the scorecard, the calendar window, and the workspace-wide `/interviews`
 * list with its filters.
 *
 * Two conventions matter when reading the expectations:
 *   - domain validation failures surface as **422** (`VALIDATION_FAILED`), not 400;
 *   - `interview:*` permissions are flat (`interview:read`), so the list applies
 *     no owner scoping — a read-only viewer sees every interview in the tenant.
 */

const HOUR_MS = 3_600_000;

interface InterviewParticipantShape {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  isLead: boolean;
}

interface InterviewListItemShape {
  id: string;
  type: string;
  status: string;
  round: number;
  title: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  durationMinutes: number;
  timezone: string;
  location: string | null;
  meetingUrl: string | null;
  externalInterviewer: string | null;
  application: {
    id: string;
    job: { id: string; title: string; referenceCode: string };
    candidate: { id: string; fullName: string };
    client: { id: string; name: string } | null;
  };
  interviewers: InterviewParticipantShape[];
  ageDays: number;
  hasFeedback: boolean;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
}

interface InterviewDetailShape extends InterviewListItemShape {
  feedback: string | null;
  strengths: string | null;
  concerns: string | null;
  feedbackAt: string | null;
  submittedBy: { id: string; fullName: string; avatarUrl: string | null } | null;
}

interface CalendarItemShape {
  id: string;
  title: string;
  status: string;
  scheduledStart: string;
  applicationId: string;
  candidateName: string;
  jobTitle: string;
  interviewers: { id: string; fullName: string; avatarUrl: string | null }[];
}

interface PageShape<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number };
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * HOUR_MS).toISOString();
}

describe('Interviews (e2e)', () => {
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

  /** The tenant-default pipeline places the `INTERVIEW` stage at index 4. */
  const INTERVIEW_STAGE_INDEX = 4;
  const OFFER_STAGE_INDEX = 5;

  function stageAt(index: number): string {
    const stageId = scenario.stages[index];
    if (!stageId) throw new Error(`The scenario has no stage at index ${index}`);
    return stageId;
  }

  /** A client-linked job with a candidate on it — everything scheduling needs. */
  async function seedInterviewable(options: { stageIndex?: number } = {}) {
    const client = await createClient(scenario.tenant.id, { name: 'Northwind Trading' });
    const job = await createJob(scenario.tenant.id, { clientId: client.id, status: 'OPEN' });
    const candidate = await createCandidate(scenario.tenant.id);
    const application = await createApplication({
      tenantId: scenario.tenant.id,
      jobId: job.id,
      candidateId: candidate.id,
      stageId: stageAt(options.stageIndex ?? 0),
    });
    return { client, job, candidate, application };
  }

  /** Schedules through the API and returns the created detail. */
  async function schedule(
    applicationId: string,
    body: Record<string, unknown> = {},
  ): Promise<InterviewDetailShape> {
    const response = await http.post('/interviews', {
      body: { applicationId, scheduledStart: hoursFromNow(24), ...body },
    });
    expect(response.status).toBe(201);
    return response.body.data as InterviewDetailShape;
  }

  function listInterviews(query = ''): Promise<PageShape<InterviewListItemShape>> {
    return http.get(`/interviews${query}`).then((response) => {
      expect(response.status).toBe(200);
      return response.body.data as PageShape<InterviewListItemShape>;
    });
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    it('lets a viewer read interviews but not schedule, edit, score or cancel', async () => {
      const { application } = await seedInterviewable();
      const interview = await schedule(application.id);

      http.clearCookies();
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      expect((await http.get('/interviews')).status).toBe(200);
      expect((await http.get(`/interviews/${interview.id}`)).status).toBe(200);
      expect(
        (await http.post('/interviews', {
          body: { applicationId: application.id, scheduledStart: hoursFromNow(48) },
        })).status,
      ).toBe(403);
      expect((await http.patch(`/interviews/${interview.id}`, { body: { round: 2 } })).status).toBe(403);
      expect(
        (await http.post(`/interviews/${interview.id}/feedback`, {
          body: { feedback: 'Nope', rating: 3 },
        })).status,
      ).toBe(403);
      expect((await http.delete(`/interviews/${interview.id}`)).status).toBe(403);
    });

    it('lets a recruiter work an interview but not cancel it', async () => {
      const { application } = await seedInterviewable();

      http.clearCookies();
      await http.login(scenario.recruiter.email, TEST_PASSWORD);

      const created = await http.post('/interviews', {
        body: { applicationId: application.id, scheduledStart: hoursFromNow(24) },
      });
      expect(created.status).toBe(201);

      const interviewId = (created.body.data as InterviewDetailShape).id;
      expect((await http.patch(`/interviews/${interviewId}`, { body: { round: 2 } })).status).toBe(200);
      expect(
        (await http.post(`/interviews/${interviewId}/feedback`, {
          body: { feedback: 'Solid fundamentals.', rating: 4 },
        })).status,
      ).toBe(201);
      // RECRUITER's template deliberately omits `interview:delete`.
      expect((await http.delete(`/interviews/${interviewId}`)).status).toBe(403);
    });

    it('returns 404 for an interview that does not exist', async () => {
      expect((await http.get('/interviews/does-not-exist')).status).toBe(404);
      expect((await http.patch('/interviews/does-not-exist', { body: { round: 2 } })).status).toBe(404);
      expect((await http.delete('/interviews/does-not-exist')).status).toBe(404);
      expect(
        (await http.post('/interviews/does-not-exist/feedback', {
          body: { feedback: 'Ghost', rating: 3 },
        })).status,
      ).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------

  describe('schedule', () => {
    it('creates the interview, seats the panel, logs it and advances the board', async () => {
      const { application, job, candidate } = await seedInterviewable({ stageIndex: 0 });

      const interview = await schedule(application.id, {
        type: 'TECHNICAL',
        round: 2,
        title: 'Platform deep dive',
        interviewerIds: [scenario.recruiter.id, scenario.admin.id],
        location: 'Meet link',
        timezone: 'Asia/Calcutta',
      });

      expect(interview.type).toBe('TECHNICAL');
      expect(interview.status).toBe('SCHEDULED');
      expect(interview.round).toBe(2);
      expect(interview.title).toBe('Platform deep dive');
      expect(interview.timezone).toBe('Asia/Calcutta');
      expect(interview.durationMinutes).toBe(60);
      expect(interview.application.id).toBe(application.id);
      expect(interview.application.candidate.fullName).toContain('Casey');
      expect(interview.application.job.id).toBe(job.id);
      expect(interview.application.client?.name).toBe('Northwind Trading');
      expect(interview.ageDays).toBe(0);
      expect(interview.hasFeedback).toBe(false);

      // The first interviewer listed is the lead, then alphabetical.
      expect(interview.interviewers).toHaveLength(2);
      expect(interview.interviewers[0]?.id).toBe(scenario.recruiter.id);
      expect(interview.interviewers[0]?.isLead).toBe(true);
      expect(interview.interviewers[1]?.isLead).toBe(false);

      const prisma = getSystemPrisma();

      // The timeline gets an INTERVIEW activity…
      const activity = await prisma.activity.findFirst({
        where: { applicationId: application.id, type: 'INTERVIEW' },
      });
      expect(activity?.subject).toBe('Technical interview · round 2');
      expect(activity?.jobId).toBe(job.id);
      expect(activity?.candidateId).toBe(candidate.id);

      // …and the candidate is walked forward onto the INTERVIEW stage.
      const moved = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
      expect(moved.stageId).toBe(stageAt(INTERVIEW_STAGE_INDEX));

      const history = await prisma.stageHistory.findMany({ where: { applicationId: application.id } });
      expect(history).toHaveLength(1);
      expect(history[0]?.toStageId).toBe(stageAt(INTERVIEW_STAGE_INDEX));
      expect(history[0]?.note).toBe('Interview scheduled');
    });

    it('derives the end and duration when only a start is given', async () => {
      const { application } = await seedInterviewable();
      const start = new Date(hoursFromNow(24));

      const interview = await schedule(application.id, { scheduledStart: start.toISOString() });

      const end = new Date(interview.scheduledEnd);
      expect(end.getTime() - start.getTime()).toBe(60 * 60_000);
      expect(interview.durationMinutes).toBe(60);
    });

    it('honours an explicit end over the duration', async () => {
      const { application } = await seedInterviewable();

      const interview = await schedule(application.id, {
        scheduledStart: hoursFromNow(24),
        scheduledEnd: hoursFromNow(25.5),
        durationMinutes: 15,
      });

      expect(interview.durationMinutes).toBe(90);
    });

    it('never drags a candidate backwards down the board', async () => {
      const { application } = await seedInterviewable({ stageIndex: OFFER_STAGE_INDEX });

      const interview = await schedule(application.id);

      // The interview still exists…
      expect(interview.application.id).toBe(application.id);

      // …but the application stays on the offer stage.
      const prisma = getSystemPrisma();
      const untouched = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
      expect(untouched.stageId).toBe(stageAt(OFFER_STAGE_INDEX));
      expect(await prisma.stageHistory.count({ where: { applicationId: application.id } })).toBe(0);
    });

    it('rejects an end that is not after the start', async () => {
      const { application } = await seedInterviewable();

      const response = await http.post('/interviews', {
        body: {
          applicationId: application.id,
          scheduledStart: hoursFromNow(24),
          scheduledEnd: hoursFromNow(23),
        },
      });
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

      const response = await http.post('/interviews', {
        body: { applicationId: foreign.id, scheduledStart: hoursFromNow(24) },
      });
      expect(response.status).toBe(404);
    });

    it('refuses an interviewer who is not a workspace user', async () => {
      const { application } = await seedInterviewable();

      const response = await http.post('/interviews', {
        body: {
          applicationId: application.id,
          scheduledStart: hoursFromNow(24),
          interviewerIds: ['does-not-exist'],
        },
      });
      expect(response.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // Rescheduling and status
  // ---------------------------------------------------------------------------

  describe('update', () => {
    it('marks the interview RESCHEDULED when the start actually moves', async () => {
      const { application } = await seedInterviewable();
      const interview = await schedule(application.id);

      const response = await http.patch(`/interviews/${interview.id}`, {
        body: { scheduledStart: hoursFromNow(72) },
      });
      expect(response.status).toBe(200);

      const updated = response.body.data as InterviewDetailShape;
      expect(updated.status).toBe('RESCHEDULED');

      const activity = await getSystemPrisma().activity.findFirst({
        where: { applicationId: application.id, subject: 'Interview rescheduled' },
      });
      expect(activity).not.toBeNull();
    });

    it('lets an explicit status win over the reschedule default', async () => {
      const { application } = await seedInterviewable();
      const interview = await schedule(application.id);

      const response = await http.patch(`/interviews/${interview.id}`, {
        body: { scheduledStart: hoursFromNow(72), status: 'CONFIRMED' },
      });
      expect(response.status).toBe(200);
      expect((response.body.data as InterviewDetailShape).status).toBe('CONFIRMED');
    });

    it('does not add a status event when a plain field changes', async () => {
      const { application } = await seedInterviewable();
      const interview = await schedule(application.id);

      const response = await http.patch(`/interviews/${interview.id}`, {
        body: { title: 'Renamed panel' },
      });
      expect(response.status).toBe(200);
      expect((response.body.data as InterviewDetailShape).status).toBe('SCHEDULED');

      const events = await getSystemPrisma().activity.count({
        where: { applicationId: application.id, type: 'INTERVIEW' },
      });
      expect(events).toBe(1); // just the scheduling event
    });

    it('rewrites the panel and re-marks the lead', async () => {
      const { application } = await seedInterviewable();
      const interview = await schedule(application.id, { interviewerIds: [scenario.recruiter.id] });

      const response = await http.patch(`/interviews/${interview.id}`, {
        body: { interviewerIds: [scenario.admin.id, scenario.recruiter.id] },
      });
      expect(response.status).toBe(200);

      const panel = (response.body.data as InterviewDetailShape).interviewers;
      expect(panel).toHaveLength(2);
      expect(panel[0]?.id).toBe(scenario.admin.id);
      expect(panel[0]?.isLead).toBe(true);
      expect(panel[1]?.id).toBe(scenario.recruiter.id);
      expect(panel[1]?.isLead).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Feedback
  // ---------------------------------------------------------------------------

  describe('feedback', () => {
    it('stores the scorecard and closes the interview', async () => {
      const { application } = await seedInterviewable();
      const interview = await schedule(application.id);

      const response = await http.post(`/interviews/${interview.id}/feedback`, {
        body: {
          feedback: 'Strong on systems design, light on testing.',
          rating: 4,
          strengths: 'Clear communicator',
          concerns: 'Wants a bigger scope than the role offers',
        },
      });
      expect(response.status).toBe(201);

      const detail = response.body.data as InterviewDetailShape;
      expect(detail.status).toBe('COMPLETED');
      expect(detail.hasFeedback).toBe(true);
      expect(detail.rating).toBe(4);
      expect(detail.feedback).toBe('Strong on systems design, light on testing.');
      expect(detail.strengths).toBe('Clear communicator');
      expect(detail.feedbackAt).not.toBeNull();
      expect(detail.submittedBy?.id).toBe(scenario.admin.id);

      const activity = await getSystemPrisma().activity.findFirst({
        where: { applicationId: application.id, subject: 'Interview feedback · 4/5' },
      });
      expect(activity?.body).toBe('Strong on systems design, light on testing.');
    });

    it('refuses to score an interview that was cancelled', async () => {
      const { application } = await seedInterviewable();
      const interview = await schedule(application.id);
      // A status change to CANCELLED keeps the row live (unlike a delete), so the
      // scorecard guard is what rejects the write.
      await http.patch(`/interviews/${interview.id}`, { body: { status: 'CANCELLED' } });

      const response = await http.post(`/interviews/${interview.id}/feedback`, {
        body: { feedback: 'Too late', rating: 2 },
      });
      expect(response.status).toBe(422);
    });

    it('reads a cancelled interview as gone once it is deleted', async () => {
      const { application } = await seedInterviewable();
      const interview = await schedule(application.id);
      await http.delete(`/interviews/${interview.id}`);

      const response = await http.post(`/interviews/${interview.id}/feedback`, {
        body: { feedback: 'Too late', rating: 2 },
      });
      expect(response.status).toBe(404);
    });

    it('rejects a rating outside 1–5', async () => {
      const { application } = await seedInterviewable();
      const interview = await schedule(application.id);

      const response = await http.post(`/interviews/${interview.id}/feedback`, {
        body: { feedback: 'Six out of five', rating: 6 },
      });
      expect(response.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // Cancellation
  // ---------------------------------------------------------------------------

  describe('cancel', () => {
    it('soft-deletes, marks the status cancelled and hides it from reads', async () => {
      const { application } = await seedInterviewable();
      const interview = await schedule(application.id);

      const response = await http.delete(`/interviews/${interview.id}`);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ deleted: true });

      const prisma = getSystemPrisma();
      const row = await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } });
      expect(row.status).toBe('CANCELLED');
      expect(row.deletedAt).not.toBeNull();

      expect((await http.get(`/interviews/${interview.id}`)).status).toBe(404);
      expect((await listInterviews()).meta.total).toBe(0);

      const activity = await prisma.activity.findFirst({
        where: { applicationId: application.id, subject: 'Interview cancelled' },
      });
      expect(activity).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  describe('list', () => {
    it('filters by status, type, job, candidate and interviewer', async () => {
      const first = await seedInterviewable();
      const second = await seedInterviewable();

      const firstInterview = await schedule(first.application.id, {
        type: 'PHONE',
        interviewerIds: [scenario.recruiter.id],
      });
      const secondInterview = await schedule(second.application.id, { type: 'ONSITE' });

      expect((await listInterviews('?type=PHONE')).items[0]?.id).toBe(firstInterview.id);
      expect((await listInterviews(`?jobId=${second.job.id}`)).items[0]?.id).toBe(secondInterview.id);
      expect((await listInterviews(`?candidateId=${second.candidate.id}`)).items[0]?.id).toBe(
        secondInterview.id,
      );
      expect((await listInterviews(`?interviewerId=${scenario.recruiter.id}`)).items[0]?.id).toBe(
        firstInterview.id,
      );

      await http.patch(`/interviews/${secondInterview.id}`, { body: { status: 'CONFIRMED' } });
      expect((await listInterviews('?status=CONFIRMED')).items[0]?.id).toBe(secondInterview.id);
    });

    it('separates what is still ahead from what has passed', async () => {
      const ahead = await seedInterviewable();
      const behind = await seedInterviewable();

      await schedule(ahead.application.id, { scheduledStart: hoursFromNow(48) });
      const past = await schedule(behind.application.id, { scheduledStart: hoursFromNow(-48) });

      const upcoming = await listInterviews('?upcoming=true');
      expect(upcoming.meta.total).toBe(1);
      expect(upcoming.items[0]?.id).not.toBe(past.id);

      const history = await listInterviews(`?to=${new Date().toISOString()}`);
      expect(history.items.map((item) => item.id)).toContain(past.id);
      expect(history.items).toHaveLength(1);
    });

    it('flags rows that already carry a scorecard', async () => {
      const { application } = await seedInterviewable();
      const interview = await schedule(application.id);
      await http.post(`/interviews/${interview.id}/feedback`, { body: { feedback: 'Good', rating: 5 } });

      const page = await listInterviews();
      expect(page.items[0]?.hasFeedback).toBe(true);
      expect(page.items[0]?.rating).toBe(5);
    });

    it('does not narrow reads by owner — the permission is flat', async () => {
      const { application } = await seedInterviewable();
      await schedule(application.id);

      // The admin scheduled it; a viewer in the same workspace still sees it.
      http.clearCookies();
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      expect((await listInterviews()).meta.total).toBe(1);
    });

    it('keeps another workspace’s interviews invisible', async () => {
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
      const foreign = await getSystemPrisma().interview.create({
        data: {
          tenantId: other.tenant.id,
          applicationId: otherApplication.id,
          scheduledStart: new Date(Date.now() + HOUR_MS),
          scheduledEnd: new Date(Date.now() + 2 * HOUR_MS),
          createdById: other.admin.id,
        },
      });

      expect((await listInterviews()).items).toHaveLength(0);
      expect((await http.get(`/interviews/${foreign.id}`)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Calendar
  // ---------------------------------------------------------------------------

  describe('calendar', () => {
    it('returns a window of live interviews with the lean shape', async () => {
      const { application } = await seedInterviewable();
      const interview = await schedule(application.id, {
        scheduledStart: hoursFromNow(24),
        interviewerIds: [scenario.recruiter.id],
      });

      const from = hoursFromNow(0);
      const to = hoursFromNow(48);
      const response = await http.get(`/interviews/calendar?from=${from}&to=${to}`);
      expect(response.status).toBe(200);

      const items = response.body.data as CalendarItemShape[];
      expect(items).toHaveLength(1);
      expect(items[0]?.id).toBe(interview.id);
      expect(items[0]?.applicationId).toBe(application.id);
      expect(items[0]?.candidateName).toContain('Casey');
      expect(items[0]?.interviewers[0]?.id).toBe(scenario.recruiter.id);
      // The lean shape omits the heavier fields the list carries.
      expect(items[0]).not.toHaveProperty('application');
    });

    it('leaves cancelled interviews off the calendar', async () => {
      const { application } = await seedInterviewable();
      const interview = await schedule(application.id, { scheduledStart: hoursFromNow(24) });
      await http.delete(`/interviews/${interview.id}`);

      const response = await http.get(
        `/interviews/calendar?from=${hoursFromNow(0)}&to=${hoursFromNow(48)}`,
      );
      expect(response.status).toBe(200);
      expect(response.body.data as CalendarItemShape[]).toHaveLength(0);
    });

    it('rejects a window that ends before it starts', async () => {
      const response = await http.get(
        `/interviews/calendar?from=${hoursFromNow(48)}&to=${hoursFromNow(0)}`,
      );
      expect(response.status).toBe(422);
    });
  });
});
