import { Inject, Injectable } from '@nestjs/common';

import {
  GLOBAL_SEARCH_ENTITIES,
  GLOBAL_SEARCH_LABELS,
  type GlobalSearchEntity,
  type GlobalSearchGroup,
  type GlobalSearchQuery,
  type GlobalSearchResult,
} from '@talentflow/types';

import { requestContext } from '@/common/request-context';

import { PostgresSearchAdapter, type SearchAdapter } from './search.adapter';

export const SEARCH_ADAPTER = Symbol('SEARCH_ADAPTER');

/**
 * The permission each entity group needs to be visible in the palette.
 * A super admin sees everything; everyone else only the resources they may read.
 */
const GROUP_PERMISSION: Record<GlobalSearchEntity, string> = {
  JOB: 'job:read_own',
  CANDIDATE: 'candidate:read_own',
  CLIENT: 'client:read_own',
  CONTACT: 'contact:read_own',
};

/**
 * Fans a search term out over every entity the caller may read and groups the
 * hits for the command palette. Grouping happens here so the client never has
 * to know which entities exist.
 */
@Injectable()
export class SearchService {
  private readonly adapter: SearchAdapter;

  constructor(@Inject(SEARCH_ADAPTER) adapter: SearchAdapter) {
    this.adapter = adapter;
  }

  async search(query: GlobalSearchQuery): Promise<GlobalSearchResult> {
    const context = requestContext.getOrThrow();
    const allowed = GLOBAL_SEARCH_ENTITIES.filter(
      (entity) => context.isSuperAdmin || hasPermission(context.permissions, GROUP_PERMISSION[entity]),
    );

    const hits = await Promise.all(
      allowed.map(async (entity) => {
        const hit = await this.adapter.search(entity, query.q, query.limit);
        return { entity, ...hit };
      }),
    );

    const groups: GlobalSearchGroup[] = hits
      .filter((hit) => hit.items.length > 0)
      .map((hit) => ({
        entity: hit.entity,
        label: GLOBAL_SEARCH_LABELS[hit.entity],
        total: hit.total,
        items: hit.items,
      }));

    return {
      query: query.q,
      groups,
      total: groups.reduce((sum, group) => sum + group.total, 0),
    };
  }
}

/** Mirrors `PermissionsGuard`: holding `_all` satisfies an `_own` requirement. */
function hasPermission(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  if (required.endsWith('_own')) {
    return granted.includes(`${required.replace(/_own$/, '')}_all`);
  }
  return false;
}

/** Provider factory so the adapter stays swappable (OpenSearch in Phase 6). */
export const searchAdapterProvider = {
  provide: SEARCH_ADAPTER,
  useExisting: PostgresSearchAdapter,
};
