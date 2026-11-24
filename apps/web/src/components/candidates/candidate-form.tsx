'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  AVAILABILITY_LABELS,
  CANDIDATE_SOURCE_LABELS,
  CANDIDATE_STATUS_LABELS,
  WORK_AUTHORIZATION_LABELS,
  availabilitySchema,
  candidateSourceSchema,
  candidateStatusSchema,
  createCandidateSchema,
  currencySchema,
  emailSchema,
  experienceLevelSchema,
  phoneSchema,
  urlSchema,
  workAuthorizationSchema,
  type CandidateDetail,
  type CandidateDuplicateGroup,
} from '@talentflow/types';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { ApiError } from '@/lib/api-error';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';

const ratePeriodSchema = z.enum(['HOURLY', 'DAILY', 'MONTHLY', 'ANNUAL']);
const RATE_PERIOD_LABELS: Record<z.infer<typeof ratePeriodSchema>, string> = {
  HOURLY: 'Per hour',
  DAILY: 'Per day',
  MONTHLY: 'Per month',
  ANNUAL: 'Per year',
};

/** No `*_LABELS` map is published for experience level, so keep one locally. */
const EXPERIENCE_LEVEL_LABELS: Record<string, string> = {
  INTERN: 'Intern',
  JUNIOR: 'Junior',
  MID: 'Mid-level',
  SENIOR: 'Senior',
  LEAD: 'Lead',
  PRINCIPAL: 'Principal',
  EXECUTIVE: 'Executive',
};

/**
 * The form cannot use `createCandidateSchema` verbatim: it collects money in
 * major units and converts to cents on submit, holds numerics as strings and
 * normalises empty optional inputs to an empty string. Constraints are reused
 * from the API schema field by field so the two never drift.
 */
const candidateFormSchema = z.object({
  firstName: createCandidateSchema.shape.firstName,
  lastName: createCandidateSchema.shape.lastName,
  email: z.union([emailSchema, z.literal('')]),
  phone: z.union([phoneSchema, z.literal('')]),
  alternatePhone: z.union([phoneSchema, z.literal('')]),

  headline: z.string().trim().max(200),
  currentTitle: z.string().trim().max(160),
  currentCompany: z.string().trim().max(160),

  locationCity: z.string().trim().max(120),
  locationState: z.string().trim().max(120),
  locationCountry: z.string().trim().max(120),
  willingToRelocate: z.boolean(),
  availability: z.union([availabilitySchema, z.literal('')]),
  noticePeriodDays: z.string().trim(),

  totalExperienceMonths: z.string().trim(),
  relevantExperienceMonths: z.string().trim(),
  experienceLevel: z.union([experienceLevelSchema, z.literal('')]),
  workAuthorization: workAuthorizationSchema,

  expectedSalary: z.string().trim(),
  expectedSalaryCurrency: z.union([currencySchema, z.literal('')]),
  currentSalary: z.string().trim(),
  expectedRate: z.string().trim(),
  currentRate: z.string().trim(),
  ratePeriod: z.union([ratePeriodSchema, z.literal('')]),
  rateCurrency: z.union([currencySchema, z.literal('')]),

  linkedinUrl: z.union([urlSchema, z.literal('')]),
  githubUrl: z.union([urlSchema, z.literal('')]),
  portfolioUrl: z.union([urlSchema, z.literal('')]),
  websiteUrl: z.union([urlSchema, z.literal('')]),

  status: candidateStatusSchema,
  source: candidateSourceSchema,
  isHot: z.boolean(),
  rating: z.union([z.string().trim().regex(/^[1-5]$/, 'Use a rating from 1 to 5'), z.literal('')]),
  tags: z.string().trim().max(2000),

  summary: z.string().trim().max(8000),
});

type CandidateFormValues = z.infer<typeof candidateFormSchema>;

const EMPTY_VALUES: CandidateFormValues = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  alternatePhone: '',
  headline: '',
  currentTitle: '',
  currentCompany: '',
  locationCity: '',
  locationState: '',
  locationCountry: '',
  willingToRelocate: false,
  availability: '',
  noticePeriodDays: '',
  totalExperienceMonths: '',
  relevantExperienceMonths: '',
  experienceLevel: '',
  workAuthorization: 'UNKNOWN',
  expectedSalary: '',
  expectedSalaryCurrency: '',
  currentSalary: '',
  expectedRate: '',
  currentRate: '',
  ratePeriod: '',
  rateCurrency: '',
  linkedinUrl: '',
  githubUrl: '',
  portfolioUrl: '',
  websiteUrl: '',
  status: 'ACTIVE',
  source: 'MANUAL',
  isHot: false,
  rating: '',
  tags: '',
  summary: '',
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

function toOptionalString(value: string | null): string {
  return value ?? '';
}

function defaultsFromCandidate(candidate: CandidateDetail): CandidateFormValues {
  return {
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    email: toOptionalString(candidate.email),
    phone: toOptionalString(candidate.phone),
    alternatePhone: toOptionalString(candidate.alternatePhone),
    headline: toOptionalString(candidate.headline),
    currentTitle: toOptionalString(candidate.currentTitle),
    currentCompany: toOptionalString(candidate.currentCompany),
    locationCity: toOptionalString(candidate.locationCity),
    locationState: toOptionalString(candidate.locationState),
    locationCountry: toOptionalString(candidate.locationCountry),
    willingToRelocate: candidate.willingToRelocate,
    availability: candidate.availability ?? '',
    noticePeriodDays: candidate.noticePeriodDays === null ? '' : String(candidate.noticePeriodDays),
    totalExperienceMonths:
      candidate.totalExperienceMonths === null ? '' : String(candidate.totalExperienceMonths),
    relevantExperienceMonths:
      candidate.relevantExperienceMonths === null ? '' : String(candidate.relevantExperienceMonths),
    experienceLevel: (candidate.experienceLevel ?? '') as CandidateFormValues['experienceLevel'],
    workAuthorization: candidate.workAuthorization,
    expectedSalary: toMajorString(candidate.expectedSalaryCents),
    expectedSalaryCurrency: candidate.expectedSalaryCurrency ?? '',
    currentSalary: toMajorString(candidate.currentSalaryCents),
    expectedRate: toMajorString(candidate.expectedRateCents),
    currentRate: toMajorString(candidate.currentRateCents),
    ratePeriod: (ratePeriodSchema.safeParse(candidate.ratePeriod).data ?? '') as
      | z.infer<typeof ratePeriodSchema>
      | '',
    rateCurrency: candidate.rateCurrency ?? '',
    linkedinUrl: toOptionalString(candidate.linkedinUrl),
    githubUrl: toOptionalString(candidate.githubUrl),
    portfolioUrl: toOptionalString(candidate.portfolioUrl),
    websiteUrl: toOptionalString(candidate.websiteUrl),
    status: candidate.status,
    source: candidate.source,
    isHot: candidate.isHot,
    rating: candidate.rating === null ? '' : String(candidate.rating),
    tags: candidate.tags.join(', '),
    summary: toOptionalString(candidate.summary),
  };
}

/** Profile fields shared by create and update (nested collections are omitted). */
function buildProfilePayload(values: CandidateFormValues) {
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    email: values.email || null,
    phone: values.phone || null,
    alternatePhone: values.alternatePhone || null,
    headline: values.headline || null,
    currentTitle: values.currentTitle || null,
    currentCompany: values.currentCompany || null,
    locationCity: values.locationCity || null,
    locationState: values.locationState || null,
    locationCountry: values.locationCountry || null,
    willingToRelocate: values.willingToRelocate,
    availability: values.availability || null,
    noticePeriodDays: toInt(values.noticePeriodDays),
    totalExperienceMonths: toInt(values.totalExperienceMonths),
    relevantExperienceMonths: toInt(values.relevantExperienceMonths),
    experienceLevel: values.experienceLevel || null,
    workAuthorization: values.workAuthorization,
    expectedSalaryCents: toCents(values.expectedSalary),
    expectedSalaryCurrency: values.expectedSalaryCurrency || null,
    currentSalaryCents: toCents(values.currentSalary),
    expectedRateCents: toCents(values.expectedRate),
    currentRateCents: toCents(values.currentRate),
    ratePeriod: values.ratePeriod || null,
    rateCurrency: values.rateCurrency || null,
    linkedinUrl: values.linkedinUrl || null,
    githubUrl: values.githubUrl || null,
    portfolioUrl: values.portfolioUrl || null,
    websiteUrl: values.websiteUrl || null,
    status: values.status,
    source: values.source,
    isHot: values.isHot,
    rating: values.rating ? Number(values.rating) : null,
    tags: values.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .slice(0, 50),
    summary: values.summary || null,
  };
}

/** Pulls the duplicate groups out of a 409 body's `details`. */
function extractDuplicateGroups(details: unknown): CandidateDuplicateGroup[] {
  if (details === null || typeof details !== 'object') return [];
  const record = details as { duplicates?: unknown };
  if (!Array.isArray(record.duplicates)) return [];
  return record.duplicates.filter(
    (entry): entry is CandidateDuplicateGroup =>
      entry !== null &&
      typeof entry === 'object' &&
      Array.isArray((entry as { candidates?: unknown }).candidates),
  );
}

interface CandidateFormProps {
  mode?: 'create' | 'edit';
  candidate?: CandidateDetail;
  onSuccess?: (candidate: CandidateDetail) => void;
  onCancel?: () => void;
}

export function CandidateForm({ mode = 'create', candidate, onSuccess, onCancel }: CandidateFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [duplicates, setDuplicates] = useState<CandidateDuplicateGroup[]>([]);

  const form = useForm<CandidateFormValues>({
    resolver: zodResolver(candidateFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    form.reset(mode === 'edit' && candidate ? defaultsFromCandidate(candidate) : EMPTY_VALUES);
    setDuplicates([]);
  }, [form, mode, candidate]);

  const save = useMutation({
    mutationFn: ({ values, allowDuplicate }: { values: CandidateFormValues; allowDuplicate: boolean }) => {
      const payload = buildProfilePayload(values);
      if (mode === 'edit' && candidate) {
        return api.patch<CandidateDetail>(`/candidates/${candidate.id}`, payload);
      }
      return api.post<CandidateDetail>('/candidates', { ...payload, allowDuplicate });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.all });
      toast.success(mode === 'edit' ? `${saved.fullName} updated` : `${saved.fullName} added`);
      setDuplicates([]);
      if (onSuccess) onSuccess(saved);
      else router.push(`/candidates/${saved.id}`);
    },
    onError: (error: unknown) => {
      if (mode === 'create' && error instanceof ApiError && error.isConflict) {
        const groups = extractDuplicateGroups(error.details);
        if (groups.length > 0) {
          setDuplicates(groups);
          return;
        }
      }
      setDuplicates([]);
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;
  const submitting = save.isPending;

  function handleCancel() {
    if (onCancel) onCancel();
    else router.push('/candidates');
  }

  function createAnyway() {
    save.mutate({ values: form.getValues(), allowDuplicate: true });
  }

  return (
    <form noValidate onSubmit={form.handleSubmit((values) => save.mutate({ values, allowDuplicate: false }))} className="space-y-5">
      <fieldset disabled={submitting} className="space-y-5">
        {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

        {duplicates.length > 0 ? (
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Possible duplicates found</AlertTitle>
            <AlertDescription>
              <p>
                A candidate with a matching email, phone or LinkedIn already exists. Review the
                matches before creating a second record.
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-4">
                {duplicates.flatMap((group) =>
                  group.candidates.map((match) => (
                    <li key={`${group.matchType}-${match.id}`}>
                      {match.fullName}
                      {match.currentCompany ? <span> · {match.currentCompany}</span> : null}
                      <span className="text-muted-foreground"> ({group.matchType.toLowerCase()})</span>
                    </li>
                  )),
                )}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" loading={submitting} onClick={createAnyway}>
                  Create anyway
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Basics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="candidate-first-name">First name</Label>
                <Input id="candidate-first-name" {...form.register('firstName')} />
                {form.formState.errors.firstName ? (
                  <p className="text-xs text-destructive">{form.formState.errors.firstName.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="candidate-last-name">Last name</Label>
                <Input id="candidate-last-name" {...form.register('lastName')} />
                {form.formState.errors.lastName ? (
                  <p className="text-xs text-destructive">{form.formState.errors.lastName.message}</p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="candidate-email">Email</Label>
                <Input id="candidate-email" type="email" {...form.register('email')} />
                {form.formState.errors.email ? (
                  <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="candidate-phone">Phone</Label>
                <Input id="candidate-phone" type="tel" {...form.register('phone')} />
                {form.formState.errors.phone ? (
                  <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="candidate-alt-phone">Alternate phone</Label>
                <Input id="candidate-alt-phone" type="tel" {...form.register('alternatePhone')} />
                {form.formState.errors.alternatePhone ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.alternatePhone.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="candidate-title">Current title</Label>
                <Input id="candidate-title" placeholder="Senior Backend Engineer" {...form.register('currentTitle')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="candidate-company">Current company</Label>
                <Input id="candidate-company" {...form.register('currentCompany')} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="candidate-headline">Headline</Label>
              <Input
                id="candidate-headline"
                placeholder="Backend engineer focused on distributed systems"
                {...form.register('headline')}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Location & availability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="candidate-city">City</Label>
                <Input id="candidate-city" {...form.register('locationCity')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="candidate-state">State / region</Label>
                <Input id="candidate-state" {...form.register('locationState')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="candidate-country">Country</Label>
                <Input id="candidate-country" {...form.register('locationCountry')} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                id="candidate-availability"
                label="Availability"
                value={form.watch('availability')}
                placeholder="Not set"
                options={availabilitySchema.options.map((option) => ({
                  value: option,
                  label: AVAILABILITY_LABELS[option],
                }))}
                onChange={(value) =>
                  form.setValue('availability', value as CandidateFormValues['availability'], {
                    shouldDirty: true,
                  })
                }
              />
              <div className="space-y-1.5">
                <Label htmlFor="candidate-notice">Notice period (days)</Label>
                <Input id="candidate-notice" type="number" min={0} max={365} {...form.register('noticePeriodDays')} />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-3">
              <div className="space-y-0.5">
                <Label htmlFor="candidate-relocate" className="cursor-pointer">
                  Willing to relocate
                </Label>
                <p className="text-xs text-muted-foreground">Open to roles outside their current location.</p>
              </div>
              <Switch
                id="candidate-relocate"
                checked={form.watch('willingToRelocate')}
                onCheckedChange={(checked) =>
                  form.setValue('willingToRelocate', checked, { shouldDirty: true })
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Experience & rates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="candidate-total-exp">Total experience (months)</Label>
                <Input id="candidate-total-exp" type="number" min={0} max={840} {...form.register('totalExperienceMonths')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="candidate-relevant-exp">Relevant experience (months)</Label>
                <Input
                  id="candidate-relevant-exp"
                  type="number"
                  min={0}
                  max={840}
                  {...form.register('relevantExperienceMonths')}
                />
              </div>
              <SelectField
                id="candidate-experience-level"
                label="Experience level"
                value={form.watch('experienceLevel')}
                placeholder="Not set"
                options={experienceLevelSchema.options.map((option) => ({
                  value: option,
                  label: EXPERIENCE_LEVEL_LABELS[option] ?? option,
                }))}
                onChange={(value) =>
                  form.setValue('experienceLevel', value as CandidateFormValues['experienceLevel'], {
                    shouldDirty: true,
                  })
                }
              />
            </div>

            <SelectField
              id="candidate-work-auth"
              label="Work authorization"
              value={form.watch('workAuthorization')}
              options={workAuthorizationSchema.options.map((option) => ({
                value: option,
                label: WORK_AUTHORIZATION_LABELS[option],
              }))}
              onChange={(value) =>
                form.setValue('workAuthorization', value as CandidateFormValues['workAuthorization'], {
                  shouldDirty: true,
                })
              }
            />

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="candidate-expected-salary">Expected salary</Label>
                <Input id="candidate-expected-salary" type="number" min={0} step="0.01" {...form.register('expectedSalary')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="candidate-expected-salary-currency">Salary currency</Label>
                <Input
                  id="candidate-expected-salary-currency"
                  maxLength={3}
                  className="uppercase"
                  placeholder="USD"
                  {...form.register('expectedSalaryCurrency')}
                />
                {form.formState.errors.expectedSalaryCurrency ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.expectedSalaryCurrency.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="candidate-current-salary">Current salary</Label>
                <Input id="candidate-current-salary" type="number" min={0} step="0.01" {...form.register('currentSalary')} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="candidate-expected-rate">Expected rate</Label>
                <Input id="candidate-expected-rate" type="number" min={0} step="0.01" {...form.register('expectedRate')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="candidate-current-rate">Current rate</Label>
                <Input id="candidate-current-rate" type="number" min={0} step="0.01" {...form.register('currentRate')} />
              </div>
              <SelectField
                id="candidate-rate-period"
                label="Rate period"
                value={form.watch('ratePeriod')}
                placeholder="Not set"
                options={ratePeriodSchema.options.map((option) => ({
                  value: option,
                  label: RATE_PERIOD_LABELS[option],
                }))}
                onChange={(value) =>
                  form.setValue('ratePeriod', value as CandidateFormValues['ratePeriod'], {
                    shouldDirty: true,
                  })
                }
              />
              <div className="space-y-1.5">
                <Label htmlFor="candidate-rate-currency">Rate currency</Label>
                <Input
                  id="candidate-rate-currency"
                  maxLength={3}
                  className="uppercase"
                  placeholder="USD"
                  {...form.register('rateCurrency')}
                />
                {form.formState.errors.rateCurrency ? (
                  <p className="text-xs text-destructive">{form.formState.errors.rateCurrency.message}</p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Links</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="candidate-linkedin">LinkedIn</Label>
              <Input id="candidate-linkedin" type="url" placeholder="https://linkedin.com/in/…" {...form.register('linkedinUrl')} />
              {form.formState.errors.linkedinUrl ? (
                <p className="text-xs text-destructive">{form.formState.errors.linkedinUrl.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="candidate-github">GitHub</Label>
              <Input id="candidate-github" type="url" placeholder="https://github.com/…" {...form.register('githubUrl')} />
              {form.formState.errors.githubUrl ? (
                <p className="text-xs text-destructive">{form.formState.errors.githubUrl.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="candidate-portfolio">Portfolio</Label>
              <Input id="candidate-portfolio" type="url" {...form.register('portfolioUrl')} />
              {form.formState.errors.portfolioUrl ? (
                <p className="text-xs text-destructive">{form.formState.errors.portfolioUrl.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="candidate-website">Website</Label>
              <Input id="candidate-website" type="url" {...form.register('websiteUrl')} />
              {form.formState.errors.websiteUrl ? (
                <p className="text-xs text-destructive">{form.formState.errors.websiteUrl.message}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status & tags</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                id="candidate-status"
                label="Status"
                value={form.watch('status')}
                options={candidateStatusSchema.options.map((option) => ({
                  value: option,
                  label: CANDIDATE_STATUS_LABELS[option],
                }))}
                onChange={(value) =>
                  form.setValue('status', value as CandidateFormValues['status'], { shouldDirty: true })
                }
              />
              <SelectField
                id="candidate-source"
                label="Source"
                value={form.watch('source')}
                options={candidateSourceSchema.options.map((option) => ({
                  value: option,
                  label: CANDIDATE_SOURCE_LABELS[option],
                }))}
                onChange={(value) =>
                  form.setValue('source', value as CandidateFormValues['source'], { shouldDirty: true })
                }
              />
              <div className="space-y-1.5">
                <Label htmlFor="candidate-rating">Rating (1–5)</Label>
                <Input id="candidate-rating" type="number" min={1} max={5} {...form.register('rating')} />
                {form.formState.errors.rating ? (
                  <p className="text-xs text-destructive">{form.formState.errors.rating.message}</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="candidate-tags">Tags</Label>
              <Input id="candidate-tags" placeholder="priority, backend, referral" {...form.register('tags')} />
              <p className="text-2xs text-muted-foreground">Separate tags with commas.</p>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-3">
              <div className="space-y-0.5">
                <Label htmlFor="candidate-hot" className="cursor-pointer">
                  Mark as hot
                </Label>
                <p className="text-xs text-muted-foreground">Flags the candidate for priority attention.</p>
              </div>
              <Switch
                id="candidate-hot"
                checked={form.watch('isHot')}
                onCheckedChange={(checked) => form.setValue('isHot', checked, { shouldDirty: true })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <Label htmlFor="candidate-summary">Profile summary</Label>
              <Textarea id="candidate-summary" rows={5} {...form.register('summary')} />
            </div>
          </CardContent>
        </Card>
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {mode === 'edit' ? 'Save changes' : 'Create candidate'}
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
