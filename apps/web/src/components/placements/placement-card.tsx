'use client';

import { EyeOff, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  PLACEMENT_STATUS_LABELS,
  RATE_TYPE_LABELS,
  rateTypeSchema,
  type PlacementListItem,
  type PlacementStatus,
  type RateType,
} from '@talentflow/types';
import { formatCurrency, formatDate } from '@talentflow/ui';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

const STATUS_VARIANT: Record<PlacementStatus, BadgeProps['variant']> = {
  PENDING: 'muted',
  ACTIVE: 'success',
  COMPLETED: 'info',
  TERMINATED: 'destructive',
};

function money(cents: number | null, currency: string): string | null {
  return cents === null
    ? null
    : formatCurrency({ amount: cents / 100, currency, maximumFractionDigits: 2 });
}

/** A rate reads as "USD 100.00 per hour"; the period comes from the shared enum. */
function rate(cents: number | null, currency: string, period: string): string | null {
  const amount = money(cents, currency);
  if (amount === null) return null;
  const parsed = rateTypeSchema.safeParse(period);
  return parsed.success ? `${amount} ${RATE_TYPE_LABELS[parsed.data as RateType]}` : amount;
}

interface PlacementCardProps {
  placement: PlacementListItem;
  /** Whether the caller holds `placement:view_margin`; controls the hint copy. */
  canViewMargin: boolean;
}

/**
 * One placement's commercial terms. The margin block is rendered from
 * `placement.margin`, which the API leaves `null` for callers without the
 * permission — so the figures are never merely hidden in the UI.
 */
export function PlacementCard({ placement, canViewMargin }: PlacementCardProps) {
  const payRate = rate(placement.payRateCents, placement.currency, placement.ratePeriod);
  const billRate = rate(placement.billRateCents, placement.currency, placement.ratePeriod);
  const fee = money(placement.feeCents, placement.currency);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate">
            {placement.job?.title ?? 'Placement'}
          </CardTitle>
          <p className="truncate text-xs text-muted-foreground">
            {placement.client ? placement.client.name : 'No client linked'}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[placement.status]}>
          {PLACEMENT_STATUS_LABELS[placement.status]}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Candidate">{placement.candidate.fullName}</Field>
          <Field label="Recruiter">
            {placement.recruiter ? placement.recruiter.fullName : 'Unassigned'}
          </Field>
          <Field label="Start">
            {placement.startDate
              ? formatDate(placement.startDate, 'DD MMM YYYY')
              : 'Not started'}
          </Field>
          <Field label="End">
            {placement.endDate ? formatDate(placement.endDate, 'DD MMM YYYY') : 'Open-ended'}
          </Field>
          <Field label="Pay rate">{payRate ?? '—'}</Field>
          <Field label="Bill rate">{billRate ?? '—'}</Field>
          <Field label="Fee">
            {fee ?? (placement.feePercentage !== null ? `${placement.feePercentage}%` : '—')}
          </Field>
          <Field label="Guarantee">
            {placement.guaranteeDays !== null ? `${placement.guaranteeDays} days` : '—'}
          </Field>
          {placement.invoiceRef ? (
            <Field label="Invoice ref">
              <span className="font-mono text-xs">{placement.invoiceRef}</span>
            </Field>
          ) : null}
        </dl>

        <Separator />

        {placement.margin ? (
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <TrendingUp className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">Margin</p>
              <p className="text-sm font-medium">
                {money(placement.margin.marginCents, placement.currency) ?? '—'}
                {placement.margin.marginPercentage !== null
                  ? ` · ${placement.margin.marginPercentage}%`
                  : ''}
              </p>
            </div>
          </div>
        ) : canViewMargin ? (
          <p className="text-xs text-muted-foreground">
            Add both a pay and a bill rate to see the margin.
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <EyeOff className="size-3.5" aria-hidden="true" />
            Margin requires the “View placement margin” permission.
          </p>
        )}

        {placement.notes ? (
          <p className="whitespace-pre-line text-xs text-muted-foreground">{placement.notes}</p>
        ) : null}
      </CardContent>
    </Card>
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
