'use client';

import { Flame, MapPin } from 'lucide-react';
import Link from 'next/link';

import {
  CANDIDATE_STATUS_LABELS,
  type CandidateListItem,
  type CandidateStatus,
} from '@talentflow/types';
import { getInitials } from '@talentflow/ui';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

const STATUS_VARIANT: Record<CandidateStatus, BadgeProps['variant']> = {
  ACTIVE: 'success',
  PASSIVE: 'secondary',
  DO_NOT_CONTACT: 'destructive',
  PLACED: 'info',
  ARCHIVED: 'muted',
};

/** Compact tile for the candidates card view. */
export function CandidateCard({ candidate }: { candidate: CandidateListItem }) {
  return (
    <Card className="flex h-full flex-col gap-4 p-4 transition-colors hover:border-primary/40">
      <div className="flex items-start gap-3">
        <Avatar className="size-10">
          <AvatarFallback>{getInitials(candidate.fullName)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/candidates/${candidate.id}`}
              className="truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
            >
              {candidate.fullName}
            </Link>
            {candidate.isHot ? (
              <Flame className="size-3.5 shrink-0 text-destructive" role="img" aria-label="Hot candidate" />
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {candidate.currentTitle ?? 'No title on file'}
            {candidate.currentCompany ? <> @ {candidate.currentCompany}</> : null}
          </p>
        </div>

        <Badge variant={STATUS_VARIANT[candidate.status]}>
          {CANDIDATE_STATUS_LABELS[candidate.status]}
        </Badge>
      </div>

      {candidate.location ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3.5" aria-hidden="true" />
          <span className="truncate">{candidate.location}</span>
        </p>
      ) : null}

      {candidate.skills.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {candidate.skills.slice(0, 3).map((skill) => (
            <Badge key={skill.id} variant="muted">
              {skill.name}
            </Badge>
          ))}
          {candidate.skills.length > 3 ? (
            <span className="text-2xs text-muted-foreground">+{candidate.skills.length - 3}</span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
        <Avatar className="size-5">
          {candidate.owner?.avatarUrl ? <AvatarImage src={candidate.owner.avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-[9px]">
            {candidate.owner ? getInitials(candidate.owner.fullName) : '—'}
          </AvatarFallback>
        </Avatar>
        <span className="truncate text-xs text-muted-foreground">
          {candidate.owner?.fullName ?? 'Unassigned'}
        </span>
      </div>
    </Card>
  );
}
