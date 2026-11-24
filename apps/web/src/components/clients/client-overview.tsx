'use client';

import { BriefcaseBusiness, FileCheck2, Mail, MapPin, Phone, Users } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { JOB_STATUS_LABELS, type ClientDetail, type JobStatus } from '@talentflow/types';
import { formatCurrency, formatDate, getInitials, humanizeEnum } from '@talentflow/ui';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSession } from '@/providers/session-provider';

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  PROSPECT: 'info',
  ACTIVE: 'success',
  INACTIVE: 'muted',
  CHURNED: 'destructive',
};

const JOB_STATUS_VARIANT: Record<JobStatus, BadgeProps['variant']> = {
  DRAFT: 'muted',
  OPEN: 'success',
  ON_HOLD: 'warning',
  CLOSED: 'muted',
  FILLED: 'info',
  CANCELLED: 'destructive',
};

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

function money(cents: number | null, currency: string | null): string {
  if (cents === null) return '—';
  return formatCurrency({ amount: cents / 100, currency: currency ?? 'USD', maximumFractionDigits: 2 });
}

function jobStatusLabel(status: string): string {
  return JOB_STATUS_LABELS[status as JobStatus] ?? humanizeEnum(status);
}

/** The Overview tab: the account, its address and the commercial defaults. */
export function ClientOverview({ client }: { client: ClientDetail }) {
  const { tenant } = useSession();

  const addressLines = [
    client.addressLine1,
    client.addressLine2,
    [client.city, client.state, client.postalCode].filter(Boolean).join(', ') || null,
    client.country,
  ].filter((line): line is string => Boolean(line));

  const website = client.website;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Company</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-3">
              <DetailRow label="Status">
                <Badge variant={STATUS_VARIANT[client.status] ?? 'muted'}>
                  {humanizeEnum(client.status)}
                </Badge>
              </DetailRow>
              <DetailRow label="Legal name">{client.legalName ?? '—'}</DetailRow>
              <DetailRow label="Industry">{client.industry ?? '—'}</DetailRow>
              <DetailRow label="Website">
                {website ? (
                  <a
                    href={website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {website.replace(/^https?:\/\//, '')}
                  </a>
                ) : (
                  '—'
                )}
              </DetailRow>
              <DetailRow label="Email">
                {client.email ? (
                  <a href={`mailto:${client.email}`} className="text-primary underline-offset-4 hover:underline">
                    {client.email}
                  </a>
                ) : (
                  '—'
                )}
              </DetailRow>
              <DetailRow label="Phone">{client.phone ?? '—'}</DetailRow>
              <DetailRow label="Source">{client.source ?? '—'}</DetailRow>
              <DetailRow label="External ID">{client.externalId ?? '—'}</DetailRow>
              <DetailRow label="Created">
                {formatDate(client.createdAt, 'DD MMM YYYY', tenant?.timezone)}
              </DetailRow>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
          </CardHeader>
          <CardContent>
            {addressLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No address on file.</p>
            ) : (
              <address className="flex items-start gap-2 not-italic">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm leading-relaxed text-foreground">
                  {addressLines.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </span>
              </address>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commercial terms</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-3">
              <DetailRow label="Default bill rate">
                {money(client.defaultBillRateCents, client.currency)}
              </DetailRow>
              <DetailRow label="Default fee">
                {client.defaultFeePercentage === null ? '—' : `${client.defaultFeePercentage}%`}
              </DetailRow>
              <DetailRow label="Payment terms">
                {client.paymentTermsDays === null ? '—' : `${client.paymentTermsDays} days`}
              </DetailRow>
              <DetailRow label="Currency">{client.currency ?? '—'}</DetailRow>
            </dl>
          </CardContent>
        </Card>

        {client.description ? (
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{client.description}</p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Account owner</CardTitle>
          </CardHeader>
          <CardContent>
            {client.owner ? (
              <div className="flex items-center gap-2.5">
                <Avatar className="size-9">
                  {client.owner.avatarUrl ? <AvatarImage src={client.owner.avatarUrl} alt="" /> : null}
                  <AvatarFallback className="text-[10px]">
                    {getInitials(client.owner.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{client.owner.fullName}</p>
                  <p className="text-xs text-muted-foreground">Relationship owner</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No owner assigned.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>At a glance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2.5">
              <BriefcaseBusiness className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1 text-sm">Open requisitions</span>
              <span className="text-sm font-medium tabular-nums">{client.openJobs}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <BriefcaseBusiness className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1 text-sm">Total requisitions</span>
              <span className="text-sm font-medium tabular-nums">{client.totalJobs}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Users className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1 text-sm">Contacts</span>
              <span className="text-sm font-medium tabular-nums">{client.contactCount}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <FileCheck2 className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1 text-sm">Placements</span>
              <span className="text-sm font-medium tabular-nums">{client.placements.length}</span>
            </div>
          </CardContent>
        </Card>

        {client.email || client.phone ? (
          <Card>
            <CardHeader>
              <CardTitle>Reach the account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {client.email ? (
                <a
                  href={`mailto:${client.email}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Mail className="size-4" aria-hidden="true" />
                  {client.email}
                </a>
              ) : null}
              {client.phone ? (
                <a
                  href={`tel:${client.phone}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Phone className="size-4" aria-hidden="true" />
                  {client.phone}
                </a>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/** The Jobs tab: every requisition opened for this client, plus its placements. */
export function ClientJobsPanel({ client }: { client: ClientDetail }) {
  const { tenant } = useSession();

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>
            Requisitions
            <span className="ml-2 text-xs font-normal text-muted-foreground">{client.jobs.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {client.jobs.length === 0 ? (
            <EmptyState
              icon={BriefcaseBusiness}
              title="No requisitions yet"
              description="Jobs opened for this client appear here."
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Requisition</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Openings</TableHead>
                    <TableHead className="text-right">Applicants</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {client.jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>
                        <Link href={`/jobs/${job.id}`} className="block hover:underline">
                          <span className="text-sm font-medium">{job.title}</span>
                          <span className="block text-xs text-muted-foreground">{job.referenceCode}</span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={JOB_STATUS_VARIANT[job.status as JobStatus] ?? 'muted'}>
                          {jobStatusLabel(job.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{job.openings}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{job.applicantCount}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(job.createdAt, 'DD MMM YYYY', tenant?.timezone)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>
            Placements
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {client.placements.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {client.placements.length === 0 ? (
            <EmptyState
              icon={FileCheck2}
              title="No placements yet"
              description="Once a candidate is placed with this client it shows here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {client.placements.map((placement) => (
                <li key={placement.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{placement.candidateName}</p>
                    <p className="text-xs text-muted-foreground">
                      {placement.startDate
                        ? `Started ${formatDate(placement.startDate, 'DD MMM YYYY', tenant?.timezone)}`
                        : 'Start date not set'}
                    </p>
                  </div>
                  <Badge variant="muted">{humanizeEnum(placement.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
