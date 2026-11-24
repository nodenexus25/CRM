import { Workbook } from 'exceljs';

import { IMPORT_FIELD_DEFINITIONS } from '@talentflow/types';

import { createTenantScenario, TEST_PASSWORD, type TenantScenario } from './factories';
import { disconnectTestDatabases, getSystemPrisma, resetDatabase } from './utils/db';
import { createTestApp, type TestApp } from './utils/test-app';
import { TestHttpClient } from './utils/test-http';

/**
 * CSV/Excel import (Phase 2, Module 7).
 *
 * Drives the whole wizard against real infrastructure: the presigned `PUT`
 * lands bytes in object storage, `preview` re-reads them and validates a sample,
 * `run` enqueues the work and the `import` worker applies the rows through the
 * same services the interactive API uses. Every run polls `GET /imports/:id`
 * until it reaches a terminal state, so nothing about storage, the queue or the
 * worker is stubbed.
 */

interface ImportUploadTicketShape {
  importJobId: string;
  storageKey: string;
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

interface ImportFieldDefinitionShape {
  key: string;
  label: string;
  required: boolean;
  type: string;
}

interface ImportSampleTemplateShape {
  entity: string;
  fileName: string;
  mimeType: string;
  content: string;
}

interface ImportPreviewRowShape {
  rowNumber: number;
  values: Record<string, string>;
  mapped: Record<string, unknown>;
  errors: { field: string; message: string }[];
  duplicateOf: { id: string; label: string } | null;
}

interface ImportPreviewShape {
  headers: string[];
  rows: ImportPreviewRowShape[];
  suggestedMapping: Record<string, string>;
  totalRowsSampled: number;
  validRows: number;
  invalidRows: number;
}

interface ImportJobSummaryShape {
  id: string;
  entity: string;
  status: string;
  fileName: string;
  totalRows: number;
  processedRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  failedRows: number;
  progress: number;
  errors: { row: number; field: string; message: string }[];
  startedAt: string | null;
  completedAt: string | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
}

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

/** Serialises rows to an RFC 4180 document the API's own reader accepts. */
function csv(rows: string[][]): Buffer {
  return Buffer.from(`${rows.map((row) => row.join(',')).join('\r\n')}\r\n`, 'utf8');
}

describe('Imports (e2e)', () => {
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

  function asAdmin(): Promise<unknown> {
    return http.login(scenario.admin.email, TEST_PASSWORD);
  }

  /** Reserves an upload, PUTs the bytes to storage and returns the job id. */
  async function upload(
    entity: string,
    fileName: string,
    buffer: Buffer,
    mimeType = 'text/csv',
  ): Promise<string> {
    const ticketResponse = await http.post('/imports/upload-url', {
      body: { entity, fileName, mimeType, sizeBytes: buffer.length },
    });
    expect(ticketResponse.status).toBe(201);
    const ticket = ticketResponse.body.data as ImportUploadTicketShape;

    const put = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.headers,
      body: buffer,
    });
    expect(put.ok).toBe(true);

    return ticket.importJobId;
  }

  async function preview(id: string, body: Record<string, unknown> = {}): Promise<ImportPreviewShape> {
    const response = await http.post(`/imports/${id}/preview`, { body });
    expect(response.status).toBe(201);
    return response.body.data as ImportPreviewShape;
  }

  async function startRun(id: string, body: Record<string, unknown>): Promise<ImportJobSummaryShape> {
    const response = await http.post(`/imports/${id}/run`, { body });
    expect(response.status).toBe(201);
    return response.body.data as ImportJobSummaryShape;
  }

  /** Polls the detail endpoint until the worker reaches a terminal state. */
  async function waitForImport(id: string): Promise<ImportJobSummaryShape> {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const response = await http.get(`/imports/${id}`);
      expect(response.status).toBe(200);
      const job = response.body.data as ImportJobSummaryShape;
      if (TERMINAL_STATUSES.has(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Import ${id} did not finish in time`);
  }

  /** Upload → preview → run (reusing the suggested mapping) → wait. */
  async function importCsv(
    entity: string,
    buffer: Buffer,
    options: Record<string, unknown> = {},
  ): Promise<{ id: string; preview: ImportPreviewShape; job: ImportJobSummaryShape }> {
    const id = await upload(entity, `${entity.toLowerCase()}.csv`, buffer);
    const previewed = await preview(id);
    await startRun(id, { mapping: previewed.suggestedMapping, options });
    const job = await waitForImport(id);
    return { id, preview: previewed, job };
  }

  // ---------------------------------------------------------------------------
  // Wizard metadata
  // ---------------------------------------------------------------------------

  describe('wizard metadata', () => {
    beforeEach(asAdmin);

    it('lists the mappable fields for an entity', async () => {
      const response = await http.get('/imports/fields?entity=CANDIDATE');
      expect(response.status).toBe(200);

      const fields = response.body.data as ImportFieldDefinitionShape[];
      expect(fields).toHaveLength(IMPORT_FIELD_DEFINITIONS.CANDIDATE.length);
      expect(fields.map((field) => field.key)).toContain('firstName');
      expect(fields[0]).toMatchObject({ key: 'firstName', required: true });
      expect(fields.find((field) => field.key === 'email')?.type).toBe('EMAIL');
    });

    it('serves a sample CSV whose headers match the field labels', async () => {
      const response = await http.get('/imports/sample?entity=CANDIDATE');
      expect(response.status).toBe(200);

      const sample = response.body.data as ImportSampleTemplateShape;
      expect(sample.fileName).toBe('candidate-sample.csv');
      expect(sample.mimeType).toBe('text/csv');

      const [headerLine = ''] = sample.content.split('\r\n');
      expect(headerLine.split(',')).toEqual(IMPORT_FIELD_DEFINITIONS.CANDIDATE.map((f) => f.label));
    });
  });

  // ---------------------------------------------------------------------------
  // Upload + preview
  // ---------------------------------------------------------------------------

  describe('preview', () => {
    beforeEach(asAdmin);

    it('auto-suggests a mapping from messy headers', async () => {
      const id = await upload(
        'CANDIDATE',
        'messy.csv',
        csv([
          ['First Name', 'Last Name', 'email_address', 'Phone', 'Current Company'],
          ['Ada', 'Lovelace', 'ada@example.test', '+14155550100', 'Analytical Engines'],
        ]),
      );

      const result = await preview(id);

      expect(result.suggestedMapping['First Name']).toBe('firstName');
      expect(result.suggestedMapping['Last Name']).toBe('lastName');
      expect(result.suggestedMapping['email_address']).toBe('email');
      expect(result.suggestedMapping.Phone).toBe('phone');
      expect(result.suggestedMapping['Current Company']).toBe('currentCompany');
      expect(result.validRows).toBe(1);
      expect(result.rows[0]?.mapped).toMatchObject({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.test',
        currentCompany: 'Analytical Engines',
      });
    });

    it('flags a missing required field and unparsable number/date cells', async () => {
      const id = await upload(
        'CANDIDATE',
        'bad.csv',
        csv([
          ['First Name', 'Last Name', 'Total Experience (Months)', 'Available From'],
          ['Ada', '', 'abc', 'not-a-date'],
        ]),
      );

      const result = await preview(id);
      const row = result.rows[0];
      expect(row).toBeDefined();

      const fields = (row?.errors ?? []).map((error) => error.field);
      expect(fields).toContain('lastName');
      expect(fields).toContain('totalExperienceMonths');
      expect(fields).toContain('availabilityDate');
      expect(result.validRows).toBe(0);
      expect(result.invalidRows).toBe(1);
    });

    it('detects a duplicate of an existing candidate by email', async () => {
      const created = await http.post('/candidates', {
        body: { firstName: 'Existing', lastName: 'Person', email: 'dupe@example.test' },
      });
      expect(created.status).toBe(201);
      const candidateId = (created.body.data as { id: string }).id;

      const id = await upload(
        'CANDIDATE',
        'dupes.csv',
        csv([
          ['First Name', 'Last Name', 'Email'],
          ['Grace', 'Hopper', 'dupe@example.test'],
        ]),
      );

      const result = await preview(id);
      expect(result.rows[0]?.duplicateOf?.id).toBe(candidateId);
    });

    it('reads an .xlsx upload into the same grid shape', async () => {
      const workbook = new Workbook();
      const sheet = workbook.addWorksheet('Candidates');
      sheet.addRow(['First Name', 'Last Name', 'Email']);
      sheet.addRow(['Ada', 'Lovelace', 'ada@example.test']);
      const buffer = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);

      const id = await upload(
        'CANDIDATE',
        'candidates.xlsx',
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      const result = await preview(id);
      expect(result.headers).toEqual(['First Name', 'Last Name', 'Email']);
      expect(result.suggestedMapping['First Name']).toBe('firstName');
      expect(result.rows).toHaveLength(1);
      expect(result.validRows).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Run
  // ---------------------------------------------------------------------------

  describe('run', () => {
    beforeEach(asAdmin);

    it('imports new rows and skips duplicates by default', async () => {
      await http.post('/candidates', {
        body: { firstName: 'Existing', lastName: 'Person', email: 'dupe@example.test' },
      });

      const { job } = await importCsv(
        'CANDIDATE',
        csv([
          ['First Name', 'Last Name', 'Email'],
          ['Ada', 'Lovelace', 'fresh@example.test'],
          ['Grace', 'Hopper', 'dupe@example.test'],
        ]),
      );

      expect(job.status).toBe('COMPLETED');
      expect(job.totalRows).toBe(2);
      expect(job.processedRows).toBe(2);
      expect(job.createdRows).toBe(1);
      expect(job.skippedRows).toBe(1);
      expect(job.failedRows).toBe(0);

      const count = await getSystemPrisma().candidate.count({
        where: { tenantId: scenario.tenant.id, deletedAt: null },
      });
      expect(count).toBe(2);
    });

    it('updates a matched record under the UPDATE strategy', async () => {
      await http.post('/candidates', {
        body: {
          firstName: 'Grace',
          lastName: 'Hopper',
          email: 'grace@example.test',
          currentCompany: 'Old Corp',
        },
      });

      const { job } = await importCsv(
        'CANDIDATE',
        csv([
          ['First Name', 'Last Name', 'Email', 'Current Company'],
          ['Grace', 'Hopper', 'grace@example.test', 'Compiler Works'],
        ]),
        { duplicateStrategy: 'UPDATE' },
      );

      expect(job.updatedRows).toBe(1);
      expect(job.createdRows).toBe(0);

      const updated = await getSystemPrisma().candidate.findFirst({
        where: { tenantId: scenario.tenant.id, email: 'grace@example.test' },
      });
      expect(updated?.currentCompany).toBe('Compiler Works');

      const count = await getSystemPrisma().candidate.count({
        where: { tenantId: scenario.tenant.id, deletedAt: null },
      });
      expect(count).toBe(1);
    });

    it('creates a second record for a matching email under the CREATE strategy', async () => {
      await http.post('/candidates', {
        body: { firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.test' },
      });

      const { job } = await importCsv(
        'CANDIDATE',
        csv([
          ['First Name', 'Last Name', 'Email'],
          ['Grace', 'Hopper', 'grace@example.test'],
        ]),
        { duplicateStrategy: 'CREATE' },
      );

      expect(job.createdRows).toBe(1);
      expect(job.skippedRows).toBe(0);

      const count = await getSystemPrisma().candidate.count({
        where: { tenantId: scenario.tenant.id, deletedAt: null },
      });
      expect(count).toBe(2);
    });

    it('fails a row with an invalid email and records the reason', async () => {
      const { job } = await importCsv(
        'CANDIDATE',
        csv([
          ['First Name', 'Last Name', 'Email'],
          ['Ada', 'Lovelace', 'not-an-email'],
        ]),
      );

      expect(job.status).toBe('FAILED');
      expect(job.failedRows).toBe(1);
      expect(job.createdRows).toBe(0);
      expect(job.errors[0]?.field).toBe('email');
      expect(job.errors[0]?.message).toContain('valid email');
    });

    it('exposes the row errors as a downloadable CSV', async () => {
      const { id } = await importCsv(
        'CANDIDATE',
        csv([
          ['First Name', 'Last Name', 'Email'],
          ['Ada', 'Lovelace', 'not-an-email'],
        ]),
      );

      const response = await http.get(`/imports/${id}/errors`);
      expect(response.status).toBe(200);
      const { downloadUrl } = response.body.data as { downloadUrl: string };

      const csvResponse = await fetch(downloadUrl);
      const text = await csvResponse.text();
      expect(text).toContain('row,field,message');
      expect(text).toContain('email');
    });

    it('lists the finished run with its progress and counters', async () => {
      const { id } = await importCsv(
        'CANDIDATE',
        csv([
          ['First Name', 'Last Name', 'Email'],
          ['Ada', 'Lovelace', 'ada@example.test'],
        ]),
      );

      const response = await http.get('/imports?entity=CANDIDATE');
      expect(response.status).toBe(200);

      const body = response.body.data as {
        items: ImportJobSummaryShape[];
        meta: { total: number };
      };
      expect(body.meta.total).toBe(1);
      const listed = body.items.find((item) => item.id === id);
      expect(listed?.status).toBe('COMPLETED');
      expect(listed?.progress).toBe(100);
      expect(listed?.createdBy?.id).toBe(scenario.admin.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  describe('cancel', () => {
    beforeEach(asAdmin);

    it('cancels an unfinished import and refuses to cancel a finished one', async () => {
      const id = await upload(
        'CANDIDATE',
        'cancel.csv',
        csv([
          ['First Name', 'Last Name', 'Email'],
          ['Ada', 'Lovelace', 'ada@example.test'],
        ]),
      );

      const cancelled = await http.post(`/imports/${id}/cancel`, { body: {} });
      expect(cancelled.status).toBe(201);
      expect((cancelled.body.data as ImportJobSummaryShape).status).toBe('CANCELLED');

      const again = await http.post(`/imports/${id}/cancel`, { body: {} });
      expect(again.status).toBe(409);
    });
  });

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    it('refuses imports for a viewer', async () => {
      await http.login(scenario.viewer.email, TEST_PASSWORD);

      expect((await http.get('/imports')).status).toBe(403);
      expect(
        (
          await http.post('/imports/upload-url', {
            body: { entity: 'CANDIDATE', fileName: 'x.csv', mimeType: 'text/csv', sizeBytes: 128 },
          })
        ).status,
      ).toBe(403);
    });

    it('refuses an entity the caller cannot create', async () => {
      await http.login(scenario.recruiter.email, TEST_PASSWORD);

      // A recruiter may import candidates but has no `client:create`.
      const allowed = await http.post('/imports/upload-url', {
        body: { entity: 'CANDIDATE', fileName: 'c.csv', mimeType: 'text/csv', sizeBytes: 128 },
      });
      expect(allowed.status).toBe(201);

      const refused = await http.post('/imports/upload-url', {
        body: { entity: 'CLIENT', fileName: 'clients.csv', mimeType: 'text/csv', sizeBytes: 128 },
      });
      expect(refused.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('returns 404 (never 403) for an import that belongs to another workspace', async () => {
      const other = await createTenantScenario();
      const foreign = await getSystemPrisma().importJob.create({
        data: {
          tenantId: other.tenant.id,
          entity: 'CANDIDATE',
          status: 'PENDING',
          fileName: 'foreign.csv',
          storageKey: `imports/${other.tenant.id}/foreign.csv`,
          mimeType: 'text/csv',
        },
      });

      await asAdmin();

      expect((await http.get(`/imports/${foreign.id}`)).status).toBe(404);
      expect((await http.post(`/imports/${foreign.id}/preview`, { body: {} })).status).toBe(404);
      expect((await http.post(`/imports/${foreign.id}/run`, { body: {} })).status).toBe(404);
      expect((await http.delete(`/imports/${foreign.id}`)).status).toBe(404);
    });
  });
});
