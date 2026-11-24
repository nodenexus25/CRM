'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Save, ShieldOff } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import type { TenantDetail } from '@talentflow/types';
import { cn } from '@talentflow/ui';

import { PageHeader } from '@/components/shell/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`);

/** Mirrors `updateTenantSchema`; the API remains the authority on every field. */
const workspaceFormSchema = z.object({
  name: z.string().trim().min(2, 'Enter a workspace name').max(120),
  logoUrl: z.union([z.literal(''), z.string().trim().url('Enter a valid image URL').max(2048)]),
  brandColor: z.string().trim().regex(HEX_COLOR, 'Use a hex colour such as #4F46E5'),
  primaryDomain: z.string().trim().max(253),
  settings: z.object({
    legalName: optionalText(160, 'Legal name'),
    website: z.union([z.literal(''), z.string().trim().url('Enter a valid website').max(2048)]),
    phone: optionalText(32, 'Phone'),
    addressLine1: optionalText(160, 'Address'),
    addressLine2: optionalText(160, 'Address line 2'),
    city: optionalText(80, 'City'),
    state: optionalText(80, 'State'),
    postalCode: optionalText(20, 'Postal code'),
    country: optionalText(64, 'Country'),
    taxId: optionalText(40, 'Tax ID'),
    currency: z.string().trim().length(3, 'Use a 3-letter ISO code').toUpperCase(),
    timezone: z.string().trim().min(1, 'Pick a timezone').max(64),
    dateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY']),
    weekStartsOn: z.coerce.number().int().min(0).max(1),
    showLogoOnSubmissions: z.boolean(),
    hideCandidateContactOnSubmission: z.boolean(),
    emailSignature: optionalText(2000, 'Email signature'),
  }),
});

type WorkspaceFormValues = z.infer<typeof workspaceFormSchema>;

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'SGD', 'AED', 'ZAR', 'NZD'] as const;

const TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY'] as const;

export default function WorkspaceSettingsPage() {
  const { has, tenant } = useSession();
  const queryClient = useQueryClient();

  const canRead = has('tenant:read');
  const canUpdate = has('tenant:update');

  const workspace = useQuery({
    queryKey: queryKeys.workspace.detail,
    queryFn: () => api.get<TenantDetail>('/workspace'),
    enabled: canRead,
    staleTime: 60_000,
  });

  const form = useForm<WorkspaceFormValues>({
    resolver: zodResolver(workspaceFormSchema),
    defaultValues: {
      name: '',
      logoUrl: '',
      brandColor: '#4F46E5',
      primaryDomain: '',
      settings: {
        legalName: '',
        website: '',
        phone: '',
        addressLine1: '',
        addressLine2: '',
        city: '',
        state: '',
        postalCode: '',
        country: '',
        taxId: '',
        currency: 'USD',
        timezone: 'UTC',
        dateFormat: 'MM/DD/YYYY',
        weekStartsOn: 1,
        showLogoOnSubmissions: true,
        hideCandidateContactOnSubmission: true,
        emailSignature: '',
      },
    },
  });

  // Hydrate the form once the workspace payload lands.
  useEffect(() => {
    const detail = workspace.data;
    if (!detail) return;
    const settings = detail.settings;
    form.reset({
      name: detail.name,
      logoUrl: detail.logoUrl ?? '',
      brandColor: detail.brandColor,
      primaryDomain: detail.primaryDomain ?? '',
      settings: {
        legalName: settings.legalName ?? '',
        website: settings.website ?? '',
        phone: settings.phone ?? '',
        addressLine1: settings.addressLine1 ?? '',
        addressLine2: settings.addressLine2 ?? '',
        city: settings.city ?? '',
        state: settings.state ?? '',
        postalCode: settings.postalCode ?? '',
        country: settings.country ?? '',
        taxId: settings.taxId ?? '',
        currency: settings.currency ?? detail.currency,
        timezone: settings.timezone ?? detail.timezone,
        dateFormat: settings.dateFormat ?? 'MM/DD/YYYY',
        weekStartsOn: settings.weekStartsOn ?? 1,
        showLogoOnSubmissions: settings.showLogoOnSubmissions ?? true,
        hideCandidateContactOnSubmission: settings.hideCandidateContactOnSubmission ?? true,
        emailSignature: settings.emailSignature ?? '',
      },
    });
  }, [form, workspace.data]);

  const save = useMutation({
    mutationFn: (values: WorkspaceFormValues) =>
      api.patch<TenantDetail>('/workspace', {
        name: values.name,
        logoUrl: values.logoUrl || null,
        brandColor: values.brandColor,
        primaryDomain: values.primaryDomain || null,
        settings: {
          ...values.settings,
          legalName: values.settings.legalName || undefined,
          website: values.settings.website || undefined,
          phone: values.settings.phone || undefined,
          addressLine1: values.settings.addressLine1 || undefined,
          addressLine2: values.settings.addressLine2 || undefined,
          city: values.settings.city || undefined,
          state: values.settings.state || undefined,
          postalCode: values.settings.postalCode || undefined,
          country: values.settings.country || undefined,
          taxId: values.settings.taxId || undefined,
          emailSignature: values.settings.emailSignature || undefined,
        },
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.workspace.detail, detail);
      void queryClient.invalidateQueries({ queryKey: queryKeys.session });
      toast.success('Workspace settings saved');
      form.reset(form.getValues());
    },
    onError: (error) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader title="Workspace" description="Branding, locale and submission defaults." />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to workspace settings"
          description="Ask a workspace administrator for the “View workspace” permission."
        />
      </div>
    );
  }

  const rootError = form.formState.errors.root?.message;
  const submitting = save.isPending;
  const logoUrl = form.watch('logoUrl');
  const brandColor = form.watch('brandColor');
  const showLogo = form.watch('settings.showLogoOnSubmissions');
  const maskContact = form.watch('settings.hideCandidateContactOnSubmission');
  const timezone = form.watch('settings.timezone');
  const currency = form.watch('settings.currency');

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        title="Workspace"
        description={`Branding, locale and default behaviour for ${workspace.data?.name ?? tenant?.name ?? 'this workspace'}.`}
        actions={
          <>
            {workspace.data ? (
              <Badge variant="secondary" className="capitalize">
                {workspace.data.status.toLowerCase().replace('_', ' ')}
              </Badge>
            ) : null}
            <Button
              type="submit"
              form="workspace-settings"
              size="sm"
              loading={submitting}
              disabled={!canUpdate || !form.formState.isDirty}
            >
              <Save className="size-4" aria-hidden="true" />
              Save changes
            </Button>
          </>
        }
      />

      {workspace.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : workspace.isError ? (
        <EmptyState
          title="Could not load the workspace"
          description={
            workspace.error instanceof Error ? workspace.error.message : 'Please try again in a moment.'
          }
          action={
            <Button variant="outline" size="sm" onClick={() => void workspace.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <form
          id="workspace-settings"
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          <fieldset disabled={submitting || !canUpdate} className="space-y-6">
            {rootError ? (
              <Alert variant="destructive">
                <AlertDescription>{rootError}</AlertDescription>
              </Alert>
            ) : null}

            {!canUpdate ? (
              <Alert>
                <AlertDescription>
                  You have read-only access to these settings. An administrator can make changes.
                </AlertDescription>
              </Alert>
            ) : null}

            <Tabs defaultValue="brand">
              <TabsList>
                <TabsTrigger value="brand">Brand</TabsTrigger>
                <TabsTrigger value="locale">Locale</TabsTrigger>
                <TabsTrigger value="company">Company</TabsTrigger>
                <TabsTrigger value="submissions">Submissions</TabsTrigger>
              </TabsList>

              <TabsContent value="brand" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Identity</CardTitle>
                    <CardDescription>
                      Shown in the sidebar, on candidate submissions and in notification emails.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Field label="Workspace name" htmlFor="ws-name" error={form.formState.errors.name?.message}>
                      <Input id="ws-name" {...form.register('name')} />
                    </Field>

                    <Field
                      label="Logo URL"
                      htmlFor="ws-logo"
                      optional
                      error={form.formState.errors.logoUrl?.message}
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                          {logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={logoUrl} alt="" className="size-full object-contain" />
                          ) : (
                            <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
                          )}
                        </span>
                        <Input
                          id="ws-logo"
                          placeholder="https://cdn.example.com/logo.svg"
                          {...form.register('logoUrl')}
                        />
                      </div>
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Brand colour"
                        htmlFor="ws-brand"
                        error={form.formState.errors.brandColor?.message}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            className="size-9 shrink-0 rounded-md border border-border"
                            style={{ backgroundColor: brandColor }}
                          />
                          <Input id="ws-brand" className="font-mono" {...form.register('brandColor')} />
                        </div>
                      </Field>

                      <Field
                        label="Primary domain"
                        htmlFor="ws-domain"
                        optional
                        error={form.formState.errors.primaryDomain?.message}
                      >
                        <Input id="ws-domain" placeholder="talent.example.com" {...form.register('primaryDomain')} />
                      </Field>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="locale" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Locale</CardTitle>
                    <CardDescription>
                      Applied to every date, rate and timestamp in the workspace.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="ws-timezone">Timezone</Label>
                      <Input id="ws-timezone" list="ws-timezone-options" {...form.register('settings.timezone')} />
                      <datalist id="ws-timezone-options">
                        {TIMEZONES.map((zone) => (
                          <option key={zone} value={zone} />
                        ))}
                      </datalist>
                      <p className="text-2xs text-muted-foreground">
                        IANA name, e.g. <code className="font-mono">{timezone || 'Asia/Kolkata'}</code>
                      </p>
                      {form.formState.errors.settings?.timezone ? (
                        <p className="text-xs text-destructive">
                          {form.formState.errors.settings.timezone.message}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="ws-currency">Default currency</Label>
                      <Select
                        value={currency}
                        onValueChange={(value) =>
                          form.setValue('settings.currency', value, { shouldDirty: true })
                        }
                      >
                        <SelectTrigger id="ws-currency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[...new Set([...CURRENCIES, currency])].map((code) => (
                            <SelectItem key={code} value={code}>
                              {code}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="ws-date-format">Date format</Label>
                      <Select
                        value={form.watch('settings.dateFormat')}
                        onValueChange={(value) =>
                          form.setValue('settings.dateFormat', value as (typeof DATE_FORMATS)[number], {
                            shouldDirty: true,
                          })
                        }
                      >
                        <SelectTrigger id="ws-date-format">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DATE_FORMATS.map((pattern) => (
                            <SelectItem key={pattern} value={pattern}>
                              {pattern}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="ws-week-start">Week starts on</Label>
                      <Select
                        value={String(form.watch('settings.weekStartsOn'))}
                        onValueChange={(value) =>
                          form.setValue('settings.weekStartsOn', Number(value), { shouldDirty: true })
                        }
                      >
                        <SelectTrigger id="ws-week-start">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Monday</SelectItem>
                          <SelectItem value="0">Sunday</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="company" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Company details</CardTitle>
                    <CardDescription>
                      Used on submissions, invoices and contracts you send outside the workspace.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Legal name" htmlFor="ws-legal" optional>
                        <Input id="ws-legal" {...form.register('settings.legalName')} />
                      </Field>
                      <Field
                        label="Website"
                        htmlFor="ws-website"
                        optional
                        error={form.formState.errors.settings?.website?.message}
                      >
                        <Input
                          id="ws-website"
                          placeholder="https://example.com"
                          {...form.register('settings.website')}
                        />
                      </Field>
                      <Field label="Phone" htmlFor="ws-phone" optional>
                        <Input id="ws-phone" {...form.register('settings.phone')} />
                      </Field>
                      <Field label="Tax ID / GSTIN" htmlFor="ws-tax" optional>
                        <Input id="ws-tax" {...form.register('settings.taxId')} />
                      </Field>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Address line 1" htmlFor="ws-addr1" optional>
                        <Input id="ws-addr1" {...form.register('settings.addressLine1')} />
                      </Field>
                      <Field label="Address line 2" htmlFor="ws-addr2" optional>
                        <Input id="ws-addr2" {...form.register('settings.addressLine2')} />
                      </Field>
                      <Field label="City" htmlFor="ws-city" optional>
                        <Input id="ws-city" {...form.register('settings.city')} />
                      </Field>
                      <Field label="State / region" htmlFor="ws-state" optional>
                        <Input id="ws-state" {...form.register('settings.state')} />
                      </Field>
                      <Field label="Postal code" htmlFor="ws-postal" optional>
                        <Input id="ws-postal" {...form.register('settings.postalCode')} />
                      </Field>
                      <Field label="Country" htmlFor="ws-country" optional>
                        <Input id="ws-country" {...form.register('settings.country')} />
                      </Field>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="submissions" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Submission defaults</CardTitle>
                    <CardDescription>
                      Applied whenever a candidate is sent to a client from this workspace.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ToggleRow
                      id="ws-show-logo"
                      label="Show the workspace logo on submissions"
                      description="Adds your logo to the header of every client-facing document."
                      checked={showLogo}
                      onChange={(checked) =>
                        form.setValue('settings.showLogoOnSubmissions', checked, { shouldDirty: true })
                      }
                    />
                    <ToggleRow
                      id="ws-mask-contact"
                      label="Hide candidate contact details on submissions"
                      description="Recruiters see the full profile; clients see the masked version until they shortlist."
                      checked={maskContact}
                      onChange={(checked) =>
                        form.setValue('settings.hideCandidateContactOnSubmission', checked, {
                          shouldDirty: true,
                        })
                      }
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Email signature</CardTitle>
                    <CardDescription>
                      Appended to mail sent from the workspace — submissions, interview invites and
                      rejections.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      rows={5}
                      aria-label="Email signature"
                      placeholder={'Kind regards,\nThe TalentFlow team'}
                      {...form.register('settings.emailSignature')}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </fieldset>
        </form>
      )}
    </div>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}

function Field({ label, htmlFor, error, optional, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {optional ? <span className="text-2xs text-muted-foreground">Optional</span> : null}
      </div>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

interface ToggleRowProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ id, label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 rounded-md border border-border p-3',
        'transition-colors hover:bg-accent/40',
      )}
    >
      <div className="space-y-0.5">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
