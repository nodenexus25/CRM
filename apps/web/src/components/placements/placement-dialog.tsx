'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  PLACEMENT_STATUS_LABELS,
  RATE_TYPE_LABELS,
  currencySchema,
  placementStatusSchema,
  rateTypeSchema,
  type Paginated,
  type PlacementListItem,
  type UpdatePlacementRequest,
  type UserListItem,
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

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'SGD', 'AED', 'ZAR', 'NZD'] as const;

/** Radix `Select` needs a concrete value for "no recruiter". */
const NO_RECRUITER = '__none__';

const placementFormSchema = z.object({
  status: placementStatusSchema,
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  payRate: z.string().trim().optional(),
  billRate: z.string().trim().optional(),
  ratePeriod: rateTypeSchema,
  currency: currencySchema,
  fee: z.string().trim().optional(),
  feePercentage: z.string().trim().optional(),
  guaranteeDays: z.string().trim().optional(),
  recruiterId: z.string().trim().optional(),
  invoiceRef: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(4000).optional(),
});

type PlacementFormValues = z.infer<typeof placementFormSchema>;

const EMPTY_VALUES: PlacementFormValues = {
  status: 'PENDING',
  startDate: '',
  endDate: '',
  payRate: '',
  billRate: '',
  ratePeriod: 'ANNUAL',
  currency: 'USD',
  fee: '',
  feePercentage: '',
  guaranteeDays: '',
  recruiterId: NO_RECRUITER,
  invoiceRef: '',
  notes: '',
};

function toCents(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function toNumber(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toMajorString(cents: number | null): string {
  return cents === null ? '' : String(cents / 100);
}

function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

function defaultsFromPlacement(placement: PlacementListItem): PlacementFormValues {
  return {
    status: placement.status,
    startDate: toDateInput(placement.startDate),
    endDate: toDateInput(placement.endDate),
    payRate: toMajorString(placement.payRateCents),
    billRate: toMajorString(placement.billRateCents),
    ratePeriod: rateTypeSchema.safeParse(placement.ratePeriod).success
      ? (placement.ratePeriod as PlacementFormValues['ratePeriod'])
      : 'ANNUAL',
    currency: placement.currency,
    fee: toMajorString(placement.feeCents),
    feePercentage: placement.feePercentage === null ? '' : String(placement.feePercentage),
    guaranteeDays: placement.guaranteeDays === null ? '' : String(placement.guaranteeDays),
    recruiterId: placement.recruiter?.id ?? NO_RECRUITER,
    invoiceRef: placement.invoiceRef ?? '',
    notes: placement.notes ?? '',
  };
}

interface PlacementDialogProps {
  placement: PlacementListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Edit a placement's terms or lifecycle; the API recomputes the margin. */
export function PlacementDialog({ placement, open, onOpenChange }: PlacementDialogProps) {
  const queryClient = useQueryClient();

  const form = useForm<PlacementFormValues>({
    resolver: zodResolver(placementFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  const recruiters = useQuery({
    queryKey: queryKeys.users.list({ pageSize: 100, status: 'ACTIVE' }),
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/users', { query: { pageSize: 100, status: 'ACTIVE' } }),
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open || !placement) return;
    form.reset(defaultsFromPlacement(placement));
  }, [open, placement, form]);

  const save = useMutation({
    mutationFn: (values: PlacementFormValues) => {
      if (!placement) throw new Error('No placement selected');
      return api.patch<PlacementListItem>(`/placements/${placement.id}`, {
        status: values.status,
        startDate: values.startDate ? new Date(values.startDate) : null,
        endDate: values.endDate ? new Date(values.endDate) : null,
        payRateCents: toCents(values.payRate),
        billRateCents: toCents(values.billRate),
        ratePeriod: values.ratePeriod,
        currency: values.currency,
        feeCents: toCents(values.fee),
        feePercentage: toNumber(values.feePercentage),
        guaranteeDays: toNumber(values.guaranteeDays),
        recruiterId: !values.recruiterId || values.recruiterId === NO_RECRUITER ? null : values.recruiterId,
        invoiceRef: values.invoiceRef || null,
        notes: values.notes || null,
      } satisfies UpdatePlacementRequest);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.placements.all });
      toast.success('Placement updated');
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;
  const currencyOptions = [...new Set([...CURRENCIES, form.watch('currency')])];
  const selectedRecruiter = form.watch('recruiterId');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit placement</DialogTitle>
          <DialogDescription>
            {placement
              ? `${placement.candidate.fullName} · ${placement.job?.title ?? 'Placement'}`
              : 'Placement terms'}
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          className="space-y-4"
        >
          {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="placement-status">Status</Label>
              <Select
                value={form.watch('status')}
                onValueChange={(value) =>
                  form.setValue('status', value as PlacementFormValues['status'], {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger id="placement-status" aria-label="Placement status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {placementStatusSchema.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {PLACEMENT_STATUS_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="placement-start">Start date</Label>
              <Input id="placement-start" type="date" {...form.register('startDate')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="placement-end">End date</Label>
              <Input id="placement-end" type="date" {...form.register('endDate')} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="placement-pay">Pay rate</Label>
              <Input
                id="placement-pay"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                {...form.register('payRate')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="placement-bill">Bill rate</Label>
              <Input
                id="placement-bill"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                {...form.register('billRate')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="placement-period">Rate period</Label>
              <Select
                value={form.watch('ratePeriod')}
                onValueChange={(value) =>
                  form.setValue('ratePeriod', value as PlacementFormValues['ratePeriod'], {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger id="placement-period" aria-label="Rate period">
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
            <div className="space-y-1.5">
              <Label htmlFor="placement-currency">Currency</Label>
              <Select
                value={form.watch('currency')}
                onValueChange={(value) => form.setValue('currency', value, { shouldDirty: true })}
              >
                <SelectTrigger id="placement-currency" aria-label="Currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencyOptions.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="placement-fee">Fee</Label>
              <Input
                id="placement-fee"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                {...form.register('fee')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="placement-fee-pct">Fee %</Label>
              <Input
                id="placement-fee-pct"
                type="number"
                min={0}
                max={100}
                step="0.01"
                inputMode="decimal"
                {...form.register('feePercentage')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="placement-guarantee">Guarantee (days)</Label>
              <Input
                id="placement-guarantee"
                type="number"
                min={0}
                max={730}
                inputMode="numeric"
                {...form.register('guaranteeDays')}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="placement-recruiter">Recruiter</Label>
              <Select
                value={selectedRecruiter}
                onValueChange={(value) =>
                  form.setValue('recruiterId', value, { shouldDirty: true })
                }
              >
                <SelectTrigger id="placement-recruiter" aria-label="Recruiter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RECRUITER}>Unassigned</SelectItem>
                  {(recruiters.data?.items ?? []).map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="placement-invoice">Invoice ref</Label>
              <Input id="placement-invoice" {...form.register('invoiceRef')} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="placement-notes">Notes (optional)</Label>
            <Textarea id="placement-notes" rows={3} {...form.register('notes')} />
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
              Save placement
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
