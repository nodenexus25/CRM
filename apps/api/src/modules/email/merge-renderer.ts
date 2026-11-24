import { MERGE_FIELD_PATTERN, extractMergeFields, isMergeField } from '@talentflow/types';

/**
 * Resolved values for a single render, keyed by the dotted merge key exactly as
 * it appears in the catalogue (e.g. `candidate.firstName`).
 */
export type MergeContext = Record<string, string>;

/**
 * Substitutes every `{{ key }}` occurrence in `source`.
 *
 * The catalogue in `@talentflow/types` is the whitelist and the security
 * boundary: a key outside it is replaced with an empty string and is never read
 * from `context`, so a template can never echo a column the tenant has no
 * business seeing. Whitespace around the key is tolerated by the shared
 * pattern, matching what the UI's insert menu emits.
 */
export function renderMergeText(source: string, context: MergeContext): string {
  return source.replace(MERGE_FIELD_PATTERN, (_match: string, rawKey: string) => {
    if (!isMergeField(rawKey)) return '';
    return context[rawKey] ?? '';
  });
}

/**
 * The whitelisted keys `sources` reference that `context` has no value for.
 * Non-whitelisted keys are deliberately excluded — they are dropped at render
 * time and are not "missing", they are simply not addressable.
 *
 * Presence in `context` is what counts as resolved, so an explicit
 * `mergeData` override (even to an empty string) clears the key from this list.
 */
export function collectMissingFields(sources: string[], context: MergeContext): string[] {
  return extractMergeFields(...sources).filter(
    (key) => isMergeField(key) && context[key] === undefined,
  );
}
