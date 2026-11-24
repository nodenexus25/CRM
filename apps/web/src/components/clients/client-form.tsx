'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  CLIENT_STATUS_LABELS,
  clientStatusSchema,
  createClientSchema,
  currencySchema,
  emailSchema,
  phoneSchema,
  urlSchema,
  type ClientDetail,
} from '@talentflow/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

/**
 * The create form cannot use `createClientSchema` verbatim: it collects money in
 * major units and converts to cents on submit, and holds numeric inputs as
 * strings. Constraints are reused from the API schema field by field so the
 * client and server rules stay in step.
 */
const clientFormSchema = z.object({
  name: createClientSchema.shape.name,
  legalName: z.string().trim().max(200),
  status: clientStatusSchema,
  industry: z.string().trim().max(120),
  website: z.union([urlSchema, z.literal('')]),
  email: z.union([emailSchema, z.literal('')]),
  phone: z.union([phoneSchema, z.literal('')]),
  currency: z.union([currencySchema, z.literal('')]),
  defaultBillRate: z.string().trim(),
  defaultFeePercentage: z.string().trim(),
  paymentTermsDays: z.string().trim(),
  addressLine1: z.string().trim().max(200),
  addressLine2: z.string().trim().max(200),
  city: z.string().trim().max(120),
  state: z.string().trim().max(120),
  postalCode: z.string().trim().max(32),
  country: z.string().trim().max(120),
  description: z.string().trim().max(4000),
});

type ClientFormValues = z.infer<typeof clientFormSchema>;

const EMPTY_VALUES: ClientFormValues = {
  name: '',
  legalName: '',
  status: 'PROSPECT',
  industry: '',
  website: '',
  email: '',
  phone: '',
  currency: 'USD',
  defaultBillRate: '',
  defaultFeePercentage: '',
  paymentTermsDays: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  description: '',
};

/** Major units → integer cents; blank/invalid → null (the API also allows null). */
function toCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function toInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Cents → major-unit string for the edit form. */
function toMajorString(cents: number | null): string {
  return cents === null ? '' : String(cents / 100);
}

function toNumberString(value: number | null): string {
  return value === null ? '' : String(value);
}

function defaultsFromClient(client: ClientDetail): ClientFormValues {
  return {
    name: client.name,
    legalName: client.legalName ?? '',
    status: client.status,
    industry: client.industry ?? '',
    website: client.website ?? '',
    email: client.email ?? '',
    phone: client.phone ?? '',
    currency: client.currency ?? '',
    defaultBillRate: toMajorString(client.defaultBillRateCents),
    defaultFeePercentage: toNumberString(client.defaultFeePercentage),
    paymentTermsDays: client.paymentTermsDays === null ? '' : String(client.paymentTermsDays),
    addressLine1: client.addressLine1 ?? '',
    addressLine2: client.addressLine2 ?? '',
    city: client.city ?? '',
    state: client.state ?? '',
    postalCode: client.postalCode ?? '',
    country: client.country ?? '',
    description: client.description ?? '',
  };
}

interface ClientFormProps {
  mode?: 'create' | 'edit';
  client?: ClientDetail;
  onSuccess?: (client: ClientDetail) => void;
  onCancel?: () => void;
}

export function ClientForm({ mode = 'create', client, onSuccess, onCancel }: ClientFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    form.reset(mode === 'edit' && client ? defaultsFromClient(client) : EMPTY_VALUES);
  }, [form, mode, client]);

  const save = useMutation({
    mutationFn: (values: ClientFormValues) => {
      const shared = {
        name: values.name,
        legalName: values.legalName || null,
        status: values.status,
        industry: values.industry || null,
        website: values.website || null,
        email: values.email || null,
        phone: values.phone || null,
        currency: values.currency || null,
        defaultBillRateCents: toCents(values.defaultBillRate),
        defaultFeePercentage: toNumber(values.defaultFeePercentage),
        paymentTermsDays: toInt(values.paymentTermsDays),
        addressLine1: values.addressLine1 || null,
        addressLine2: values.addressLine2 || null,
        city: values.city || null,
        state: values.state || null,
        postalCode: values.postalCode || null,
        country: values.country || null,
        description: values.description || null,
      };

      if (mode === 'edit' && client) {
        return api.patch<ClientDetail>(`/clients/${client.id}`, shared);
      }
      return api.post<ClientDetail>('/clients', shared);
    },
    onSuccess: (savedClient) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
      toast.success(mode === 'edit' ? `${savedClient.name} updated` : `${savedClient.name} created`);
      if (onSuccess) onSuccess(savedClient);
      else router.push(`/clients/${savedClient.id}`);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;
  const submitting = save.isPending;

  function handleCancel() {
    if (onCancel) onCancel();
    else router.push('/clients');
  }

  return (
    <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-5">
      <fieldset disabled={submitting} className="space-y-5">
        {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

        <Card>
          <CardHeader>
            <CardTitle>Company</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="client-name">Client name</Label>
              <Input id="client-name" placeholder="Northwind Trading" {...form.register('name')} />
              {form.formState.errors.name ? (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="client-legal-name">Legal name</Label>
                <Input id="client-legal-name" {...form.register('legalName')} />
              </div>
              <SelectField
                id="client-status"
                label="Status"
                value={form.watch('status')}
                options={clientStatusSchema.options.map((option) => ({
                  value: option,
                  label: CLIENT_STATUS_LABELS[option],
                }))}
                onChange={(value) =>
                  form.setValue('status', value as ClientFormValues['status'], { shouldDirty: true })
                }
              />
              <div className="space-y-1.5">
                <Label htmlFor="client-industry">Industry</Label>
                <Input id="client-industry" placeholder="Financial services" {...form.register('industry')} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="client-website">Website</Label>
                <Input id="client-website" placeholder="https://example.com" {...form.register('website')} />
                {form.formState.errors.website ? (
                  <p className="text-xs text-destructive">{form.formState.errors.website.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-email">Email</Label>
                <Input id="client-email" type="email" {...form.register('email')} />
                {form.formState.errors.email ? (
                  <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-phone">Phone</Label>
                <Input id="client-phone" {...form.register('phone')} />
                {form.formState.errors.phone ? (
                  <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="client-address-1">Address line 1</Label>
              <Input id="client-address-1" {...form.register('addressLine1')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-address-2">Address line 2</Label>
              <Input id="client-address-2" {...form.register('addressLine2')} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="client-city">City</Label>
                <Input id="client-city" {...form.register('city')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-state">State / region</Label>
                <Input id="client-state" {...form.register('state')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-postal">Postal code</Label>
                <Input id="client-postal" {...form.register('postalCode')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-country">Country</Label>
                <Input id="client-country" {...form.register('country')} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commercial terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="client-currency">Currency</Label>
                <Input id="client-currency" maxLength={3} className="uppercase" {...form.register('currency')} />
                {form.formState.errors.currency ? (
                  <p className="text-xs text-destructive">{form.formState.errors.currency.message}</p>
                ) : (
                  <p className="text-2xs text-muted-foreground">3-letter ISO code, e.g. USD</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-bill-rate">Default bill rate</Label>
                <Input
                  id="client-bill-rate"
                  type="number"
                  min={0}
                  step="0.01"
                  {...form.register('defaultBillRate')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-fee">Default fee %</Label>
                <Input
                  id="client-fee"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  {...form.register('defaultFeePercentage')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-terms">Payment terms (days)</Label>
                <Input
                  id="client-terms"
                  type="number"
                  min={0}
                  max={365}
                  {...form.register('paymentTermsDays')}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <Label htmlFor="client-description">Description</Label>
              <Textarea
                id="client-description"
                rows={4}
                placeholder="Background, key stakeholders, billing arrangements…"
                {...form.register('description')}
              />
            </div>
          </CardContent>
        </Card>
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {mode === 'edit' ? 'Save changes' : 'Create client'}
        </Button>
      </div>
    </form>
  );
}

interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
}

function SelectField({ id, label, value, options, onChange, placeholder }: SelectFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value === '' ? undefined : value} onValueChange={onChange}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
