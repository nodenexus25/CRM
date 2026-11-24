'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BriefcaseBusiness,
  Building2,
  Contact,
  Loader2,
  Search,
  SearchX,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import {
  GLOBAL_SEARCH_NOUNS,
  type GlobalSearchEntity,
  type GlobalSearchResult,
  type GlobalSearchResultItem,
} from '@talentflow/types';
import { cn } from '@talentflow/ui';

import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { pushRecentRecord, pushRecentSearch } from '@/lib/recents';

/** Per-entity page size. Above the palette's 5 so this screen is worth opening. */
const PAGE_LIMIT = 10;

/** One term per entity group, so a hit is recognisable at a glance. */
const ENTITY_ICONS: Record<GlobalSearchEntity, LucideIcon> = {
  JOB: BriefcaseBusiness,
  CANDIDATE: UserRound,
  CLIENT: Building2,
  CONTACT: Contact,
};

/**
 * Full search results, reachable from the Cmd+K palette.
 *
 * The term lives in the URL (`/search?q=…`) so a result set is linkable and the
 * browser's back button works. The API is the only authority on what the caller
 * may see: it drops groups the user cannot read, so this screen renders exactly
 * the groups it is handed.
 */
export function SearchResults() {
  const router = useRouter();
  const params = useSearchParams();
  const query = (params.get('q') ?? '').trim();

  const [term, setTerm] = useState(query);

  useEffect(() => {
    setTerm(query);
  }, [query]);

  const results = useQuery({
    queryKey: queryKeys.search.global(query),
    queryFn: () => api.get<GlobalSearchResult>('/search', { query: { q: query, limit: PAGE_LIMIT } }),
    enabled: query.length > 0,
    // Keep the previous hits on screen while the next term resolves.
    placeholderData: (previous) => previous,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = term.trim();
    if (!next) return;

    pushRecentSearch(next);
    router.push(`/search?q=${encodeURIComponent(next)}`);
  }

  const groups = results.data?.groups ?? [];
  const total = results.data?.total ?? 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title="Search"
        description="Find jobs, candidates, clients and contacts across this workspace."
        breadcrumbs={[{ label: 'Workspace' }, { label: 'Search' }]}
      />

      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row" role="search">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Job title, candidate name, company, email…"
            aria-label="Search the workspace"
            maxLength={120}
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={term.trim().length === 0}>
          Search
        </Button>
      </form>

      {query.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Start typing to search"
          description="Search runs across jobs, candidates, clients and contacts, and only ever returns records you have permission to read."
        />
      ) : results.isPending ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading results">
          {[0, 1].map((index) => (
            <Card key={index}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : results.isError ? (
        <EmptyState
          icon={SearchX}
          title="Search failed"
          description="The workspace could not be searched. Check your connection and try again."
          action={
            <Button variant="outline" size="sm" onClick={() => void results.refetch()}>
              Try again
            </Button>
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={`No matches for “${query}”`}
          description="Try a shorter term, a different spelling, or part of a name."
        />
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            {results.isFetching ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            <span>
              {total} {total === 1 ? 'match' : 'matches'} for “{query}”
            </span>
          </p>

          <div className="space-y-4">
            {groups.map((group) => {
              const Icon = ENTITY_ICONS[group.entity];
              const hidden = group.total - group.items.length;

              return (
                <Card key={group.entity}>
                  <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                    <CardTitle className="flex items-center gap-2">
                      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                      {group.label}
                    </CardTitle>
                    <Badge variant="secondary">{group.total}</Badge>
                  </CardHeader>
                  <CardContent>
                    <ul className="divide-y divide-border">
                      {group.items.map((item) => (
                        <li key={`${item.entity}-${item.id}`}>
                          <ResultRow item={item} onOpen={() => pushRecentRecord(item)} />
                        </li>
                      ))}
                    </ul>

                    {hidden > 0 ? (
                      <p className="pt-3 text-xs text-muted-foreground">
                        Showing the top {group.items.length} of {group.total}{' '}
                        {group.total === 1 ? GLOBAL_SEARCH_NOUNS[group.entity] : `${GLOBAL_SEARCH_NOUNS[group.entity]}s`}
                        . Narrow the search to see the rest.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ResultRow({ item, onOpen }: { item: GlobalSearchResultItem; onOpen: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onOpen}
      className={cn(
        'flex items-center gap-3 py-3 first:pt-0 last:pb-0',
        'rounded-md transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        {item.subtitle ? <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p> : null}
      </div>
      {item.badge ? <Badge variant="muted">{item.badge}</Badge> : null}
    </Link>
  );
}
