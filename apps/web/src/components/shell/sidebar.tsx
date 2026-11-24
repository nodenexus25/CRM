'use client';

import { ChevronsLeft, ChevronsRight, LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@talentflow/ui';

import { Logo, LogoMark } from '@/components/shell/logo';
import { TenantSwitcher } from '@/components/shell/tenant-switcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NAV_SECTIONS, type NavItem } from '@/lib/navigation';
import { useSession } from '@/providers/session-provider';

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Called after a link is followed, so the mobile drawer can close itself. */
  onNavigate?: () => void;
  className?: string;
}

export function Sidebar({ collapsed = false, onToggleCollapse, onNavigate, className }: SidebarProps) {
  const pathname = usePathname();
  const { has } = useSession();

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.permissions?.length || item.permissions.some((permission) => has(permission)),
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <div
      className={cn('flex h-dvh flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground', className)}
    >
      <div className={cn('flex h-14 items-center gap-2 px-3', collapsed && 'justify-center px-0')}>
        <Link
          href="/dashboard"
          className="flex items-center rounded-md text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? <LogoMark className="size-6" /> : <Logo />}
          <span className="sr-only">TalentFlow dashboard</span>
        </Link>
      </div>

      <div className="px-2 pb-2">
        <TenantSwitcher collapsed={collapsed} />
      </div>

      <ScrollArea className="flex-1 px-2">
        <nav aria-label="Workspace" className="space-y-4 pb-4">
          {sections.map((section) => (
            <div key={section.label}>
              {collapsed ? (
                <div className="mx-auto my-2 h-px w-6 bg-sidebar-border" aria-hidden="true" />
              ) : (
                <p className="px-2 pb-1 text-2xs font-medium uppercase tracking-wider text-sidebar-muted">
                  {section.label}
                </p>
              )}

              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      item={item}
                      active={isActive(pathname, item.href)}
                      collapsed={collapsed}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </ScrollArea>

      <div className="border-t border-sidebar-border p-2">
        <ul className="space-y-0.5">
          <li>
            <Link
              href="mailto:support@talentflow.app"
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 transition-colors',
                'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                collapsed && 'justify-center px-0',
              )}
              title={collapsed ? 'Support' : undefined}
            >
              <LifeBuoy className="size-4 shrink-0" aria-hidden="true" />
              {collapsed ? <span className="sr-only">Support</span> : <span>Support</span>}
            </Link>
          </li>
        </ul>

        {onToggleCollapse ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            className={cn(
              'mt-1 hidden w-full justify-start gap-2.5 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:flex',
              collapsed && 'justify-center px-0',
            )}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <ChevronsRight className="size-4" aria-hidden="true" />
            ) : (
              <>
                <ChevronsLeft className="size-4" aria-hidden="true" />
                <span>Collapse</span>
              </>
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      <item.icon className="size-4 shrink-0" aria-hidden="true" />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
      {!collapsed && item.phase && item.phase > 1 ? (
        <Badge variant="muted" className="ml-auto bg-sidebar-accent/60 text-sidebar-muted">
          P{item.phase}
        </Badge>
      ) : null}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

/** Longest-prefix match so a nested route keeps its parent highlighted. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
