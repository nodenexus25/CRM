import { RESUME_MAX_BYTES } from '@talentflow/types';

import { createTenantScenario, TEST_PASSWORD, type TenantScenario } from './factories';
import { disconnectTestDatabases, getSystemPrisma, resetDatabase } from './utils/db';
import { createTestApp, type TestApp } from './utils/test-app';
import { TestHttpClient } from './utils/test-http';

/**
 * Resume parsing (Phase 2, Module 5).
 *
 * Exercises the full upload → parse → review → accept lifecycle against real
 * infrastructure: the presigned `PUT` lands bytes in object storage, the
 * `resume-parse` worker downloads and parses them, and the reviewer folds the
 * result into a candidate. Nothing here stubs storage, the queue or the parser —
 * the suite only stops at the LLM boundary, which the test environment leaves
 * unconfigured so the deterministic regex parser runs.
 */

interface ResumeSummaryShape {
  id: string;
  candidateId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isPrimary: boolean;
  parseStatus: string;
  parserUsed: string | null;
  parserConfidence: number | null;
  parsedAt: string | null;
  uploadedBy: { id: string; fullName: string } | null;
}

interface ResumeDetailShape extends ResumeSummaryShape {
  storageKey: string;
  extractedText: string | null;
  parsedData: {
    email: string | null;
    phone: string | null;
    fullName: string | null;
    skills: { name: string }[];
  } | null;
  normalizedSkills: { name: string; matchedName: string; category: string | null }[];
  parseError: string | null;
  downloadUrl: string | null;
}

interface ResumeUploadTicketShape {
  resumeId: string;
  storageKey: string;
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

interface AcceptResponseShape {
  resumeId: string;
  candidateId: string;
  created: boolean;
  applied: {
    profile: boolean;
    skills: number;
    experiences: number;
    educations: number;
    certifications: number;
    languages: number;
  };
  candidate: {
    id: string;
    firstName: string;
    lastName: string;
    candidateSkills: { skillId: string; name: string }[];
  };
}

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'NEEDS_OCR']);

/** A plain-text resume the regex parser can fully resolve. */
const TEXT_RESUME = [
  'Jordan Blake',
  'Senior Software Engineer',
  'jordan.blake@example.test | +1 415 555 0132',
  'San Francisco, CA',
  'https://www.linkedin.com/in/jordanblake',
  '',
  'Summary',
  'Backend engineer with 8 years of experience building distributed systems.',
  '',
  'Skills',
  'TypeScript, Node.js, PostgreSQL, Docker, Kubernetes, React',
  '',
  'Experience',
  'Senior Software Engineer at Acme Corp',
  'Jan 2019 - Present',
  '',
  'Education',
  'B.Tech in Computer Science',
  'IIT Bombay',
].join('\n');

/**
 * Byte-accurate PDF with a single page whose content stream draws nothing and
 * contains no text — a stand-in for a scanned resume with no text layer.
 */
function buildTextlessPdf(): Buffer {
  const content = 'q\nQ\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

describe('Resumes (e2e)', () => {
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

  /** Reserves a ticket, uploads the bytes to storage, and returns the ticket. */
  async function putFile(input: {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<ResumeUploadTicketShape> {
    const ticketResponse = await http.post('/resumes/upload-url', {
      body: { fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.buffer.length },
    });
    expect(ticketResponse.status).toBe(201);
    const ticket = ticketResponse.body.data as ResumeUploadTicketShape;

    const put = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.headers,
      body: input.buffer,
    });
    expect(put.ok).toBe(true);

    return ticket;
  }

  async function completeUpload(
    resumeId: string,
    body: Record<string, unknown> = {},
  ): Promise<ResumeDetailShape> {
    const response = await http.post(`/resumes/${resumeId}/complete`, { body });
    expect(response.status).toBe(201);
    return response.body.data as ResumeDetailShape;
  }

  /** Polls the detail endpoint until the worker reaches a terminal state. */
  async function waitForParse(resumeId: string): Promise<ResumeDetailShape> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const response = await http.get(`/resumes/${resumeId}`);
      expect(response.status).toBe(200);
      const detail = response.body.data as ResumeDetailShape;
      if (TERMINAL_STATUSES.has(detail.parseStatus)) return detail;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Resume ${resumeId} did not reach a terminal parse status in time`);
  }

  async function uploadAndParseTextResume(): Promise<ResumeDetailShape> {
    const ticket = await putFile({
      fileName: 'jordan-blake.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(TEXT_RESUME, 'utf8'),
    });
    await completeUpload(ticket.resumeId);
    return waitForParse(ticket.resumeId);
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    it('lets a viewer read resumes but not upload, accept, edit or delete them', async () => {
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      expect((await http.get('/resumes')).status).toBe(200);
      expect(
        (
          await http.post('/resumes/upload-url', {
            body: { fileName: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
          })
        ).status,
      ).toBe(403);
      expect((await http.post('/resumes/abc/accept', { body: {} })).status).toBe(403);
      expect((await http.patch('/resumes/abc', { body: { fileName: 'x.pdf' } })).status).toBe(403);
      expect((await http.delete('/resumes/abc')).status).toBe(403);
    });

    it('lets a recruiter reserve an upload', async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);

      const response = await http.post('/resumes/upload-url', {
        body: { fileName: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
      });
      expect(response.status).toBe(201);
      expect((response.body.data as ResumeUploadTicketShape).uploadUrl).toContain('http');
    });
  });

  // ---------------------------------------------------------------------------
  // Upload validation
  // ---------------------------------------------------------------------------

  describe('upload validation', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('rejects an unsupported content type', async () => {
      const response = await http.post('/resumes/upload-url', {
        body: { fileName: 'archive.zip', mimeType: 'application/zip', sizeBytes: 1024 },
      });
      expect(response.status).toBe(422);
    });

    it('rejects an extension that does not match the declared content type', async () => {
      const response = await http.post('/resumes/upload-url', {
        body: { fileName: 'resume.txt', mimeType: 'application/pdf', sizeBytes: 1024 },
      });
      expect(response.status).toBe(422);
    });

    it('rejects a file above the 10 MB ceiling', async () => {
      const response = await http.post('/resumes/upload-url', {
        body: {
          fileName: 'huge.pdf',
          mimeType: 'application/pdf',
          sizeBytes: RESUME_MAX_BYTES + 1,
        },
      });
      expect(response.status).toBe(422);
    });

    /**
     * The client PUTs straight to storage, so the declared content type is only
     * a claim until the API re-reads the object's signature on completion.
     */
    it('rejects an upload whose bytes do not match the declared content type', async () => {
      const ticket = await putFile({
        fileName: 'not-really-a.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('just some plain text, not a PDF at all', 'utf8'),
      });

      const response = await http.post(`/resumes/${ticket.resumeId}/complete`, { body: {} });
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });

  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------

  describe('parsing', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('parses a text resume end-to-end and exposes structured data', async () => {
      const detail = await uploadAndParseTextResume();

      expect(detail.parseStatus).toBe('COMPLETED');
      expect(detail.parserUsed).toBe('regex');
      expect(detail.parsedData?.email).toBe('jordan.blake@example.test');
      expect(detail.parsedData?.fullName).toBe('Jordan Blake');
      expect(detail.extractedText).toContain('Senior Software Engineer');
      expect(detail.normalizedSkills.length).toBeGreaterThan(0);
      expect(detail.normalizedSkills.map((skill) => skill.matchedName)).toContain('TypeScript');
      expect(detail.uploadedBy?.id).toBe(scenario.admin.id);
    });

    it('flags a file with no text layer as NEEDS_OCR', async () => {
      const ticket = await putFile({
        fileName: 'scanned.pdf',
        mimeType: 'application/pdf',
        buffer: buildTextlessPdf(),
      });
      await completeUpload(ticket.resumeId);

      const detail = await waitForParse(ticket.resumeId);
      expect(detail.parseStatus).toBe('NEEDS_OCR');
      expect(detail.parsedData).toBeNull();
      expect(detail.parseError).toBeTruthy();
    });

    it('re-parses on demand', async () => {
      const parsed = await uploadAndParseTextResume();

      const response = await http.post(`/resumes/${parsed.id}/reparse`, { body: { parser: 'regex' } });
      expect(response.status).toBe(201);

      const again = await waitForParse(parsed.id);
      expect(again.parseStatus).toBe('COMPLETED');
      expect(again.parsedData?.email).toBe('jordan.blake@example.test');
    });
  });

  // ---------------------------------------------------------------------------
  // Accept (review & fold into a candidate)
  // ---------------------------------------------------------------------------

  describe('accept', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('creates a candidate from a detached upload and is idempotent on re-accept', async () => {
      const parsed = await uploadAndParseTextResume();
      expect(parsed.candidateId).toBeNull();

      const firstResponse = await http.post(`/resumes/${parsed.id}/accept`, { body: {} });
      expect(firstResponse.status).toBe(201);
      const first = firstResponse.body.data as AcceptResponseShape;

      expect(first.created).toBe(true);
      expect(first.applied.profile).toBe(true);
      expect(first.applied.skills).toBeGreaterThan(0);
      expect(first.candidate.firstName).toBe('Jordan');
      expect(first.candidate.candidateSkills.map((skill) => skill.name)).toContain('TypeScript');
      const skillCountAfterFirst = first.candidate.candidateSkills.length;

      // The resume now remembers its candidate.
      const attached = (await http.get(`/resumes/${parsed.id}`)).body.data as ResumeDetailShape;
      expect(attached.candidateId).toBe(first.candidateId);

      const secondResponse = await http.post(`/resumes/${parsed.id}/accept`, { body: {} });
      expect(secondResponse.status).toBe(201);
      const second = secondResponse.body.data as AcceptResponseShape;

      expect(second.created).toBe(false);
      expect(second.candidateId).toBe(first.candidateId);
      expect(second.applied.skills).toBe(0);
      expect(second.applied.experiences).toBe(0);
      expect(second.applied.educations).toBe(0);
      expect(second.candidate.candidateSkills.length).toBe(skillCountAfterFirst);

      // Only one candidate exists for the tenant.
      const candidates = await getSystemPrisma().candidate.count({
        where: { tenantId: scenario.tenant.id, deletedAt: null },
      });
      expect(candidates).toBe(1);
    });

    it('lists resumes attached to a candidate', async () => {
      const parsed = await uploadAndParseTextResume();
      const accepted = (
        await http.post(`/resumes/${parsed.id}/accept`, { body: {} })
      ).body.data as AcceptResponseShape;

      const list = await http.get(`/resumes?candidateId=${accepted.candidateId}`);
      expect(list.status).toBe(200);
      const body = list.body.data as { items: ResumeSummaryShape[]; meta: { total: number } };
      expect(body.meta.total).toBe(1);
      expect(body.items[0]?.id).toBe(parsed.id);
      expect(body.items[0]?.isPrimary).toBe(true);

      const others = await http.get(`/resumes?candidateId=${accepted.candidateId}&page=2`);
      expect((others.body.data as { items: ResumeSummaryShape[] }).items).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Edit / delete
  // ---------------------------------------------------------------------------

  describe('mutations', () => {
    beforeEach(async () => {
      await http.login(scenario.admin.email, TEST_PASSWORD);
    });

    it('renames a resume and deletes it', async () => {
      const ticket = await putFile({
        fileName: 'draft.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(TEXT_RESUME, 'utf8'),
      });

      const renamed = await http.patch(`/resumes/${ticket.resumeId}`, {
        body: { fileName: 'final-resume.txt' },
      });
      expect(renamed.status).toBe(200);
      expect((renamed.body.data as ResumeDetailShape).fileName).toBe('final-resume.txt');

      const deleted = await http.delete(`/resumes/${ticket.resumeId}`);
      expect(deleted.status).toBe(200);
      expect((deleted.body.data as { deleted: boolean }).deleted).toBe(true);

      expect((await http.get(`/resumes/${ticket.resumeId}`)).status).toBe(404);
      const list = await http.get('/resumes');
      expect((list.body.data as { items: ResumeSummaryShape[] }).items).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Tenancy
  // ---------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('returns 404 (never 403) for a resume that belongs to another workspace', async () => {
      const other = await createTenantScenario();
      const foreign = await getSystemPrisma().candidateResume.create({
        data: {
          tenantId: other.tenant.id,
          fileName: 'foreign.pdf',
          storageKey: `resumes/${other.tenant.id}/foreign.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 4096,
        },
      });

      await http.login(scenario.admin.email, TEST_PASSWORD);

      expect((await http.get(`/resumes/${foreign.id}`)).status).toBe(404);
      expect((await http.patch(`/resumes/${foreign.id}`, { body: { fileName: 'x.pdf' } })).status).toBe(
        404,
      );
      expect((await http.delete(`/resumes/${foreign.id}`)).status).toBe(404);

      const list = await http.get('/resumes');
      expect((list.body.data as { items: ResumeSummaryShape[] }).items).toHaveLength(0);
    });
  });
});
