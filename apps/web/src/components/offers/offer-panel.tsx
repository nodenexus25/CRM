'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Handshake,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
  Undo2,
  XCircle,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import {
  OFFER_STATUS_LABELS,
  RATE_TYPE_LABELS,
  rateTypeSchema,
  type OfferListItem,
  type OfferStatus,
  type Paginated,
  type PlacementListItem,
} from '@talentflow/types';
import { formatCurrency, formatDate, formatRelativeTime } from '@talentflow/ui';

import { OfferDialog } from '@/components/offers/offer-dialog';
import { PlacementCard } from '@/components/placements/placement-card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const STATUS_VARIANT: Record<OfferStatus, BadgeProps['variant']> = {
  DRAFT: 'muted',
  SENT: 'info',
  ACCEPTED: 'success',
  DECLINED: 'destructive',
  EXPIRED: 'warning',
  WITHDRAWN: 'muted',
};

function money(cents: number | null, currency: string): string | null {
  return cents === null
    ? null
    : formatCurrency({ amount: cents / 100, currency, maximumFractionDigits: 2 });
}

function rate(cents: number | null, currency: string, period: string): string | null {
  const amount = money(cents, currency);
  if (amount === null) return null;
  const parsed = rateTypeSchema.safeParse(period);
  return parsed.success ? `${amount} ${RATE_TYPE_LABELS[parsed.data]}` : amount;
}

interface OfferPanelProps {
  applicationId: string;
}

/**
 * The offers raised for one application, plus the placement an accepted offer
 * produced. Everything a negotiator needs lives here: raise an offer, walk it
 * along its lifecycle, and see the commercial terms once it is signed.
 */
export function OfferPanel({ applicationId }: OfferPanelProps) {
  const { has } = useSession();
  const queryClient = useQueryClient();

  const canRead = has('offer:read');
  const canCreate = has('offer:create');
  const canUpdate = has('offer:update');
  const canDelete = has('offer:delete');
  const canViewMargin = has('placement:view_margin');
  const canReadPlacements = has('placement:read_all') || has('placement:read_own');

  const [dialog, setDialog] = useState<{ offer: OfferListItem | null } | null>(null);

  const offers = useQuery({
    queryKey: queryKeys.offers.list({ applicationId }),
    queryFn: () =>
      api.get<Paginated<OfferListItem>>('/offers', {
        query: { applicationId, pageSize: 50, sortBy: 'createdAt', sortDir: 'desc' },
      }),
    enabled: canRead,
    staleTime: 15_000,
  });

  const placements = useQuery({
    queryKey: queryKeys.placements.list({ applicationId }),
    queryFn: () =>
      api.get<Paginated<PlacementListItem>>('/placements', {
        query: { applicationId, pageSize: 25 },
      }),
    enabled: canReadPlacements,
    staleTime: 15_000,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.offers.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.placements.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
  }

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OfferStatus }) =>
      api.patch<OfferListItem>(`/offers/${id}`, { status }),
    onSuccess: () => {
      invalidate();
      toast.success('Offer updated');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not update the offer');
    },
  });

  const accept = useMutation({
    mutationFn: (id: string) => api.post<OfferListItem>(`/offers/${id}/accept`, {}),
    onSuccess: () => {
      invalidate();
      toast.success('Offer accepted — the placement is live');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not accept the offer');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/offers/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Offer deleted');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete the offer');
    },
  });

  const items = offers.data?.items ?? [];
  const placementItems = placements.data?.items ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle>Offers</CardTitle>
            <p className="text-xs text-muted-foreground">
              Accepting an offer creates the placement and moves the candidate to the placed stage.
            </p>
          </div>
          {canCreate ? (
            <Button size="sm" onClick={() => setDialog({ offer: null })}>
              Raise offer
            </Button>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-4">
          {!canRead ? (
            <EmptyState
              title="You cannot view offers"
              description="Ask a workspace administrator for the “View offers” permission."
            />
          ) : offers.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : offers.isError ? (
            <EmptyState
              title="Could not load offers"
              description={
                offers.error instanceof Error ? offers.error.message : 'Please try again in a moment.'
              }
              action={
                <Button variant="outline" size="sm" onClick={() => void offers.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Handshake}
              title="No offers yet"
              description="Raise an offer once the client is ready to hire."
              action={
                canCreate ? (
                  <Button size="sm" onClick={() => setDialog({ offer: null })}>
                    Raise offer
                  </Button>
                ) : null
              }
            />
          ) : (
            <ul className="space-y-3">
              {items.map((offer) => (
                <OfferRow
                  key={offer.id}
                  offer={offer}
                  canUpdate={canUpdate}
                  canDelete={canDelete}
                  busy={changeStatus.isPending || accept.isPending || remove.isPending}
                  onEdit={() => setDialog({ offer })}
                  onSend={() => changeStatus.mutate({ id: offer.id, status: 'SENT' })}
                  onAccept={() => accept.mutate(offer.id)}
                  onDecline={() => changeStatus.mutate({ id: offer.id, status: 'DECLINED' })}
                  onWithdraw={() => changeStatus.mutate({ id: offer.id, status: 'WITHDRAWN' })}
                  onDelete={() => remove.mutate(offer.id)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canReadPlacements ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Placement</h3>
            <Separator className="flex-1" />
          </div>

          {placements.isPending ? (
            <Skeleton className="h-56 w-full" />
          ) : placements.isError ? (
            <EmptyState
              title="Could not load the placement"
              description={
                placements.error instanceof Error
                  ? placements.error.message
                  : 'Please try again in a moment.'
              }
              action={
                <Button variant="outline" size="sm" onClick={() => void placements.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : placementItems.length === 0 ? (
            <EmptyState
              icon={Handshake}
              title="Not placed yet"
              description="A placement appears here as soon as an offer is accepted."
            />
          ) : (
            placementItems.map((placement) => (
              <PlacementCard
                key={placement.id}
                placement={placement}
                canViewMargin={canViewMargin}
              />
            ))
          )}
        </div>
      ) : null}

      <OfferDialog
        applicationId={applicationId}
        offer={dialog?.offer ?? null}
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
    </div>
  );
}

interface OfferRowProps {
  offer: OfferListItem;
  canUpdate: boolean;
  canDelete: boolean;
  busy: boolean;
  onEdit: () => void;
  onSend: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onWithdraw: () => void;
  onDelete: () => void;
}

function OfferRow({
  offer,
  canUpdate,
  canDelete,
  busy,
  onEdit,
  onSend,
  onAccept,
  onDecline,
  onWithdraw,
  onDelete,
}: OfferRowProps) {
  const salary = money(offer.salaryCents, offer.currency);
  const payRate = rate(offer.payRateCents, offer.currency, offer.ratePeriod);
  const billRate = rate(offer.billRateCents, offer.currency, offer.ratePeriod);
  const bonus = money(offer.bonusCents, offer.currency);

  const isOpen = offer.status === 'DRAFT' || offer.status === 'SENT';

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{offer.title ?? 'Offer'}</p>
            <Badge variant={STATUS_VARIANT[offer.status]}>
              {OFFER_STATUS_LABELS[offer.status]}
            </Badge>
          </div>
          <p className="text-2xs text-muted-foreground">
            {offer.createdBy ? `${offer.createdBy.fullName} · ` : ''}
            {formatRelativeTime(offer.createdAt)}
          </p>
        </div>

        {canUpdate || canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Offer actions" disabled={busy}>
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {canUpdate ? (
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit terms
                </DropdownMenuItem>
              ) : null}
              {canUpdate && offer.status === 'DRAFT' ? (
                <DropdownMenuItem onSelect={onSend}>
                  <Send className="size-4" aria-hidden="true" />
                  Mark as sent
                </DropdownMenuItem>
              ) : null}
              {canUpdate && offer.status === 'SENT' ? (
                <>
                  <DropdownMenuItem onSelect={onAccept}>
                    <BadgeCheck className="size-4" aria-hidden="true" />
                    Mark as accepted
                  </DropdownMenuItem>
                  <DropdownMenuItem destructive onSelect={onDecline}>
                    <XCircle className="size-4" aria-hidden="true" />
                    Mark as declined
                  </DropdownMenuItem>
                </>
              ) : null}
              {canUpdate && isOpen ? (
                <DropdownMenuItem onSelect={onWithdraw}>
                  <Undo2 className="size-4" aria-hidden="true" />
                  Withdraw
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={onDelete}>
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        {salary ? <Field label="Salary">{salary}</Field> : null}
        {payRate ? <Field label="Pay rate">{payRate}</Field> : null}
        {billRate ? <Field label="Bill rate">{billRate}</Field> : null}
        {bonus ? <Field label="Bonus">{bonus}</Field> : null}
        <Field label="Start">
          {offer.startDate ? formatDate(offer.startDate, 'DD MMM YYYY') : '—'}
        </Field>
        <Field label="Expires">
          {offer.expiresAt ? formatDate(offer.expiresAt, 'DD MMM YYYY') : '—'}
        </Field>
        {offer.sentAt ? (
          <Field label="Sent">{formatDate(offer.sentAt, 'DD MMM YYYY')}</Field>
        ) : null}
        {offer.respondedAt ? (
          <Field label="Responded">{formatDate(offer.respondedAt, 'DD MMM YYYY')}</Field>
        ) : null}
      </dl>

      {offer.equityNote ? (
        <p className="mt-3 text-xs text-muted-foreground">Equity: {offer.equityNote}</p>
      ) : null}

      {offer.declineReason ? (
        <p className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
          Declined: {offer.declineReason}
        </p>
      ) : null}

      {offer.notes ? (
        <p className="mt-3 whitespace-pre-line text-xs text-muted-foreground">{offer.notes}</p>
      ) : null}

      {offer.placement ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <BadgeCheck className="size-3.5 text-success" aria-hidden="true" />
          Placement {offer.placement.status.toLowerCase()}
          {offer.placement.startDate
            ? ` · starts ${formatDate(offer.placement.startDate, 'DD MMM YYYY')}`
            : ''}
        </p>
      ) : null}
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
