'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  RATE_TYPE_LABELS,
  currencySchema,
  rateTypeSchema,
  type CreateOfferRequest,
  type OfferListItem,
  type UpdateOfferRequest,
} from '@talentflow/types';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';

/** Common ISO-4217 codes; the API accepts any 3-letter code. */
const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'SGD', 'AED', 'ZAR', 'NZD'] as const;

/**
 * The form holds money as a major-unit string and dates as `YYYY-MM-DD` so the
 * inputs behave natively; the payload converts both into what the API expects.
 */
const offerFormSchema = z.object({
  title: z.string().trim().max(200).optional(),
  salary: z.string().trim().optional(),
  payRate: z.string().trim().optional(),
  billRate: z.string().trim().optional(),
  ratePeriod: rateTypeSchema,
  currency: currencySchema,
  bonus: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  expiresAt: z.string().trim().optional(),
  notes: z.string().trim().max(4000).optional(),
});

type OfferFormValues = z.infer<typeof offerFormSchema>;

/** Major units → integer cents; blank/invalid → null (the API also allows null). */
function toCents(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

/** Cents → major-unit string for the edit form. */
function toMajorString(cents: number | null): string {
  return cents === null ? '' : String(cents / 100);
}

/** ISO-8601 → `YYYY-MM-DD` for a native date input. */
function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

const EMPTY_VALUES: OfferFormValues = {
  title: '',
  salary: '',
  payRate: '',
  billRate: '',
  ratePeriod: 'ANNUAL',
  currency: 'USD',
  bonus: '',
  startDate: '',
  expiresAt: '',
  notes: '',
};

function defaultsFromOffer(offer: OfferListItem): OfferFormValues {
  return {
    title: offer.title ?? '',
    salary: toMajorString(offer.salaryCents),
    payRate: toMajorString(offer.payRateCents),
    billRate: toMajorString(offer.billRateCents),
    ratePeriod: rateTypeSchema.safeParse(offer.ratePeriod).success
      ? (offer.ratePeriod as OfferFormValues['ratePeriod'])
      : 'ANNUAL',
    currency: offer.currency,
    bonus: toMajorString(offer.bonusCents),
    startDate: toDateInput(offer.startDate),
    expiresAt: toDateInput(offer.expiresAt),
    notes: offer.notes ?? '',
  };
}

interface OfferDialogProps {
  applicationId: string;
  /** The offer being edited; omit (or pass `null`) to raise a new one. */
  offer?: OfferListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Raise an offer for an application, or edit the terms of an existing one. */
export function OfferDialog({ applicationId, offer, open, onOpenChange }: OfferDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = offer !== null && offer !== undefined;

  const form = useForm<OfferFormValues>({
    resolver: zodResolver(offerFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(offer ? defaultsFromOffer(offer) : EMPTY_VALUES);
  }, [open, offer, form]);

  const save = useMutation({
    mutationFn: (values: OfferFormValues) => {
      const terms = {
        title: values.title || null,
        salaryCents: toCents(values.salary),
        payRateCents: toCents(values.payRate),
        billRateCents: toCents(values.billRate),
        ratePeriod: values.ratePeriod,
        currency: values.currency,
        bonusCents: toCents(values.bonus),
        startDate: values.startDate ? new Date(values.startDate) : null,
        expiresAt: values.expiresAt ? new Date(values.expiresAt) : null,
        notes: values.notes || null,
      };

      if (isEdit && offer) {
        return api.patch<OfferListItem>(`/offers/${offer.id}`, terms satisfies UpdateOfferRequest);
      }
      return api.post<OfferListItem>('/offers', {
        ...terms,
        applicationId,
      } satisfies CreateOfferRequest);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.offers.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all });
      toast.success(isEdit ? 'Offer updated' : 'Offer raised');
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit offer' : 'Raise an offer'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Change the terms. Status moves are made from the offer card.'
              : 'Only the terms the deal needs — a salary, or a pay/bill rate pair.'}
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          className="space-y-4"
        >
          {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

          <div className="space-y-1.5">
            <Label htmlFor="offer-title">Title (optional)</Label>
            <Input
              id="offer-title"
              placeholder="Senior Platform Engineer — offer"
              {...form.register('title')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="offer-salary">Annual salary</Label>
              <Input
                id="offer-salary"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="140000"
                {...form.register('salary')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-bonus">Bonus (optional)</Label>
              <Input
                id="offer-bonus"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="10000"
                {...form.register('bonus')}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="offer-pay-rate">Pay rate</Label>
              <Input
                id="offer-pay-rate"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="80"
                {...form.register('payRate')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-bill-rate">Bill rate</Label>
              <Input
                id="offer-bill-rate"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="100"
                {...form.register('billRate')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-rate-period">Rate period</Label>
              <Select
                value={form.watch('ratePeriod')}
                onValueChange={(value) =>
                  form.setValue('ratePeriod', value as OfferFormValues['ratePeriod'], {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger id="offer-rate-period" aria-label="Rate period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {rateTypeSchema.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {RATE_TYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="offer-currency">Currency</Label>
              <Select
                value={form.watch('currency')}
                onValueChange={(value) =>
                  form.setValue('currency', value, { shouldDirty: true })
                }
              >
                <SelectTrigger id="offer-currency" aria-label="Currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...CURRENCIES, form.watch('currency')])].map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-start">Start date</Label>
              <Input id="offer-start" type="date" {...form.register('startDate')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-expires">Expires</Label>
              <Input id="offer-expires" type="date" {...form.register('expiresAt')} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="offer-notes">Notes (optional)</Label>
            <Textarea id="offer-notes" rows={3} {...form.register('notes')} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {isEdit ? 'Save offer' : 'Raise offer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
