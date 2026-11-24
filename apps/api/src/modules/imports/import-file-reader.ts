import { Workbook, type Cell } from 'exceljs';

import { ValidationError } from '@/common/errors/domain-errors';
import { parseCsv, type ParsedCsv } from '@/common/utils/csv';

/**
 * Reads an uploaded CSV or Excel file into the same `{ headers, rows }` shape.
 *
 * The wizard never sees a parsed grid until it asks for a preview, and by then
 * the file has been re-read from object storage — so this is the single place
 * that turns "some bytes the browser PUT" into rows. Both formats converge on
 * the RFC 4180 reader, which is what lets the CSV and Excel paths share one
 * mapping/coercion engine downstream.
 */

/** `.xlsx` (by extension) or the OOXML spreadsheet content type. */
function isSpreadsheet(mimeType: string, fileName: string): boolean {
  return /\.xlsx$/i.test(fileName) || /spreadsheetml/i.test(mimeType);
}

/** One cell as text; Excel date cells are normalised to an ISO date. */
function cellText(cell: Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  // A real date cell exposes a `Date`, but `cell.text` renders it through the
  // cell's number format (locale-dependent). Take the ISO form instead so the
  // DATE coercion stays deterministic.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = cell.text;
  return typeof text === 'string' ? text : String(value);
}

/** Reads the first worksheet of an `.xlsx` workbook, skipping empty rows. */
async function readSpreadsheet(buffer: Buffer): Promise<ParsedCsv> {
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ValidationError('That spreadsheet could not be read. Upload a valid .xlsx file.');
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new ValidationError('That spreadsheet has no worksheets.');
  }

  const records: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let column = 1; column <= row.cellCount; column += 1) {
      values.push(cellText(row.getCell(column)));
    }
    if (values.some((value) => value.trim() !== '')) records.push(values);
  });

  const [headerRecord = [], ...dataRecords] = records;
  const width = headerRecord.length;
  const rows = dataRecords.map((record) => {
    const row = [...record];
    while (row.length < width) row.push('');
    return row;
  });

  return { headers: [...headerRecord], rows };
}

/**
 * Parses the uploaded bytes into headers and data rows.
 *
 * Detection is by extension first and MIME type second; anything that is not a
 * spreadsheet is treated as UTF-8 CSV. A file with no header or no data rows is
 * rejected here so the preview never has to reason about an empty grid.
 */
export async function readTabularFile(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ParsedCsv> {
  const parsed = isSpreadsheet(mimeType, fileName)
    ? await readSpreadsheet(buffer)
    : parseCsv(buffer.toString('utf8'));

  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    throw new ValidationError(
      'That file has no rows to import. Include a header row and at least one data row.',
    );
  }

  return parsed;
}
