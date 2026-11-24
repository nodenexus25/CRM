import type { GlobalSearchResultItem } from '@talentflow/types';

/**
 * Recently searched terms and recently opened records.
 *
 * This is a client-side convenience for the Cmd+K palette only — nothing here is
 * sent to the API, and a browser with storage disabled simply starts empty.
 */

const SEARCHES_KEY = 'tf.recents.searches';
const RECORDS_KEY = 'tf.recents.records';

/** Long enough to be useful, short enough to stay scannable. */
const MAX_SEARCHES = 5;
const MAX_RECORDS = 6;

function readList(key: string): unknown[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or unreadable storage is treated as empty rather than throwing.
    return [];
  }
}

function writeList(key: string, value: readonly unknown[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage blocked — recents are optional, so drop them.
  }
}

export function readRecentSearches(): string[] {
  return readList(SEARCHES_KEY)
    .filter((entry): entry is string => typeof entry === 'string')
    .slice(0, MAX_SEARCHES);
}

/** Moves the term to the front, de-duplicated case-insensitively. */
export function pushRecentSearch(term: string): void {
  const normalized = term.trim();
  if (!normalized) return;

  const rest = readRecentSearches().filter((entry) => entry.toLowerCase() !== normalized.toLowerCase());
  writeList(SEARCHES_KEY, [normalized, ...rest].slice(0, MAX_SEARCHES));
}

export function readRecentRecords(): GlobalSearchResultItem[] {
  return readList(RECORDS_KEY).filter(isSearchItem).slice(0, MAX_RECORDS);
}

/** Moves the record to the front, keyed by entity + id. */
export function pushRecentRecord(item: GlobalSearchResultItem): void {
  const rest = readRecentRecords().filter(
    (entry) => !(entry.entity === item.entity && entry.id === item.id),
  );
  writeList(RECORDS_KEY, [item, ...rest].slice(0, MAX_RECORDS));
}

/** Persisted values are untrusted input: they may predate a shape change. */
function isSearchItem(value: unknown): value is GlobalSearchResultItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.entity === 'string' &&
    typeof item.title === 'string' &&
    typeof item.href === 'string'
  );
}
