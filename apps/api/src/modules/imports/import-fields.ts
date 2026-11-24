import {
  IMPORT_FIELD_DEFINITIONS,
  candidateSourceSchema,
  jobStatusSchema,
  type ImportEntityType,
  type ImportFieldDefinition,
} from '@talentflow/types';

/**
 * Field mapping and value coercion for the CSV/Excel importer (Module 7).
 *
 * Two responsibilities, kept apart from the IO:
 *
 *  - `suggestMapping` guesses which column feeds which field, so the wizard can
 *    open pre-filled instead of demanding the user map a dozen columns by hand.
 *  - `coerceRow` turns a raw row of strings into server-ready values, and is the
 *    single place that decides whether a cell is *valid*. The preview endpoint
 *    and the worker both run it, so what a user is shown is exactly what will be
 *    stored.
 */

/** Sentinel meaning "this column is not mapped to any field". */
export const IMPORT_SKIP_FIELD = '__skip__';

/** Field keys whose declared type is `NUMBER` but must land as an integer. */
const INTEGER_FIELDS = new Set(['totalExperienceMonths', 'expectedSalaryCents', 'openings']);

/** Field keys holding a delimited list rather than a single value. */
const LIST_FIELDS = new Set(['tags', 'skills']);

/** Allowed values for the `SELECT` fields, keyed by field key. */
const SELECT_OPTIONS: Record<string, readonly string[]> = {
  source: candidateSourceSchema.options,
  status: jobStatusSchema.options,
};

/**
 * Header spellings that do not reduce onto a field key or label by simple
 * punctuation-stripping (`job_title` and `title` are the notable cases). A
 * synonym is only used when the target field actually exists on the entity.
 */
const SYNONYMS: Record<string, string> = {
  firstname: 'firstName',
  lastname: 'lastName',
  company: 'currentCompany',
  organization: 'currentCompany',
  organisation: 'currentCompany',
  employer: 'currentCompany',
  jobtitle: 'currentTitle',
  title: 'currentTitle',
  linkedin: 'linkedinUrl',
  emailaddress: 'email',
  phonenumber: 'phone',
  mobile: 'phone',
};

/** Lower-cases and drops everything that is not alphanumeric. */
function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Suggests a `header → fieldKey` mapping for the given headers.
 *
 * Matching is case/space/underscore-insensitive and tries the field key first,
 * then its label, then a synonym table. Anything unmatched maps to
 * `__skip__` so the client can render it as "ignored" rather than guessing.
 */
export function suggestMapping(headers: string[], entity: ImportEntityType): Record<string, string> {
  const definitions = IMPORT_FIELD_DEFINITIONS[entity];
  const fieldKeys = new Set(definitions.map((field) => field.key));
  const byKey = new Map<string, string>();
  const byLabel = new Map<string, string>();

  for (const field of definitions) {
    byKey.set(normalizeToken(field.key), field.key);
    const label = normalizeToken(field.label);
    if (!byLabel.has(label)) byLabel.set(label, field.key);
  }

  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const token = normalizeToken(header);
    if (!token) {
      mapping[header] = IMPORT_SKIP_FIELD;
      continue;
    }

    const direct = byKey.get(token) ?? byLabel.get(token);
    if (direct) {
      mapping[header] = direct;
      continue;
    }

    const synonym = SYNONYMS[token];
    mapping[header] = synonym && fieldKeys.has(synonym) ? synonym : IMPORT_SKIP_FIELD;
  }

  return mapping;
}

/** The coerced view of a single data row. */
export interface CoercedRow {
  /** Raw header → cell text, as read from the file. */
  values: Record<string, string>;
  /** Server-ready value for every mapped field that carried one. */
  mapped: Record<string, unknown>;
  errors: { field: string; message: string }[];
}

type CoerceResult = { ok: true; value: unknown } | { ok: false; message: string };

/** Splits a comma/semicolon list, trims, drops blanks and de-duplicates. */
function splitList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[,;]/)) {
    const item = part.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function coerceNumber(field: ImportFieldDefinition, cell: string): CoerceResult {
  const cleaned = cell.replace(/[$,\s]/g, '').replace(/^\+/, '');
  const value = Number(cleaned);
  if (cleaned === '' || !Number.isFinite(value)) {
    return { ok: false, message: `${field.label} must be a number.` };
  }
  if (INTEGER_FIELDS.has(field.key) && !Number.isInteger(value)) {
    return { ok: false, message: `${field.label} must be a whole number.` };
  }
  return { ok: true, value };
}

/** Builds an ISO `YYYY-MM-DD`, or `null` when the parts are not a real date. */
function buildIsoDate(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Parses a date cell. `YYYY-MM-DD` and ISO timestamps are unambiguous; a
 * two-part `a/b/year` is read as `DD/MM` only when the first part is greater
 * than 12 (the only case where it cannot be a month), otherwise as `MM/DD`.
 */
function coerceDate(field: ImportFieldDefinition, cell: string): CoerceResult {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(cell);
  if (iso) {
    const isoDate = buildIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (isoDate) return { ok: true, value: isoDate };
  }

  const separated = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(cell);
  if (separated) {
    const first = Number(separated[1]);
    const second = Number(separated[2]);
    const rawYear = Number(separated[3]);
    const year = rawYear < 100 ? rawYear + 2000 : rawYear;
    const dayFirst = first > 12;
    const day = dayFirst ? first : second;
    const month = dayFirst ? second : first;
    const parsed = buildIsoDate(year, month, day);
    if (parsed) return { ok: true, value: parsed };
  }

  const fallback = new Date(cell);
  if (!Number.isNaN(fallback.getTime())) return { ok: true, value: fallback.toISOString().slice(0, 10) };

  return { ok: false, message: `${field.label} is not a valid date.` };
}

const TRUE_VALUES = new Set(['true', 'yes', 'y', '1']);
const FALSE_VALUES = new Set(['false', 'no', 'n', '0']);

function coerceBoolean(field: ImportFieldDefinition, cell: string): CoerceResult {
  const token = cell.toLowerCase();
  if (TRUE_VALUES.has(token)) return { ok: true, value: true };
  if (FALSE_VALUES.has(token)) return { ok: true, value: false };
  return { ok: false, message: `${field.label} must be yes or no.` };
}

function coerceEmail(field: ImportFieldDefinition, cell: string): CoerceResult {
  const email = cell.toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: `${field.label} is not a valid email address.` };
  }
  return { ok: true, value: email };
}

function coercePhone(field: ImportFieldDefinition, cell: string): CoerceResult {
  const digits = cell.replace(/\D/g, '');
  if (digits.length < 6) return { ok: false, message: `${field.label} is not a valid phone number.` };
  const value = cell.trim().startsWith('+') ? `+${digits}` : digits;
  return { ok: true, value };
}

function coerceSelect(field: ImportFieldDefinition, cell: string): CoerceResult {
  const options = SELECT_OPTIONS[field.key] ?? [];
  const token = normalizeToken(cell);
  const match = options.find((option) => normalizeToken(option) === token);
  if (!match) {
    return { ok: false, message: `${field.label} must be one of: ${options.join(', ')}.` };
  }
  return { ok: true, value: match };
}

function coerceValue(field: ImportFieldDefinition, cell: string): CoerceResult {
  switch (field.type) {
    case 'NUMBER':
      return coerceNumber(field, cell);
    case 'DATE':
      return coerceDate(field, cell);
    case 'BOOLEAN':
      return coerceBoolean(field, cell);
    case 'EMAIL':
      return coerceEmail(field, cell);
    case 'PHONE':
      return coercePhone(field, cell);
    case 'SELECT':
      return coerceSelect(field, cell);
    default:
      return { ok: true, value: LIST_FIELDS.has(field.key) ? splitList(cell) : cell };
  }
}

/**
 * Coerces one raw row against a mapping.
 *
 * A cell that fails its declared type produces a field error and is left out of
 * `mapped`; a required field with no value produces a `<Label> is required.`
 * error. At most one error per field is reported so a bad value cannot then also
 * look "missing".
 */
export function coerceRow(
  entity: ImportEntityType,
  mapping: Record<string, string>,
  raw: string[],
  headers: string[],
): CoercedRow {
  const definitions = IMPORT_FIELD_DEFINITIONS[entity];
  const byKey = new Map(definitions.map((field) => [field.key, field]));
  const values: Record<string, string> = {};
  const mapped: Record<string, unknown> = {};
  const errors: { field: string; message: string }[] = [];
  const errored = new Set<string>();

  const addError = (field: string, message: string): void => {
    if (errored.has(field)) return;
    errored.add(field);
    errors.push({ field, message });
  };

  headers.forEach((header, index) => {
    values[header] = raw[index] ?? '';

    const target = mapping[header];
    if (!target || target === IMPORT_SKIP_FIELD) return;

    const field = byKey.get(target);
    if (!field) return;

    const cell = (raw[index] ?? '').trim();
    if (cell === '') return;

    const result = coerceValue(field, cell);
    if (result.ok) mapped[field.key] = result.value;
    else addError(field.key, result.message);
  });

  for (const field of definitions) {
    if (!field.required || mapped[field.key] !== undefined) continue;
    addError(field.key, `${field.label} is required.`);
  }

  return { values, mapped, errors };
}
