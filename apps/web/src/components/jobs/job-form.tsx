'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  createJobSchema,
  jobStatusSchema,
  jobTypeSchema,
  prioritySchema,
  rateTypeSchema,
  remoteTypeSchema,
  workAuthorizationSchema,
  JOB_TYPE_LABELS,
  PRIORITY_LABELS,
  RATE_TYPE_LABELS,
  REMOTE_TYPE_LABELS,
  WORK_AUTHORIZATION_LABELS,
  type JobDetail,
  type RateType,
} from '@talentflow/types';
import { cn } from '@talentflow/ui';

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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';

/**
 * The create form cannot use `createJobSchema` verbatim: it collects money in
 * major units and converts to cents on submit, and it holds numeric inputs as
 * strings. The constraints are reused from the API schema field by field so the
 * client and server rules stay in step.
 */
const jobFormSchema = z.object({
  title: createJobSchema.shape.title,
  status: z.enum([jobStatusSchema.enum.DRAFT, jobStatusSchema.enum.OPEN]),
  jobType: jobTypeSchema,
  remoteType: remoteTypeSchema,
  priority: prioritySchema,
  openings: z.string().trim(),
  locationCity: z.string().trim().max(120),
  locationState: z.string().trim().max(120),
  locationCountry: z.string().trim().max(120),
  currency: createJobSchema.shape.currency,
  payRateMin: z.string().trim(),
  payRateMax: z.string().trim(),
  rateType: z.union([rateTypeSchema, z.literal('')]),
  billRate: z.string().trim(),
  billRateType: z.union([rateTypeSchema, z.literal('')]),
  minExperienceYears: z.string().trim(),
  maxExperienceYears: z.string().trim(),
  educationLevel: z.string().trim().max(80),
  workAuthorizations: z.array(workAuthorizationSchema),
  visaSponsorship: z.enum(['unspecified', 'yes', 'no']),
  targetFillAt: z.string().trim(),
  description: z.string().trim().max(20000),
  requirements: z.string().trim().max(20000),
  responsibilities: z.string().trim().max(20000),
  useDefaultPipeline: z.boolean(),
});

type JobFormValues = z.infer<typeof jobFormSchema>;

const EMPTY_VALUES: JobFormValues = {
  title: '',
  status: 'DRAFT',
  jobType: 'FULL_TIME',
  remoteType: 'ONSITE',
  priority: 'MEDIUM',
  openings: '1',
  locationCity: '',
  locationState: '',
  locationCountry: '',
  currency: 'USD',
  payRateMin: '',
  payRateMax: '',
  rateType: '',
  billRate: '',
  billRateType: '',
  minExperienceYears: '',
  maxExperienceYears: '',
  educationLevel: '',
  workAuthorizations: [],
  visaSponsorship: 'unspecified',
  targetFillAt: '',
  description: '',
  requirements: '',
  responsibilities: '',
  useDefaultPipeline: true,
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

/** Cents → major-unit string for the edit form. */
function toMajorString(cents: number | null): string {
  return cents === null ? '' : String(cents / 100);
}

function toRateType(value: string | null): RateType | '' {
  const parsed = rateTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : '';
}

function defaultsFromJob(job: JobDetail): JobFormValues {
  return {
    title: job.title,
    status: job.status === 'OPEN' ? 'OPEN' : 'DRAFT',
    jobType: job.jobType,
    remoteType: job.remoteType,
    priority: job.priority,
    openings: String(job.openings),
    locationCity: job.locationCity ?? '',
    locationState: job.locationState ?? '',
    locationCountry: job.locationCountry ?? '',
    currency: job.currency,
    payRateMin: toMajorString(job.payRateMinCents),
    payRateMax: toMajorString(job.payRateMaxCents),
    rateType: toRateType(job.rateType),
    billRate: toMajorString(job.billRateCents),
    billRateType: toRateType(job.billRateType),
    minExperienceYears: job.minExperienceYears === null ? '' : String(job.minExperienceYears),
    maxExperienceYears: job.maxExperienceYears === null ? '' : String(job.maxExperienceYears),
    educationLevel: job.educationLevel ?? '',
    workAuthorizations: job.workAuthorizations,
    visaSponsorship:
      job.visaSponsorship === null ? 'unspecified' : job.visaSponsorship ? 'yes' : 'no',
    targetFillAt: job.targetFillAt ? job.targetFillAt.slice(0, 10) : '',
    description: job.description ?? '',
    requirements: job.requirements ?? '',
    responsibilities: job.responsibilities ?? '',
    useDefaultPipeline: true,
  };
}

interface JobFormProps {
  mode?: 'create' | 'edit';
  job?: JobDetail;
  onSuccess?: (job: JobDetail) => void;
  onCancel?: () => void;
}

export function JobForm({ mode = 'create', job, onSuccess, onCancel }: JobFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const form = useForm<JobFormValues>({
    resolver: zodResolver(jobFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    form.reset(mode === 'edit' && job ? defaultsFromJob(job) : EMPTY_VALUES);
  }, [form, mode, job]);

  const save = useMutation({
    mutationFn: (values: JobFormValues) => {
      const shared = {
        title: values.title,
        jobType: values.jobType,
        remoteType: values.remoteType,
        priority: values.priority,
        openings: toInt(values.openings) ?? 1,
        locationCity: values.locationCity || null,
        locationState: values.locationState || null,
        locationCountry: values.locationCountry || null,
        currency: values.currency,
        payRateMinCents: toCents(values.payRateMin),
        payRateMaxCents: toCents(values.payRateMax),
        rateType: values.rateType || null,
        billRateCents: toCents(values.billRate),
        billRateType: values.billRateType || null,
        minExperienceYears: toInt(values.minExperienceYears),
        maxExperienceYears: toInt(values.maxExperienceYears),
        educationLevel: values.educationLevel || null,
        workAuthorizations: values.workAuthorizations,
        visaSponsorship:
          values.visaSponsorship === 'unspecified' ? null : values.visaSponsorship === 'yes',
        targetFillAt: values.targetFillAt ? new Date(values.targetFillAt).toISOString() : null,
        description: values.description || null,
        requirements: values.requirements || null,
        responsibilities: values.responsibilities || null,
      };

      // `clientId`, `skills` and `ownerId` are intentionally omitted: the client
      // and skill pickers land with the clients module, and the API defaults the
      // owner to the creator.
      if (mode === 'edit' && job) {
        return api.patch<JobDetail>(`/jobs/${job.id}`, shared);
      }
      return api.post<JobDetail>('/jobs', {
        ...shared,
        status: values.status,
        useDefaultPipeline: values.useDefaultPipeline,
      });
    },
    onSuccess: (savedJob) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      toast.success(mode === 'edit' ? `${savedJob.title} updated` : `${savedJob.title} created`);
      if (onSuccess) onSuccess(savedJob);
      else router.push(`/jobs/${savedJob.id}`);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;
  const submitting = save.isPending;
  const workAuthorizations = form.watch('workAuthorizations');

  function toggleAuthorization(value: JobFormValues['workAuthorizations'][number]) {
    const current = form.getValues('workAuthorizations');
    form.setValue(
      'workAuthorizations',
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value],
      { shouldDirty: true },
    );
  }

  function handleCancel() {
    if (onCancel) onCancel();
    else router.push('/jobs');
  }

  return (
    <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-5">
      <fieldset disabled={submitting} className="space-y-5">
        {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

        <Card>
          <CardHeader>
            <CardTitle>Basics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="job-title">Job title</Label>
              <Input id="job-title" placeholder="Senior Backend Engineer" {...form.register('title')} />
              {form.formState.errors.title ? (
                <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SelectField
                id="job-type"
                label="Job type"
                value={form.watch('jobType')}
                options={jobTypeSchema.options.map((option) => ({ value: option, label: JOB_TYPE_LABELS[option] }))}
                onChange={(value) => form.setValue('jobType', value as JobFormValues['jobType'], { shouldDirty: true })}
              />
              <SelectField
                id="job-remote"
                label="Remote type"
                value={form.watch('remoteType')}
                options={remoteTypeSchema.options.map((option) => ({ value: option, label: REMOTE_TYPE_LABELS[option] }))}
                onChange={(value) => form.setValue('remoteType', value as JobFormValues['remoteType'], { shouldDirty: true })}
              />
              <SelectField
                id="job-priority"
                label="Priority"
                value={form.watch('priority')}
                options={prioritySchema.options.map((option) => ({ value: option, label: PRIORITY_LABELS[option] }))}
                onChange={(value) => form.setValue('priority', value as JobFormValues['priority'], { shouldDirty: true })}
              />
              {mode === 'create' ? (
                <SelectField
                  id="job-status"
                  label="Status"
                  value={form.watch('status')}
                  options={[
                    { value: 'DRAFT', label: 'Draft' },
                    { value: 'OPEN', label: 'Open' },
                  ]}
                  onChange={(value) => form.setValue('status', value as JobFormValues['status'], { shouldDirty: true })}
                />
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="job-openings">Openings</Label>
                <Input id="job-openings" type="number" min={1} max={999} {...form.register('openings')} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="job-city">City</Label>
                <Input id="job-city" {...form.register('locationCity')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="job-state">State / region</Label>
                <Input id="job-state" {...form.register('locationState')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="job-country">Country</Label>
                <Input id="job-country" {...form.register('locationCountry')} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Compensation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="job-currency">Currency</Label>
                <Input id="job-currency" maxLength={3} className="uppercase" {...form.register('currency')} />
                {form.formState.errors.currency ? (
                  <p className="text-xs text-destructive">{form.formState.errors.currency.message}</p>
                ) : (
                  <p className="text-2xs text-muted-foreground">3-letter ISO code, e.g. USD</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="job-pay-min">Pay rate min</Label>
                <Input id="job-pay-min" type="number" min={0} step="0.01" {...form.register('payRateMin')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="job-pay-max">Pay rate max</Label>
                <Input id="job-pay-max" type="number" min={0} step="0.01" {...form.register('payRateMax')} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                id="job-rate-type"
                label="Pay rate type"
                value={form.watch('rateType')}
                placeholder="Not set"
                options={rateTypeSchema.options.map((option) => ({ value: option, label: RATE_TYPE_LABELS[option] }))}
                onChange={(value) => form.setValue('rateType', value as JobFormValues['rateType'], { shouldDirty: true })}
              />
              <div className="space-y-1.5">
                <Label htmlFor="job-bill-rate">Bill rate</Label>
                <Input id="job-bill-rate" type="number" min={0} step="0.01" {...form.register('billRate')} />
              </div>
              <SelectField
                id="job-bill-rate-type"
                label="Bill rate type"
                value={form.watch('billRateType')}
                placeholder="Not set"
                options={rateTypeSchema.options.map((option) => ({ value: option, label: RATE_TYPE_LABELS[option] }))}
                onChange={(value) => form.setValue('billRateType', value as JobFormValues['billRateType'], { shouldDirty: true })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Requirements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="job-min-exp">Min experience (years)</Label>
                <Input id="job-min-exp" type="number" min={0} max={60} {...form.register('minExperienceYears')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="job-max-exp">Max experience (years)</Label>
                <Input id="job-max-exp" type="number" min={0} max={60} {...form.register('maxExperienceYears')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="job-education">Education level</Label>
                <Input id="job-education" placeholder="Bachelor’s degree" {...form.register('educationLevel')} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                id="job-visa"
                label="Visa sponsorship"
                value={form.watch('visaSponsorship')}
                options={[
                  { value: 'unspecified', label: 'Not specified' },
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                ]}
                onChange={(value) =>
                  form.setValue('visaSponsorship', value as JobFormValues['visaSponsorship'], { shouldDirty: true })
                }
              />
              <div className="space-y-1.5">
                <Label htmlFor="job-target-fill">Target fill date</Label>
                <Input id="job-target-fill" type="date" {...form.register('targetFillAt')} />
              </div>
            </div>

            <div className="space-y-2">
              <Label asChild>
                <span>Work authorizations accepted</span>
              </Label>
              <div className="flex flex-wrap gap-2">
                {workAuthorizationSchema.options.map((option) => {
                  const selected = workAuthorizations.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleAuthorization(option)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-2xs font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                        selected
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {WORK_AUTHORIZATION_LABELS[option]}
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="job-description">Role description</Label>
              <Textarea id="job-description" rows={4} {...form.register('description')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-requirements">Requirements</Label>
              <Textarea id="job-requirements" rows={4} {...form.register('requirements')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-responsibilities">Responsibilities</Label>
              <Textarea id="job-responsibilities" rows={4} {...form.register('responsibilities')} />
            </div>
          </CardContent>
        </Card>

        {mode === 'create' ? (
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 shadow-card">
            <div className="space-y-0.5">
              <Label htmlFor="job-default-pipeline" className="cursor-pointer">
                Copy the workspace pipeline into this job
              </Label>
              <p className="text-xs text-muted-foreground">
                Turn this off to start with a single intake stage you can extend later.
              </p>
            </div>
            <Switch
              id="job-default-pipeline"
              checked={form.watch('useDefaultPipeline')}
              onCheckedChange={(checked) =>
                form.setValue('useDefaultPipeline', checked, { shouldDirty: true })
              }
            />
          </div>
        ) : null}
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {mode === 'edit' ? 'Save changes' : 'Create requisition'}
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
