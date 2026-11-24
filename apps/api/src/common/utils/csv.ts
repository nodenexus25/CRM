/**
 * Minimal RFC 4180 CSV writer.
 *
 * Dependency-free on purpose: the writer lives next to the reader the CSV/Excel
 * import module (Module 7) will add, so both halves agree on quoting, delimiters
 * and line endings rather than inheriting two libraries' quirks.
 *
 * Rules implemented:
 *  - Records are separated by CRLF.
 *  - A field is wrapped in double quotes when it contains a comma, a double
 *    quote or a line break; embedded double quotes are doubled (`""`).
 *  - `null`/`undefined` render as an empty field.
 *  - Common spreadsheets treat a leading `=`, `+`, `-` or `@` as a formula, so
 *    such values are prefixed with a single quote to neutralise CSV injection.
 */

/** Characters that force a field to be quoted. */
const NEEDS_QUOTING = /[",\r\n]/;
/** Leading characters a spreadsheet interprets as the start of a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Escapes one value for inclusion in a CSV record. */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  const guarded = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return NEEDS_QUOTING.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Serialises a header row plus data rows to an RFC 4180 document. */
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  if (rows.length === 0) return '';
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/** A parsed document: the header row plus the data rows that follow it. */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * Splits raw text into records according to RFC 4180.
 *
 * A single pass with one bit of state (`inQuotes`): inside quotes a comma, a
 * CRLF or an LF is literal data and `""` is an escaped quote; outside quotes
 * those characters terminate a field or a record. Both CRLF (the writer's
 * choice) and a bare LF (what `\n`-joined files use) end a record, and a `\r`
 * is only ever meaningful as the first half of a CRLF pair.
 */
function parseRecords(input: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  const endField = (): void => {
    fields.push(field);
    field = '';
  };
  const endRecord = (): void => {
    endField();
    records.push(fields);
    fields = [];
  };

  while (index < input.length) {
    const char = input.charAt(index);

    if (inQuotes) {
      if (char === '"') {
        if (input.charAt(index + 1) === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r') {
      endRecord();
      index += input.charAt(index + 1) === '\n' ? 2 : 1;
      continue;
    }
    if (char === '\n') {
      endRecord();
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  // A trailing newline leaves an empty, half-open record that is not data.
  if (field.length > 0 || fields.length > 0) endRecord();

  return records;
}

/**
 * Parses an RFC 4180 document into headers and rows.
 *
 * Fully empty records (blank lines, which only carry `''`) are dropped so the
 * first *real* record becomes the header. Rows shorter than the header are
 * padded with `''`; anything beyond the header width is kept rather than
 * silently discarded. The writer's leading `'` injection guards are preserved —
 * only a UTF-8 BOM is stripped.
 */
export function parseCsv(text: string): ParsedCsv {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = parseRecords(input).filter((record) => record.some((value) => value.trim() !== ''));
  if (records.length === 0) return { headers: [], rows: [] };

  const [headerRecord = [], ...dataRecords] = records;
  const headers = [...headerRecord];
  const width = headers.length;

  const rows = dataRecords.map((record) => {
    const row = [...record];
    while (row.length < width) row.push('');
    return row;
  });

  return { headers, rows };
}
