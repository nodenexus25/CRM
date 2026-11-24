'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, MoreHorizontal, Star, Undo2, XCircle } from 'lucide-react';
import Link from 'next/link';

import type { ApplicationCard as ApplicationCardData } from '@talentflow/types';
import { cn, getInitials } from '@talentflow/ui';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ApplicationCardProps {
  card: ApplicationCardData;
  /** Whether the card may be picked up; false renders it read-only. */
  draggable: boolean;
  /** Whether reject / withdraw actions are offered in the card menu. */
  canMove: boolean;
  onReject: (card: ApplicationCardData) => void;
  onWithdraw: (card: ApplicationCardData) => void;
}

/** A single candidate in a pipeline column. Sortable within and across columns. */
export function ApplicationCard({
  card,
  draggable,
  canMove,
  onReject,
  onWithdraw,
}: ApplicationCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: !draggable,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'rounded-lg border border-border bg-card p-3 shadow-xs transition-shadow',
        isDragging && 'relative z-10 shadow-lg ring-2 ring-primary/30',
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={!draggable}
          aria-label={`Move ${card.candidateName}`}
          className={cn(
            'mt-0.5 rounded-sm p-0.5 text-muted-foreground transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            draggable
              ? 'cursor-grab hover:bg-accent hover:text-foreground active:cursor-grabbing'
              : 'cursor-default opacity-40',
          )}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>

        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Avatar className="size-8">
            {card.candidateAvatarUrl ? <AvatarImage src={card.candidateAvatarUrl} alt="" /> : null}
            <AvatarFallback className="text-[10px]">
              {getInitials(card.candidateName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <Link
              href={`/applications/${card.id}`}
              className="block truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
            >
              {card.candidateName}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {card.currentTitle ?? 'Candidate'}
              {card.currentCompany ? ` · ${card.currentCompany}` : ''}
            </p>
          </div>

          {canMove ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${card.candidateName}`}
                  className="-mt-1 -mr-1"
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem destructive onSelect={() => onReject(card)}>
                  <XCircle className="size-4" aria-hidden="true" />
                  Reject
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onWithdraw(card)}>
                  <Undo2 className="size-4" aria-hidden="true" />
                  Withdraw
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {card.location ? (
        <p className="mt-2 truncate text-xs text-muted-foreground">{card.location}</p>
      ) : null}

      {card.rating ? (
        <div className="mt-2 flex items-center gap-0.5" aria-label={`Rated ${card.rating} of 5`}>
          {Array.from({ length: 5 }).map((_, index) => (
            <Star
              key={index}
              className={cn(
                'size-3',
                index < (card.rating ?? 0)
                  ? 'fill-warning text-warning'
                  : 'text-muted-foreground/40',
              )}
              aria-hidden="true"
            />
          ))}
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge variant={card.slaBreached ? 'destructive' : 'muted'}>
          {card.daysInStage === 0 ? 'New today' : `${card.daysInStage}d in stage`}
        </Badge>
        {card.isRejected ? <Badge variant="destructive">Rejected</Badge> : null}
        {card.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="muted">
            {tag}
          </Badge>
        ))}
        {card.tags.length > 2 ? (
          <span className="text-2xs text-muted-foreground">+{card.tags.length - 2}</span>
        ) : null}
      </div>
    </li>
  );
}
