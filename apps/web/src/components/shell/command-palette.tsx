'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Contact,
  CornerDownLeft,
  History,
  Loader2,
  Search,
  Upload,
  UserPlus,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { GlobalSearchEntity, GlobalSearchResult, GlobalSearchResultItem } from '@talentflow/types';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { api } from '@/lib/api-client';
import { NAV_ITEMS } from '@/lib/navigation';
import { queryKeys } from '@/lib/query-keys';
import { pushRecentRecord, pushRecentSearch, readRecentRecords, readRecentSearches } from '@/lib/recents';
import { useSession } from '@/providers/session-provider';

const MIN_TERM_LENGTH = 2;

const ENTITY_ICONS: Record<GlobalSearchEntity, LucideIcon> = {
  JOB: BriefcaseBusiness,
  CANDIDATE: UserRound,
  CLIENT: Building2,
  CONTACT: Contact,
};

/** The handful of actions a recruiter starts from most often. */
const QUICK_ACTIONS: readonly { label: string; href: string; icon: LucideIcon; permission: string }[] = [
  { label: 'Create a job', href: '/jobs/new', icon: BriefcaseBusiness, permission: 'job:create' },
  { label: 'Add a candidate', href: '/candidates/new', icon: UserPlus, permission: 'candidate:create' },
  { label: 'Import data', href: '/settings/imports', icon: Upload, permission: 'import:create' },
  { label: 'Invite a teammate', href: '/users', icon: UserPlus, permission: 'user:invite' },
];

/**
 * Cmd+K palette: jump between pages, re-open recent records, or search the
 * workspace.
 *
 * Server results are rendered with `shouldFilter={false}` — cmdk's client-side
 * matcher would otherwise hide rows the API deliberately ranked as relevant.
 * While the palette is idle (fewer than `MIN_TERM_LENGTH` characters typed) the
 * rows come from the client instead, so cmdk's matcher is left on.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { has } = useSession();
  const [term, setTerm] = useState('');
  const [recents, setRecents] = useState<{ searches: string[]; records: GlobalSearchResultItem[] }>({
    searches: [],
    records: [],
  });

  useEffect(() => {
    if (!open) {
      setTerm('');
      return;
    }
    // Read on open so anything recorded since the palette was last shown appears.
    setRecents({ searches: readRecentSearches(), records: readRecentRecords() });
  }, [open]);

  const trimmed = term.trim();
  const isSearching = trimmed.length >= MIN_TERM_LENGTH;

  const searchQuery = useQuery({
    queryKey: queryKeys.search.global(trimmed),
    queryFn: () => api.get<GlobalSearchResult>('/search', { query: { q: trimmed, limit: 5 } }),
    enabled: open && isSearching,
    staleTime: 20_000,
    retry: false,
  });

  const destinations = NAV_ITEMS.filter(
    (item) => !item.permissions?.length || item.permissions.some((permission) => has(permission)),
  );
  const quickActions = QUICK_ACTIONS.filter((action) => has(action.permission));

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  /** Opening a hit is what makes it worth remembering. */
  function openRecord(item: GlobalSearchResultItem) {
    pushRecentRecord(item);
    go(item.href);
  }

  function openAllResults() {
    if (!trimmed) return;
    pushRecentSearch(trimmed);
    go(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  const groups = searchQuery.data?.groups ?? [];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={!isSearching}>
      <CommandInput
        value={term}
        onValueChange={setTerm}
        placeholder="Search jobs, candidates and clients…"
        aria-label="Global search"
      />

      <CommandList>
        {isSearching && searchQuery.isFetching ? (
          <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Searching…
          </div>
        ) : null}

        {isSearching && !searchQuery.isFetching && groups.length === 0 ? (
          <CommandEmpty>No records match “{trimmed}”.</CommandEmpty>
        ) : null}

        {groups.map((group) => {
          const Icon = ENTITY_ICONS[group.entity];
          return (
            <CommandGroup key={group.entity} heading={`${group.label} · ${group.total}`}>
              {group.items.map((item) => (
                <CommandItem
                  key={`${item.entity}-${item.id}`}
                  value={`${item.entity}-${item.id}`}
                  onSelect={() => openRecord(item)}
                >
                  <Icon className="text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{item.title}</p>
                    {item.subtitle ? <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p> : null}
                  </div>
                  {item.badge ? <span className="text-2xs text-muted-foreground">{item.badge}</span> : null}
                  <ArrowRight className="text-muted-foreground" aria-hidden="true" />
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}

        {isSearching ? (
          <CommandGroup heading="Search">
            <CommandItem value="search all results" onSelect={openAllResults}>
              <Search aria-hidden="true" />
              <span className="truncate">See all results for “{trimmed}”</span>
              <CommandShortcut>↵</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        ) : null}

        {!isSearching && recents.searches.length > 0 ? (
          <CommandGroup heading="Recent searches">
            {recents.searches.map((entry) => (
              <CommandItem key={entry} value={`recent search ${entry}`} onSelect={() => setTerm(entry)}>
                <History aria-hidden="true" />
                <span className="truncate">{entry}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {!isSearching && recents.records.length > 0 ? (
          <CommandGroup heading="Recent records">
            {recents.records.map((item) => {
              const Icon = ENTITY_ICONS[item.entity];
              return (
                <CommandItem
                  key={`${item.entity}-${item.id}`}
                  value={`recent record ${item.title}`}
                  onSelect={() => openRecord(item)}
                >
                  <Icon className="text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{item.title}</p>
                    {item.subtitle ? <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p> : null}
                  </div>
                  {item.badge ? <span className="text-2xs text-muted-foreground">{item.badge}</span> : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {quickActions.length > 0 ? (
          <CommandGroup heading="Quick actions">
            {quickActions.map((action) => (
              <CommandItem key={action.href} value={`action ${action.label}`} onSelect={() => go(action.href)}>
                <action.icon aria-hidden="true" />
                <span>{action.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        <CommandSeparator />

        <CommandGroup heading="Go to">
          {destinations.map((item) => (
            <CommandItem key={item.href} value={`nav ${item.label}`} onSelect={() => go(item.href)}>
              <item.icon aria-hidden="true" />
              <span>{item.label}</span>
              {item.phase && item.phase > 1 ? <CommandShortcut>Phase {item.phase}</CommandShortcut> : null}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Account">
          <CommandItem value="account profile" onSelect={() => go('/settings/profile')}>
            <UserRound aria-hidden="true" />
            <span>Your profile</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>

      <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-2xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <CornerDownLeft className="size-3" aria-hidden="true" />
          open
        </span>
        <span>esc to close</span>
      </div>
    </CommandDialog>
  );
}
