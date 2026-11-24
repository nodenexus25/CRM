'use client';

import { Star, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  RATE_TYPE_LABELS,
  STAGE_CATEGORY_LABELS,
  WORK_AUTHORIZATION_LABELS,
  JOB_TYPE_LABELS,
  PRIORITY_LABELS,
  REMOTE_TYPE_LABELS,
  type JobDetail,
  type JobStats,
} from '@talentflow/types';
import { formatCurrency, formatDate, getInitials, humanizeEnum } from '@talentflow/ui';

import { HiringTeamDialog } from '@/components/jobs/hiring-team-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/providers/session-provider';

const CATEGORY_VARIANTS: Record<string, BadgeProps['variant']> = {
  ACTIVE: 'info',
  HIRED: 'success',
  REJECTED: 'destructive',
  WITHDRAWN: 'muted',
};

const RECRUITER_ROLE_LABELS: Record<string, string> = {
  OWNER: 'Hiring owner',
  RECRUITER: 'Recruiter',
  SOURCING: 'Sourcer',
  COORDINATOR: 'Coordinator',
};

function money(cents: number | null, currency: string): string {
  if (cents === null) return '—';
  return formatCurrency({ amount: cents / 100, currency, maximumFractionDigits: 2 });
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** The Overview tab: the requisition's details, team, skills and pipeline. */
export function JobOverview({ job, stats }: { job: JobDetail; stats?: JobStats }) {
  const { has, tenant } = useSession();

  const location =
    [job.locationCity, job.locationState, job.locationCountry].filter(Boolean).join(', ') ||
    job.location ||
    '—';

  const payRange =
    job.payRateMinCents === null && job.payRateMaxCents === null
      ? 'Not specified'
      : job.payRateMinCents !== null && job.payRateMaxCents !== null
        ? `${money(job.payRateMinCents, job.currency)} – ${money(job.payRateMaxCents, job.currency)}`
        : money(job.payRateMinCents ?? job.payRateMaxCents, job.currency);
  const rateSuffix = job.rateType ? ` ${RATE_TYPE_LABELS[job.rateType as keyof typeof RATE_TYPE_LABELS] ?? ''}` : '';

  const experience =
    job.minExperienceYears === null && job.maxExperienceYears === null
      ? 'Any'
      : job.minExperienceYears !== null && job.maxExperienceYears !== null
        ? `${job.minExperienceYears}–${job.maxExperienceYears} years`
        : `${job.minExperienceYears ?? job.maxExperienceYears ?? 0}+ years`;

  const pipeline = stats?.pipeline ?? job.pipeline;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Role details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-3">
              <DetailRow label="Job type">{JOB_TYPE_LABELS[job.jobType]}</DetailRow>
              <DetailRow label="Work model">{REMOTE_TYPE_LABELS[job.remoteType]}</DetailRow>
              <DetailRow label="Priority">{PRIORITY_LABELS[job.priority]}</DetailRow>
              <DetailRow label="Location">{location}</DetailRow>
              <DetailRow label="Openings">
                <span className="font-medium">{job.filledCount}</span> of {job.openings} filled
              </DetailRow>
              <DetailRow label="Target fill">
                {job.targetFillAt
                  ? formatDate(job.targetFillAt, 'DD MMM YYYY', tenant?.timezone)
                  : '—'}
              </DetailRow>
              <DetailRow label="Min experience">{experience}</DetailRow>
              <DetailRow label="Education">{job.educationLevel ?? '—'}</DetailRow>
              <DetailRow label="Visa sponsorship">
                {job.visaSponsorship === null ? 'Not specified' : job.visaSponsorship ? 'Yes' : 'No'}
              </DetailRow>
              <DetailRow label="Created">
                {formatDate(job.createdAt, 'DD MMM YYYY', tenant?.timezone)}
              </DetailRow>
              <DetailRow label="Opened">
                {job.openedAt ? formatDate(job.openedAt, 'DD MMM YYYY', tenant?.timezone) : 'Not opened'}
              </DetailRow>
              <DetailRow label="Source">{job.source ?? '—'}</DetailRow>
            </dl>

            {job.workAuthorizations.length > 0 ? (
              <div className="mt-5 space-y-1.5 border-t border-border pt-4">
                <p className="text-2xs uppercase tracking-wide text-muted-foreground">
                  Accepted work authorizations
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {job.workAuthorizations.map((authorization) => (
                    <Badge key={authorization} variant="muted">
                      {WORK_AUTHORIZATION_LABELS[authorization]}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Compensation</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-3">
              <DetailRow label="Pay range">
                {payRange}
                {rateSuffix}
              </DetailRow>
              <DetailRow label="Bill rate">{money(job.billRateCents, job.currency)}</DetailRow>
              <DetailRow label="Margin">
                {job.marginPercentage === null ? '—' : `${job.marginPercentage.toFixed(1)}%`}
              </DetailRow>
            </dl>
          </CardContent>
        </Card>

        {job.description ? (
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{job.description}</p>
            </CardContent>
          </Card>
        ) : null}

        {job.requirements ? (
          <Card>
            <CardHeader>
              <CardTitle>Requirements</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{job.requirements}</p>
            </CardContent>
          </Card>
        ) : null}

        {job.responsibilities ? (
          <Card>
            <CardHeader>
              <CardTitle>Responsibilities</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {job.responsibilities}
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Hiring team</CardTitle>
            {has('job:assign') ? (
              <HiringTeamDialog
                jobId={job.id}
                job={job}
                trigger={
                  <Button variant="outline" size="sm">
                    <UserPlus className="size-4" aria-hidden="true" />
                    Manage
                  </Button>
                }
              />
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {job.owner ? (
              <div className="flex items-center gap-2.5">
                <Avatar className="size-8">
                  {job.owner.avatarUrl ? <AvatarImage src={job.owner.avatarUrl} alt="" /> : null}
                  <AvatarFallback className="text-[10px]">
                    {getInitials(job.owner.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{job.owner.fullName}</p>
                  <p className="text-xs text-muted-foreground">Requisition owner</p>
                </div>
              </div>
            ) : null}

            {job.assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {job.owner ? 'No additional recruiters assigned.' : 'No one is assigned yet.'}
              </p>
            ) : (
              job.assignments.map((member) => (
                <div key={member.userId} className="flex items-center gap-2.5">
                  <Avatar className="size-8">
                    {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" /> : null}
                    <AvatarFallback className="text-[10px]">
                      {getInitials(member.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{member.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {RECRUITER_ROLE_LABELS[member.role] ?? humanizeEnum(member.role)}
                    </p>
                  </div>
                  {member.isPrimary ? (
                    <Badge variant="info" className="gap-1">
                      <Star className="size-3 fill-current" aria-hidden="true" />
                      Primary
                    </Badge>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats ? (
              <p className="text-xs text-muted-foreground">
                {stats.totals.active} active · {stats.totals.interviews} interviewing ·{' '}
                {stats.totals.placed} placed
              </p>
            ) : null}
            {pipeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stages configured.</p>
            ) : (
              <ul className="space-y-1.5">
                {pipeline.map((stage) => (
                  <li key={stage.id} className="flex items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full border border-black/10"
                      style={{ backgroundColor: stage.color }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{stage.name}</span>
                    <Badge variant={CATEGORY_VARIANTS[stage.category] ?? 'muted'}>
                      {STAGE_CATEGORY_LABELS[stage.category as keyof typeof STAGE_CATEGORY_LABELS] ??
                        humanizeEnum(stage.category)}
                    </Badge>
                    <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
                      {stage.applicationCount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Skills</CardTitle>
          </CardHeader>
          <CardContent>
            {job.skills.length === 0 ? (
              <p className="text-sm text-muted-foreground">No skills tagged yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {job.skills.map((skill) => (
                  <li key={skill.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{skill.name}</span>
                    {skill.minYears ? (
                      <span className="text-xs text-muted-foreground">{skill.minYears}y</span>
                    ) : null}
                    <Badge variant={skill.required ? 'secondary' : 'muted'}>
                      {skill.required ? 'Required' : 'Nice to have'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
