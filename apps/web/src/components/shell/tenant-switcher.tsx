'use client';

import { Building2, Check, ChevronsUpDown, Globe } from 'lucide-react';

import { cn, getInitials } from '@talentflow/ui';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSession } from '@/providers/session-provider';

/**
 * Workspace switcher.
 *
 * Only platform operators see more than one entry — a regular user is bound to
 * their tenant for the life of the session, so the control degrades to a static
 * label rather than pretending to be a picker.
 */
export function TenantSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { tenant, user, availableTenants, switchTenant } = useSession();

  const label = tenant?.name ?? (user?.isSuperAdmin ? 'Platform' : 'No workspace');
  const isSwitcher = availableTenants.length > 1;

  const identity = (
    <>
      <span
        className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-sidebar-accent text-sidebar-accent-foreground"
        aria-hidden="true"
      >
        {tenant?.logoUrl ? (
          // Workspace logos are user-supplied URLs, so a plain img avoids needing
          // a remote-pattern allowlist in next.config.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tenant.logoUrl} alt="" className="size-full object-cover" />
        ) : tenant ? (
          <span className="text-2xs font-semibold">{getInitials(tenant.name)}</span>
        ) : (
          <Globe className="size-3.5" />
        )}
      </span>
      {collapsed ? null : (
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-xs font-medium text-sidebar-accent-foreground">{label}</span>
          {tenant ? (
            <span className="block truncate text-2xs text-sidebar-muted">{tenant.slug}</span>
          ) : (
            <span className="block truncate text-2xs text-sidebar-muted">All tenants</span>
          )}
        </span>
      )}
    </>
  );

  if (!isSwitcher) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5',
          collapsed && 'justify-center px-0',
        )}
        title={collapsed ? label : undefined}
      >
        {identity}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            'h-auto w-full justify-start gap-2 px-2 py-1.5 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            collapsed && 'justify-center px-0',
          )}
          aria-label={`Switch workspace, currently ${label}`}
        >
          {identity}
          {collapsed ? null : <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-muted" aria-hidden="true" />}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableTenants.map((option) => {
          const active = option.id === tenant?.id;
          return (
            <DropdownMenuItem
              key={option.id}
              disabled={active}
              onSelect={() => {
                if (!active) void switchTenant(option.id);
              }}
            >
              {active ? (
                <Check aria-hidden="true" />
              ) : (
                <Building2 aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate">{option.name}</span>
              <Avatar className="size-5">
                {option.logoUrl ? <AvatarImage src={option.logoUrl} alt="" /> : null}
                <AvatarFallback className="text-2xs">{getInitials(option.name)}</AvatarFallback>
              </Avatar>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
