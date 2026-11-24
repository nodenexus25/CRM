'use client';

import { LogOut, Settings2, ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { getInitials } from '@talentflow/ui';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSession } from '@/providers/session-provider';

export function UserMenu() {
  const { user, permissions, has, logout } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  // The session always resolves before the shell renders, so this is a guard for
  // type-narrowing rather than a real runtime branch.
  if (!user) return null;

  const canReadWorkspace = has('tenant:read');
  const canReadRoles = has('role:read');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label={`Account menu for ${user.fullName}`}
        >
          <Avatar className="size-7">
            {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
            <AvatarFallback>{getInitials(user.fullName)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar className="size-9">
            {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
            <AvatarFallback>{getInitials(user.fullName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 px-2 pb-2">
          {user.isSuperAdmin ? <Badge variant="warning">Platform admin</Badge> : null}
          {user.roles.map((role) => (
            <Badge key={role.id} variant="muted">
              {role.name}
            </Badge>
          ))}
          {!user.emailVerified ? <Badge variant="destructive">Email unverified</Badge> : null}
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <UserRound aria-hidden="true" />
            Your profile
          </Link>
        </DropdownMenuItem>

        {canReadWorkspace ? (
          <DropdownMenuItem asChild>
            <Link href="/settings/workspace">
              <Settings2 aria-hidden="true" />
              Workspace settings
            </Link>
          </DropdownMenuItem>
        ) : null}

        {canReadRoles ? (
          <DropdownMenuItem asChild>
            <Link href="/roles">
              <ShieldCheck aria-hidden="true" />
              Roles &amp; permissions
            </Link>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          destructive
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault();
            setSigningOut(true);
            void logout().finally(() => setSigningOut(false));
          }}
        >
          <LogOut aria-hidden="true" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>

        {/* Rendered so the permission set stays visible while developing the shell. */}
        <span className="sr-only">{permissions.length} permissions granted</span>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
