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
 * Activities, tasks, notes & My Day (Phase 3, Module 5).
 *
 * The daily workspace: the task list with its filters and the `task:assign`
 * reassignment guard, the My Day read model, the logged-activity timeline, and
 * author-scoped notes.
 *
 * Conventions worth knowing when reading the expectations:
 *   - domain validation failures surface as **422** (`VALIDATION_FAILED`);
 *   - My Day buckets by the **UTC** day, so fixtures are pinned relative to
 *     UTC midnight rather than to "now".
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

interface UserRefShape {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

interface TaskShape {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  completedAt: string | null;
  reminderAt: string | null;
  isOverdue: boolean;
  assignee: UserRefShape | null;
  entityType: string | null;
  entityId: string | null;
  candidateId: string | null;
  jobId: string | null;
  parentTaskId: string | null;
  subTaskCount: number;
  createdBy: UserRefShape | null;
}

interface MyDayShape {
  date: string;
  tasks: TaskShape[];
  overdueTasks: TaskShape[];
  interviews: { id: string; applicationId: string; candidateName: string; jobTitle: string }[];
  stats: { open: number; inProgress: number; dueToday: number; overdue: number; completedToday: number };
}

interface ActivityShape {
  id: string;
  type: string;
  subject: string;
  body: string | null;
  occurredAt: string;
  durationMinutes: number | null;
  entityType: string;
  entityId: string;
  candidateId: string | null;
  outcome: string | null;
  isPinned: boolean;
  createdBy: UserRefShape | null;
}

interface NoteShape {
  id: string;
  body: string;
  isPinned: boolean;
  entityType: string;
  entityId: string;
  createdBy: UserRefShape | null;
}

interface PageShape<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number };
}

/** Midnight UTC today, the anchor My Day buckets around. */
function startOfUtcDay(): Date {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/** A moment inside today's UTC window, `minutes` after midnight. */
function todayAt(minutes: number): string {
  return new Date(startOfUtcDay().getTime() + minutes * 60_000).toISOString();
}

describe('Activities, tasks, notes & My Day (e2e)', () => {
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

  async function signInAs(email: string): Promise<void> {
    http.clearCookies();
    const response = await http.login(email, TEST_PASSWORD);
    expect(response.status).toBe(200);
  }

  async function createTask(body: Record<string, unknown>): Promise<TaskShape> {
    const response = await http.post('/tasks', { body });
    expect(response.status).toBe(201);
    return response.body.data as TaskShape;
  }

  async function listTasks(query = ''): Promise<PageShape<TaskShape>> {
    const response = await http.get(`/tasks${query}`);
    expect(response.status).toBe(200);
    return response.body.data as PageShape<TaskShape>;
  }

  // ===========================================================================
  // Tasks
  // ===========================================================================

  describe('tasks', () => {
    describe('permissions', () => {
      it('lets a viewer read tasks but not create, edit, complete or delete them', async () => {
        const task = await createTask({ title: 'Call the hiring manager' });

        await signInAs(scenario.viewer.email);

        expect((await http.get('/tasks')).status).toBe(200);
        expect((await http.get('/tasks/my-day')).status).toBe(200);
        expect((await http.post('/tasks', { body: { title: 'Nope' } })).status).toBe(403);
        expect((await http.patch(`/tasks/${task.id}`, { body: { title: 'Nope' } })).status).toBe(403);
        expect((await http.post(`/tasks/${task.id}/complete`)).status).toBe(403);
        expect((await http.delete(`/tasks/${task.id}`)).status).toBe(403);
      });

      it('lets a recruiter work tasks but not delete them', async () => {
        await signInAs(scenario.recruiter.email);

        const task = await createTask({ title: 'Chase references' });
        expect((await http.patch(`/tasks/${task.id}`, { body: { priority: 'HIGH' } })).status).toBe(200);
        expect((await http.post(`/tasks/${task.id}/complete`)).status).toBe(201);
        // RECRUITER's template deliberately omits `task:delete`.
        expect((await http.delete(`/tasks/${task.id}`)).status).toBe(403);
      });

      it('returns 404 for a task that does not exist', async () => {
        expect((await http.patch('/tasks/does-not-exist', { body: { title: 'x' } })).status).toBe(404);
        expect((await http.post('/tasks/does-not-exist/complete')).status).toBe(404);
        expect((await http.delete('/tasks/does-not-exist')).status).toBe(404);
      });
    });

    describe('create', () => {
      it('defaults the assignee to the caller and applies the schema defaults', async () => {
        const task = await createTask({ title: 'Prep the shortlist' });

        expect(task.status).toBe('OPEN');
        expect(task.priority).toBe('MEDIUM');
        expect(task.assignee?.id).toBe(scenario.admin.id);
        expect(task.createdBy?.id).toBe(scenario.admin.id);
        expect(task.isOverdue).toBe(false);
        expect(task.subTaskCount).toBe(0);
      });

      it('keeps an explicit null assignee as "nobody"', async () => {
        const task = await createTask({ title: 'Unclaimed work', assigneeId: null });
        expect(task.assignee).toBeNull();
      });

      it('links the task to a record and counts its subtasks', async () => {
        const candidate = await createCandidate(scenario.tenant.id);
        const parent = await createTask({
          title: 'Onboard candidate',
          entityType: 'CANDIDATE',
          entityId: candidate.id,
          candidateId: candidate.id,
        });
        await createTask({ title: 'Collect ID', parentTaskId: parent.id });
        await createTask({ title: 'Send contract', parentTaskId: parent.id });

        expect(parent.entityType).toBe('CANDIDATE');
        expect(parent.entityId).toBe(candidate.id);

        const roots = await listTasks('?rootOnly=true');
        expect(roots.items).toHaveLength(1);
        expect(roots.items[0]?.subTaskCount).toBe(2);

        const children = await listTasks(`?parentTaskId=${parent.id}`);
        expect(children.meta.total).toBe(2);
      });

      it('rejects a half-specified entity link', async () => {
        const candidate = await createCandidate(scenario.tenant.id);
        expect(
          (await http.post('/tasks', { body: { title: 'x', entityType: 'CANDIDATE' } })).status,
        ).toBe(422);
        expect(
          (await http.post('/tasks', { body: { title: 'x', entityId: candidate.id } })).status,
        ).toBe(422);
      });

      it('rejects references that do not exist in the workspace', async () => {
        expect((await http.post('/tasks', { body: { title: 'x', assigneeId: 'ghost' } })).status).toBe(422);
        expect((await http.post('/tasks', { body: { title: 'x', candidateId: 'ghost' } })).status).toBe(422);
        expect((await http.post('/tasks', { body: { title: 'x', jobId: 'ghost' } })).status).toBe(422);
        expect((await http.post('/tasks', { body: { title: 'x', parentTaskId: 'ghost' } })).status).toBe(422);
      });

      it('refuses to assign work to a user from another workspace', async () => {
        const other = await createTenantScenario();
        const response = await http.post('/tasks', {
          body: { title: 'Cross-tenant', assigneeId: other.recruiter.id },
        });
        expect(response.status).toBe(422);
      });
    });

    describe('update & reassignment', () => {
      it('edits the content and clears the due date', async () => {
        const task = await createTask({ title: 'Draft', dueAt: todayAt(60) });

        const response = await http.patch(`/tasks/${task.id}`, {
          body: { title: 'Final', priority: 'URGENT', dueAt: null, status: 'IN_PROGRESS' },
        });
        expect(response.status).toBe(200);

        const updated = response.body.data as TaskShape;
        expect(updated.title).toBe('Final');
        expect(updated.priority).toBe('URGENT');
        expect(updated.status).toBe('IN_PROGRESS');
        expect(updated.dueAt).toBeNull();
      });

      it('lets a holder of task:assign hand the task to someone else', async () => {
        await signInAs(scenario.recruiter.email);
        const task = await createTask({ title: 'Hand-off' });

        const response = await http.patch(`/tasks/${task.id}`, {
          body: { assigneeId: scenario.admin.id },
        });
        expect(response.status).toBe(200);
        expect((response.body.data as TaskShape).assignee?.id).toBe(scenario.admin.id);
      });

      it('refuses a reassignment from a caller without task:assign', async () => {
        // ACCOUNT_MANAGER holds `task:update` but not `task:assign`.
        const manager = await createUser({ tenantId: scenario.tenant.id, roleKey: 'ACCOUNT_MANAGER' });
        await signInAs(manager.email);
        const task = await createTask({ title: 'Mine to keep' });

        const reassign = await http.patch(`/tasks/${task.id}`, {
          body: { assigneeId: scenario.recruiter.id },
        });
        expect(reassign.status).toBe(403);

        // …while ordinary edits — and re-sending the same assignee — still work.
        const edit = await http.patch(`/tasks/${task.id}`, {
          body: { title: 'Renamed', assigneeId: manager.id },
        });
        expect(edit.status).toBe(200);
        expect((edit.body.data as TaskShape).title).toBe('Renamed');
      });
    });

    describe('complete & delete', () => {
      it('completes a task, stamps completedAt and is idempotent', async () => {
        const task = await createTask({ title: 'Book the room', dueAt: todayAt(-60 * 24) });
        expect(task.isOverdue).toBe(true);

        const first = await http.post(`/tasks/${task.id}/complete`);
        expect(first.status).toBe(201);
        const completed = first.body.data as TaskShape;
        expect(completed.status).toBe('COMPLETED');
        expect(completed.completedAt).not.toBeNull();
        // A finished task is never "late".
        expect(completed.isOverdue).toBe(false);

        const second = await http.post(`/tasks/${task.id}/complete`);
        expect(second.status).toBe(201);
        expect((second.body.data as TaskShape).completedAt).toBe(completed.completedAt);
      });

      it('soft-deletes a task and hides it from the list', async () => {
        const task = await createTask({ title: 'Throwaway' });

        const response = await http.delete(`/tasks/${task.id}`);
        expect(response.status).toBe(200);
        expect(response.body.data).toEqual({ deleted: true });

        const row = await getSystemPrisma().task.findUniqueOrThrow({ where: { id: task.id } });
        expect(row.deletedAt).not.toBeNull();
        expect((await listTasks()).meta.total).toBe(0);
        expect((await http.patch(`/tasks/${task.id}`, { body: { title: 'x' } })).status).toBe(404);
      });
    });

    describe('list', () => {
      it('filters by status, priority, assignee and overdue', async () => {
        const late = await createTask({ title: 'Late', priority: 'HIGH', dueAt: todayAt(-60 * 24) });
        const soon = await createTask({ title: 'Soon', dueAt: new Date(Date.now() + DAY_MS).toISOString() });
        const theirs = await createTask({ title: 'Theirs', assigneeId: scenario.recruiter.id });
        const done = await createTask({ title: 'Done', dueAt: todayAt(-60 * 24) });
        await http.post(`/tasks/${done.id}/complete`);

        const ids = (page: PageShape<TaskShape>) => page.items.map((item) => item.id).sort();

        expect(ids(await listTasks('?status=COMPLETED'))).toEqual([done.id]);
        expect(ids(await listTasks('?priority=HIGH'))).toEqual([late.id]);
        expect(ids(await listTasks('?overdue=true'))).toEqual([late.id]);
        expect(ids(await listTasks(`?assigneeId=${scenario.recruiter.id}`))).toEqual([theirs.id]);
        expect(ids(await listTasks('?assigneeId=me'))).toEqual([late.id, soon.id, done.id].sort());
      });

      it('sorts undated work after dated work', async () => {
        const undated = await createTask({ title: 'Someday' });
        const dated = await createTask({ title: 'Tomorrow', dueAt: new Date(Date.now() + DAY_MS).toISOString() });

        const page = await listTasks();
        expect(page.items.map((item) => item.id)).toEqual([dated.id, undated.id]);
      });

      it('resolves assigneeId=me per caller', async () => {
        await createTask({ title: 'Admin task' });
        await signInAs(scenario.recruiter.email);
        await createTask({ title: 'Recruiter task' });

        const mine = await listTasks('?assigneeId=me');
        expect(mine.items.map((item) => item.title)).toEqual(['Recruiter task']);
      });

      it('keeps another workspace’s tasks invisible', async () => {
        const other = await createTenantScenario();
        const foreign = await getSystemPrisma().task.create({
          data: { tenantId: other.tenant.id, title: 'Foreign', assigneeId: other.admin.id },
        });

        expect((await listTasks()).items).toHaveLength(0);
        expect((await http.patch(`/tasks/${foreign.id}`, { body: { title: 'x' } })).status).toBe(404);
      });
    });
  });

  // ===========================================================================
  // My Day
  // ===========================================================================

  describe('my day', () => {
    it('buckets today’s and overdue tasks plus today’s interviews for the caller', async () => {
      const today = await createTask({ title: 'Today', dueAt: todayAt(1) });
      const overdue = await createTask({ title: 'Yesterday', dueAt: todayAt(-60 * 12) });
      const finishedToday = await createTask({ title: 'Already done', dueAt: todayAt(2) });
      await http.post(`/tasks/${finishedToday.id}/complete`);
      await createTask({ title: 'Next week', dueAt: new Date(Date.now() + 7 * DAY_MS).toISOString() });
      // Someone else's work never appears on the caller's My Day.
      await createTask({ title: 'Not mine', dueAt: todayAt(3), assigneeId: scenario.recruiter.id });

      const client = await createClient(scenario.tenant.id);
      const job = await createJob(scenario.tenant.id, { clientId: client.id, status: 'OPEN', title: 'Data Engineer' });
      const candidate = await createCandidate(scenario.tenant.id);
      const application = await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: scenario.stages[0] as string,
      });
      const interview = await http.post('/interviews', {
        body: {
          applicationId: application.id,
          scheduledStart: todayAt(60 * 12),
          interviewerIds: [scenario.admin.id],
        },
      });
      expect(interview.status).toBe(201);

      const response = await http.get('/tasks/my-day');
      expect(response.status).toBe(200);
      const day = response.body.data as MyDayShape;

      expect(day.date).toBe(startOfUtcDay().toISOString());
      expect(day.tasks.map((task) => task.id)).toEqual([today.id]);
      expect(day.overdueTasks.map((task) => task.id)).toEqual([overdue.id]);
      expect(day.overdueTasks[0]?.isOverdue).toBe(true);

      expect(day.interviews).toHaveLength(1);
      expect(day.interviews[0]?.applicationId).toBe(application.id);
      expect(day.interviews[0]?.jobTitle).toBe('Data Engineer');
      expect(day.interviews[0]?.candidateName).toContain('Casey');

      expect(day.stats).toEqual({
        open: 3, // today, overdue, next week
        inProgress: 0,
        dueToday: 1,
        overdue: 1,
        completedToday: 1,
      });
    });

    it('leaves interviews the caller is not on off the panel', async () => {
      const client = await createClient(scenario.tenant.id);
      const job = await createJob(scenario.tenant.id, { clientId: client.id, status: 'OPEN' });
      const candidate = await createCandidate(scenario.tenant.id);
      const application = await createApplication({
        tenantId: scenario.tenant.id,
        jobId: job.id,
        candidateId: candidate.id,
        stageId: scenario.stages[0] as string,
      });
      await http.post('/interviews', {
        body: {
          applicationId: application.id,
          scheduledStart: todayAt(60 * 12),
          interviewerIds: [scenario.recruiter.id],
        },
      });

      const day = (await http.get('/tasks/my-day')).body.data as MyDayShape;
      expect(day.interviews).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Activities
  // ===========================================================================

  describe('activities', () => {
    async function logActivity(body: Record<string, unknown>): Promise<ActivityShape> {
      const response = await http.post('/activities', { body });
      expect(response.status).toBe(201);
      return response.body.data as ActivityShape;
    }

    it('logs a call against a record and lists it on that record’s timeline', async () => {
      const candidate = await createCandidate(scenario.tenant.id);

      const call = await logActivity({
        type: 'CALL',
        subject: 'Screening call',
        body: 'Open to relocation.',
        durationMinutes: 25,
        entityType: 'CANDIDATE',
        entityId: candidate.id,
        candidateId: candidate.id,
      });

      expect(call.type).toBe('CALL');
      expect(call.durationMinutes).toBe(25);
      expect(call.createdBy?.id).toBe(scenario.admin.id);

      const response = await http.get(`/activities?entityType=CANDIDATE&entityId=${candidate.id}`);
      expect(response.status).toBe(200);
      const page = response.body.data as PageShape<ActivityShape>;
      expect(page.items.map((item) => item.id)).toEqual([call.id]);
    });

    it('filters by type, date range and mine', async () => {
      const client = await createClient(scenario.tenant.id);
      const base = { entityType: 'CLIENT', entityId: client.id };

      const call = await logActivity({ ...base, type: 'CALL', subject: 'Intro call' });
      const meeting = await logActivity({
        ...base,
        type: 'MEETING',
        subject: 'Quarterly review',
        occurredAt: new Date(Date.now() - 10 * DAY_MS).toISOString(),
      });

      await signInAs(scenario.recruiter.email);
      const theirs = await logActivity({ ...base, type: 'NOTE', subject: 'Recruiter note' });

      const ids = async (query: string) =>
        ((await http.get(`/activities?entityType=CLIENT&entityId=${client.id}${query}`)).body
          .data as PageShape<ActivityShape>).items.map((item) => item.id).sort();

      expect(await ids('&type=MEETING')).toEqual([meeting.id]);
      expect(await ids('&type=CALL&type=NOTE')).toEqual([call.id, theirs.id].sort());
      expect(await ids(`&from=${new Date(Date.now() - DAY_MS).toISOString()}`)).toEqual(
        [call.id, theirs.id].sort(),
      );
      expect(await ids('&mine=true')).toEqual([theirs.id]);
    });

    it('corrects a logged activity without moving it to another record', async () => {
      const candidate = await createCandidate(scenario.tenant.id);
      const call = await logActivity({
        type: 'CALL',
        subject: 'Call',
        entityType: 'CANDIDATE',
        entityId: candidate.id,
      });

      const response = await http.patch(`/activities/${call.id}`, {
        body: { subject: 'Follow-up call', outcome: 'Left voicemail', isPinned: true },
      });
      expect(response.status).toBe(200);

      const updated = response.body.data as ActivityShape;
      expect(updated.subject).toBe('Follow-up call');
      expect(updated.outcome).toBe('Left voicemail');
      expect(updated.isPinned).toBe(true);
      expect(updated.entityId).toBe(candidate.id);
    });

    it('soft-deletes an activity (admin) and refuses a recruiter', async () => {
      const candidate = await createCandidate(scenario.tenant.id);
      const call = await logActivity({ type: 'CALL', subject: 'Call', entityType: 'CANDIDATE', entityId: candidate.id });

      await signInAs(scenario.recruiter.email);
      expect((await http.delete(`/activities/${call.id}`)).status).toBe(403);

      await signInAs(scenario.admin.email);
      expect((await http.delete(`/activities/${call.id}`)).status).toBe(200);
      const page = (await http.get(`/activities?entityId=${candidate.id}`)).body.data as PageShape<ActivityShape>;
      expect(page.meta.total).toBe(0);
    });

    it('rejects a stale candidate link and a viewer write', async () => {
      const candidate = await createCandidate(scenario.tenant.id);
      expect(
        (await http.post('/activities', {
          body: { type: 'CALL', subject: 'x', entityType: 'CANDIDATE', entityId: candidate.id, candidateId: 'ghost' },
        })).status,
      ).toBe(422);

      await signInAs(scenario.viewer.email);
      expect(
        (await http.post('/activities', {
          body: { type: 'CALL', subject: 'x', entityType: 'CANDIDATE', entityId: candidate.id },
        })).status,
      ).toBe(403);
    });
  });

  // ===========================================================================
  // Notes
  // ===========================================================================

  describe('notes', () => {
    async function addNote(body: Record<string, unknown>): Promise<NoteShape> {
      const response = await http.post('/notes', { body });
      expect(response.status).toBe(201);
      return response.body.data as NoteShape;
    }

    it('adds notes to a record and lists pinned ones first', async () => {
      const job = await createJob(scenario.tenant.id);
      const plain = await addNote({ body: 'Budget approved', entityType: 'JOB', entityId: job.id });
      const pinned = await addNote({ body: 'Hiring manager is on leave', entityType: 'JOB', entityId: job.id, isPinned: true });

      const page = (await http.get(`/notes?entityType=JOB&entityId=${job.id}`)).body.data as PageShape<NoteShape>;
      expect(page.items.map((note) => note.id)).toEqual([pinned.id, plain.id]);

      const pinnedOnly = (await http.get(`/notes?entityId=${job.id}&pinnedOnly=true`)).body.data as PageShape<NoteShape>;
      expect(pinnedOnly.items.map((note) => note.id)).toEqual([pinned.id]);
    });

    it('lets the author edit their own note', async () => {
      await signInAs(scenario.recruiter.email);
      const job = await createJob(scenario.tenant.id);
      const note = await addNote({ body: 'Draft', entityType: 'JOB', entityId: job.id });

      const response = await http.patch(`/notes/${note.id}`, { body: { body: 'Edited', isPinned: true } });
      expect(response.status).toBe(200);
      expect((response.body.data as NoteShape).body).toBe('Edited');
      expect((response.body.data as NoteShape).isPinned).toBe(true);
    });

    it('refuses to let a non-author without moderation rights edit someone else’s note', async () => {
      const job = await createJob(scenario.tenant.id);
      const note = await addNote({ body: 'Admin note', entityType: 'JOB', entityId: job.id });

      // RECRUITER holds `note:update` ("edit own notes") but not `note:delete`.
      await signInAs(scenario.recruiter.email);
      const response = await http.patch(`/notes/${note.id}`, { body: { body: 'Hijacked' } });
      expect(response.status).toBe(403);

      const row = await getSystemPrisma().note.findUniqueOrThrow({ where: { id: note.id } });
      expect(row.body).toBe('Admin note');
    });

    it('lets a moderator edit and delete anyone’s note', async () => {
      await signInAs(scenario.recruiter.email);
      const job = await createJob(scenario.tenant.id);
      const note = await addNote({ body: 'Recruiter note', entityType: 'JOB', entityId: job.id });

      await signInAs(scenario.admin.email);
      expect((await http.patch(`/notes/${note.id}`, { body: { body: 'Moderated' } })).status).toBe(200);
      expect((await http.delete(`/notes/${note.id}`)).status).toBe(200);
      expect((await http.patch(`/notes/${note.id}`, { body: { body: 'x' } })).status).toBe(404);
    });

    it('keeps delete to holders of note:delete and writes off-limits to a viewer', async () => {
      await signInAs(scenario.recruiter.email);
      const job = await createJob(scenario.tenant.id);
      const note = await addNote({ body: 'Mine', entityType: 'JOB', entityId: job.id });
      expect((await http.delete(`/notes/${note.id}`)).status).toBe(403);

      await signInAs(scenario.viewer.email);
      expect((await http.get(`/notes?entityId=${job.id}`)).status).toBe(200);
      expect((await http.post('/notes', { body: { body: 'x', entityType: 'JOB', entityId: job.id } })).status).toBe(403);
    });

    it('rejects a stale candidate link', async () => {
      const candidate = await createCandidate(scenario.tenant.id);
      const response = await http.post('/notes', {
        body: { body: 'x', entityType: 'CANDIDATE', entityId: candidate.id, candidateId: 'ghost' },
      });
      expect(response.status).toBe(422);
    });
  });
});
