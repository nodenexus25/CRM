import {
  Ban,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CircleCheckBig,
  ClipboardList,
  GitBranch,
  Handshake,
  LayoutDashboard,
  ListChecks,
  Mail,
  type LucideIcon,
  Settings2,
  ShieldCheck,
  Upload,
  UserCog,
  UserRound,
  UsersRound,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Unlocks when the user holds **any** of these permissions. Empty = everyone. */
  permissions?: readonly string[];
  /** Phase this surface ships in — later phases render a "coming soon" screen. */
  phase?: number;
}

export interface NavSection {
  label: string;
  items: readonly NavItem[];
}

/**
 * Single source of truth for the sidebar, the Cmd+K palette and the breadcrumb
 * labels, so a route can never be reachable from one surface but not another.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Tasks', href: '/tasks', icon: CircleCheckBig, permissions: ['task:read'] },
    ],
  },
  {
    label: 'Recruiting',
    items: [
      {
        label: 'Jobs',
        href: '/jobs',
        icon: BriefcaseBusiness,
        permissions: ['job:read_all', 'job:read_own'],
        phase: 2,
      },
      {
        label: 'Candidates',
        href: '/candidates',
        icon: UserRound,
        permissions: ['candidate:read_all', 'candidate:read_own'],
        phase: 2,
      },
      {
        label: 'Submissions',
        href: '/submissions',
        icon: ClipboardList,
        permissions: ['application:read_all', 'application:read_own'],
        phase: 3,
      },
      {
        label: 'Interviews',
        href: '/interviews',
        icon: CalendarClock,
        permissions: ['interview:read'],
        phase: 3,
      },
      {
        label: 'Placements',
        href: '/placements',
        icon: Handshake,
        permissions: ['placement:read_all', 'placement:read_own'],
        phase: 3,
      },
    ],
  },
  {
    label: 'Clients',
    items: [
      {
        label: 'Clients',
        href: '/clients',
        icon: Building2,
        permissions: ['client:read_all', 'client:read_own'],
        phase: 3,
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users', href: '/users', icon: UsersRound, permissions: ['user:read'] },
      { label: 'Teams', href: '/teams', icon: UserCog, permissions: ['user:read'] },
      { label: 'Roles & permissions', href: '/roles', icon: ShieldCheck, permissions: ['role:read'] },
      {
        label: 'Pipeline stages',
        href: '/settings/pipeline',
        icon: GitBranch,
        permissions: ['pipeline:read'],
      },
      {
        label: 'Rejection reasons',
        href: '/settings/rejection-reasons',
        icon: Ban,
        permissions: ['pipeline:read'],
      },
      {
        label: 'Email templates',
        href: '/settings/email-templates',
        icon: Mail,
        permissions: ['email:template_read'],
      },
      {
        label: 'Bulk operations',
        href: '/settings/bulk-operations',
        icon: ListChecks,
        permissions: [
          'candidate:bulk_update',
          'candidate:delete',
          'candidate:export',
          'application:create',
          'list:manage',
          'job:bulk_update',
          'job:assign',
          'candidate:read_all',
        ],
      },
      {
        label: 'Import data',
        href: '/settings/imports',
        icon: Upload,
        permissions: [
          'import:create',
          'candidate:import',
          'candidate:create',
          'client:create',
          'job:create',
          'contact:create',
        ],
      },
      { label: 'Workspace', href: '/settings/workspace', icon: Settings2, permissions: ['tenant:read'] },
    ],
  },
  {
    label: 'Insights',
    items: [
      {
        label: 'Reports',
        href: '/reports',
        icon: BarChart3,
        permissions: ['report:view_own', 'report:view_team', 'report:view_all'],
        phase: 4,
      },
    ],
  },
] as const;

export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

/** Longest-prefix match so `/settings/workspace` resolves to its own item. */
export function findNavItem(pathname: string): NavItem | undefined {
  return [...NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}

/** Breadcrumb trail for the current path, from the sidebar hierarchy. */
export function breadcrumbsFor(pathname: string): { label: string; href?: string }[] {
  const crumbs: { label: string; href?: string }[] = [];
  const item = findNavItem(pathname);
  if (item) crumbs.push({ label: item.label, href: item.href });

  const segments = pathname.split('/').filter(Boolean).slice(1);
  for (const segment of segments) {
    crumbs.push({ label: humanizeSegment(segment) });
  }
  return crumbs;
}

function humanizeSegment(segment: string): string {
  return segment
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
