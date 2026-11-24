import { z } from 'zod';

// ---------------------------------------------------------------------------
// Global search (header command palette)
// ---------------------------------------------------------------------------

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Type something to search for').max(120),
  /** Per-entity cap, so one entity cannot crowd out the menu. */
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;

export const GLOBAL_SEARCH_ENTITIES = ['JOB', 'CANDIDATE', 'CLIENT', 'CONTACT'] as const;
export type GlobalSearchEntity = (typeof GLOBAL_SEARCH_ENTITIES)[number];

export const GLOBAL_SEARCH_LABELS: Record<GlobalSearchEntity, string> = {
  JOB: 'Jobs',
  CANDIDATE: 'Candidates',
  CLIENT: 'Clients',
  CONTACT: 'Contacts',
};

/** Singular noun per entity, for "No <noun> matches" copy. */
export const GLOBAL_SEARCH_NOUNS: Record<GlobalSearchEntity, string> = {
  JOB: 'job',
  CANDIDATE: 'candidate',
  CLIENT: 'client',
  CONTACT: 'contact',
};

export interface GlobalSearchResultItem {
  id: string;
  entity: GlobalSearchEntity;
  /** Primary line: job title, candidate name, client name. */
  title: string;
  /** Secondary line: reference code, current title, industry. */
  subtitle: string | null;
  /** App-relative link the palette navigates to. */
  href: string;
  /** Short status chip, e.g. the job status. */
  badge: string | null;
}

export interface GlobalSearchGroup {
  entity: GlobalSearchEntity;
  label: string;
  /** Total matches for this entity, which may exceed `items.length`. */
  total: number;
  items: GlobalSearchResultItem[];
}

export interface GlobalSearchResult {
  query: string;
  groups: GlobalSearchGroup[];
  total: number;
}
