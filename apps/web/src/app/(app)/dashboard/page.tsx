'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  CheckCircle2,
  Circle,
  KeyRound,
  MailWarning,
  ShieldCheck,
  Users2,
} from 'lucide-react';
import Link from 'next/link';

import type {
  NotificationSummary,
  Paginated,
  RoleListItem,
  TeamListItem,
  TenantDetail,
} from '@talentflow/types';
import { ROLE_KEY_LABELS } from '@talentflow/types';
import { cn, formatDate, formatRelativeTime, getInitials } from '@talentflow/ui';

import { PageHeader } from '@/components/shell/page-header';
import { MyDayPanel } from '@/components/tasks/my-day-panel';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

interface SetupStep {
  label: string;
  description: string;
  done: boolean;
  href?: string;
  /** Hidden unless the signed-in user holds this permission. */
  permission?: string;
}

export default function DashboardPage() {
  const { user, tenant, has } = useSession();

  const canReadWorkspace = has('tenant:read');
  const canReadUsers = has('user:read');
  const canReadRoles = has('role:read');

  const workspace = useQuery({
    queryKey: queryKeys.workspace.detail,
    queryFn: () => api.get<TenantDetail>('/workspace'),
    enabled: canReadWorkspace,
    staleTime: 60_000,
  });

  const teams = useQuery({
    queryKey: queryKeys.teams.list,
    queryFn: () => api.get<TeamListItem[]>('/teams'),
    enabled: canReadUsers,
    staleTime: 60_000,
  });

  const roles = useQuery({
    queryKey: queryKeys.roles.list({ page: 1, pageSize: 1 }),
    queryFn: () => api.get<Paginated<RoleListItem>>('/roles', { query: { page: 1, pageSize: 1 } }),
    enabled: canReadRoles,
    staleTime: 60_000,
  });

  const notifications = useQuery({
    queryKey: queryKeys.notifications.summary,
    queryFn: () => api.get<NotificationSummary>('/notifications/summary'),
    staleTime: 30_000,
  });

  if (!user || !tenant) return null;

  const counts = workspace.data?.memberCounts;
  const roleNames = user.roles.map((role) => role.name).join(', ');

  const steps: SetupStep[] = [
    {
      label: 'Create your workspace',
      description: workspace.data?.primaryDomain
        ? `${tenant.name} is live at ${tenant.slug} and mapped to ${workspace.data.primaryDomain}.`
        : `${tenant.name} is live at ${tenant.slug}. Add a custom domain before you invite clients.`,
      done: true,
    },
    {
      label: 'Verify your email address',
      description: user.emailVerified
        ? `${user.email} is confirmed.`
        : `Confirm ${user.email} to receive submission and interview notifications.`,
      done: user.emailVerified,
      href: '/settings/profile',
    },
    {
      label: 'Invite your team',
      description: 'Add recruiters, managers and account managers with the right roles.',
      done: Boolean(counts && counts.total > 1),
      href: '/users',
      permission: 'user:invite',
    },
    {
      label: 'Review roles and permissions',
      description: 'Fine-tune what each role can see and do in this workspace.',
      done: false,
      href: '/roles',
      permission: 'role:read',
    },
    {
      label: 'Configure workspace settings',
      description: 'Branding, currency, timezone and candidate submission defaults.',
      done: false,
      href: '/settings/workspace',
      permission: 'tenant:update',
    },
  ];

  const visibleSteps = steps.filter((step) => !step.permission || has(step.permission));
  const completed = visibleSteps.filter((step) => step.done).length;

  const stats = [
    {
      label: 'Team members',
      value: counts ? String(counts.total) : null,
      hint: counts ? `${counts.active} active` : 'Workspace access required',
      icon: Users2,
    },
    {
      label: 'Pending invites',
      value: counts ? String(counts.invited) : null,
      hint: 'Awaiting acceptance',
      icon: MailWarning,
    },
    {
      label: 'Teams',
      value: teams.data ? String(teams.data.length) : null,
      hint: 'Across the workspace',
      icon: BadgeCheck,
    },
    {
      label: 'Roles',
      value: roles.data ? String(roles.data.meta.total) : null,
      hint: 'System and custom',
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title="Dashboard"
        description={
          roleNames
            ? `Everything happening in ${tenant.name}. You are signed in as ${roleNames}.`
            : `Everything happening in ${tenant.name}.`
        }
        actions={
          has('user:invite') ? (
            <Button asChild size="sm">
              <Link href="/users">
                Invite a teammate
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Badge variant="secondary">Phase 1 · Foundation</Badge>
          )
        }
      />

      <MyDayPanel />

      <section aria-label="Workspace totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-start justify-between gap-4 p-5">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </p>
                {stat.value === null ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <p className="text-2xl font-semibold tabular-nums tracking-tight">{stat.value}</p>
                )}
                <p className="text-xs text-muted-foreground">{stat.hint}</p>
              </div>
              <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <stat.icon className="size-4" aria-hidden="true" />
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Getting started</CardTitle>
            <CardDescription>
              {completed} of {visibleSteps.length} steps complete — finish them to hand the workspace
              over to your team.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="divide-y divide-border">
              {visibleSteps.map((step) => (
                <li key={step.label} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  {step.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className={cn('text-sm font-medium', step.done && 'text-muted-foreground')}>
                      {step.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                  </div>
                  {step.href && !step.done ? (
                    <Button asChild variant="ghost" size="sm" className="shrink-0">
                      <Link href={step.href}>
                        {step.href === '/settings/profile' ? 'Review' : 'Open'}
                      </Link>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your workspace</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Plan" value={tenant.planName ?? 'Trial'} />
              <Row label="Timezone" value={tenant.timezone} />
              <Row label="Currency" value={tenant.currency} />
              <Row
                label="Workspace since"
                value={formatDate(workspace.data?.createdAt, 'DD MMM YYYY', tenant.timezone)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
                Your access
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {user.roles.length > 0 ? (
                  user.roles.map((role) => (
                    <Badge key={role.id} variant="default">
                      {ROLE_KEY_LABELS[role.key] ?? role.name}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="muted">No role assigned</Badge>
                )}
                {user.isSuperAdmin ? <Badge variant="warning">Platform admin</Badge> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {user.permissions.length} permissions granted in this workspace. Administration
                screens are hidden when you lack the matching permission.
              </p>
              {has('role:read') ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/roles">View roles &amp; permissions</Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {notifications.isPending ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (notifications.data?.items.length ?? 0) === 0 ? (
                <div className="flex items-center gap-3 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  <Bell className="size-4" aria-hidden="true" />
                  Nothing yet. Invite a teammate to get started.
                </div>
              ) : (
                <ul className="space-y-3">
                  {notifications.data?.items.slice(0, 4).map((item) => (
                    <li key={item.id} className="flex items-start gap-3">
                      <Avatar className="size-7">
                        {item.actor?.avatarUrl ? (
                          <AvatarImage src={item.actor.avatarUrl} alt="" />
                        ) : null}
                        <AvatarFallback className="text-2xs">
                          {getInitials(item.actor?.fullName ?? 'TF')}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate text-sm font-medium">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatRelativeTime(item.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {!user.emailVerified ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <MailWarning className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Your email is not verified</p>
                <p className="text-xs text-muted-foreground">
                  Some features stay limited until {user.email} is confirmed.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/profile">Resend verification</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] text-right font-medium">{value}</span>
    </div>
  );
}
