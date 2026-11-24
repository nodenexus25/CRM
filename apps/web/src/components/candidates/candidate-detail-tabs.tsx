'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Award,
  ExternalLink,
  GraduationCap,
  Languages as LanguagesIcon,
  Mail,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  ShieldOff,
  Sparkles,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  AVAILABILITY_LABELS,
  CANDIDATE_SOURCE_LABELS,
  CANDIDATE_STATUS_LABELS,
  SKILL_PROFICIENCY_LABELS,
  WORK_AUTHORIZATION_LABELS,
  candidateCertificationInputSchema,
  candidateEducationInputSchema,
  candidateEmailInputSchema,
  candidateExperienceInputSchema,
  candidateLanguageInputSchema,
  candidatePhoneInputSchema,
  skillProficiencySchema,
  urlSchema,
  type CandidateDetail,
} from '@talentflow/types';
import { formatCurrency, formatDate, humanizeEnum } from '@talentflow/ui';

import { ActivityTimeline } from '@/components/activity/activity-timeline';
import { NotesPanel } from '@/components/notes/notes-panel';
import { ResumePanel } from '@/components/resumes/resume-panel';
import { SubmitApplicationDialog } from '@/components/submissions/submit-application-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type CandidateEmail = CandidateDetail['emails'][number];
type CandidatePhone = CandidateDetail['phones'][number];
type CandidateExperience = CandidateDetail['experiences'][number];
type CandidateEducation = CandidateDetail['educations'][number];
type CandidateSkill = CandidateDetail['candidateSkills'][number];
type CandidateCertification = CandidateDetail['certifications'][number];
type CandidateLanguage = CandidateDetail['languages'][number];

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

const RATE_PERIOD_LABELS: Record<string, string> = {
  HOURLY: 'hour',
  DAILY: 'day',
  MONTHLY: 'month',
  ANNUAL: 'year',
};

function orDash(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : '—';
}

function nullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableDate(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/** ISO timestamp → `yyyy-mm-dd` for a `<input type="date">`. */
function toDateInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function fromCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function months(value: number | null): string {
  if (value === null) return '—';
  const years = Math.floor(value / 12);
  const remainder = value % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} yr${years === 1 ? '' : 's'}`);
  if (remainder > 0 || years === 0) parts.push(`${remainder} mo`);
  return parts.join(' ');
}

function money(cents: number | null, currency: string | null): string {
  if (cents === null) return '—';
  return formatCurrency({ amount: cents / 100, currency: currency ?? 'USD', maximumFractionDigits: 2 });
}

function rate(cents: number | null, currency: string | null, period: string | null): string {
  if (cents === null) return '—';
  const suffix = period ? ` / ${RATE_PERIOD_LABELS[period] ?? period.toLowerCase()}` : '';
  return `${money(cents, currency)}${suffix}`;
}

/** Only `http(s)` links are rendered as anchors — never `javascript:`/`data:`. */
function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : null;
}

function useInvalidateCandidate() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.all });
  };
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

function CheckRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        {description ? <span className="block text-xs text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  );
}

/** Remove button shared by every child-resource list. */
function RemoveSubResource({
  candidateId,
  path,
  label,
}: {
  candidateId: string;
  path: string;
  label: string;
}) {
  const invalidate = useInvalidateCandidate();
  const remove = useMutation({
    mutationFn: () => api.delete<CandidateDetail>(`/candidates/${candidateId}${path}`),
    onSuccess: () => {
      invalidate();
      toast.success(`${label} removed`);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : `Could not remove ${label.toLowerCase()}`);
    },
  });

  return (
    <ConfirmDialog
      destructive
      title={`Remove ${label.toLowerCase()}?`}
      description="It is deleted from this candidate's profile. This cannot be undone."
      confirmLabel="Remove"
      trigger={
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${label.toLowerCase()}`}
            disabled={remove.isPending}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        </DialogTrigger>
      }
      onConfirm={() => remove.mutateAsync().then(() => undefined)}
    />
  );
}

// ---------------------------------------------------------------------------
// Form schemas — field constraints are reused from the API input schemas
// ---------------------------------------------------------------------------

const emailFormSchema = z.object({
  address: candidateEmailInputSchema.shape.address,
  label: z.string().trim().max(40),
  isPrimary: z.boolean(),
});
type EmailFormValues = z.infer<typeof emailFormSchema>;

const phoneFormSchema = z.object({
  number: candidatePhoneInputSchema.shape.number,
  label: z.string().trim().max(40),
  isPrimary: z.boolean(),
});
type PhoneFormValues = z.infer<typeof phoneFormSchema>;

const experienceFormSchema = z.object({
  company: candidateExperienceInputSchema.shape.company,
  title: candidateExperienceInputSchema.shape.title,
  employmentType: z.string().trim().max(60),
  location: z.string().trim().max(160),
  startDate: z.string().trim(),
  endDate: z.string().trim(),
  isCurrent: z.boolean(),
  description: z.string().trim().max(8000),
  skills: z.string().trim().max(2000),
});
type ExperienceFormValues = z.infer<typeof experienceFormSchema>;

const educationFormSchema = z.object({
  institution: candidateEducationInputSchema.shape.institution,
  degree: z.string().trim().max(160),
  fieldOfStudy: z.string().trim().max(160),
  startDate: z.string().trim(),
  endDate: z.string().trim(),
  grade: z.string().trim().max(60),
  description: z.string().trim().max(4000),
});
type EducationFormValues = z.infer<typeof educationFormSchema>;

const skillFormSchema = z.object({
  years: z.string().trim(),
  level: z.union([z.string().trim().regex(/^[1-5]$/, 'Use a level from 1 to 5'), z.literal('')]),
  isPrimary: z.boolean(),
  lastUsedAt: z.string().trim(),
});
type SkillFormValues = z.infer<typeof skillFormSchema>;

const certificationFormSchema = z.object({
  name: candidateCertificationInputSchema.shape.name,
  issuer: z.string().trim().max(160),
  issuedAt: z.string().trim(),
  expiresAt: z.string().trim(),
  credentialId: z.string().trim().max(120),
  credentialUrl: z.union([urlSchema, z.literal('')]),
});
type CertificationFormValues = z.infer<typeof certificationFormSchema>;

const languageFormSchema = z.object({
  name: candidateLanguageInputSchema.shape.name,
  proficiency: skillProficiencySchema,
});
type LanguageFormValues = z.infer<typeof languageFormSchema>;

// ---------------------------------------------------------------------------
// Email editor
// ---------------------------------------------------------------------------

const EMPTY_EMAIL: EmailFormValues = { address: '', label: '', isPrimary: false };

function EmailDialog({
  candidateId,
  email,
  trigger,
}: {
  candidateId: string;
  email?: CandidateEmail;
  trigger: ReactNode;
}) {
  const invalidate = useInvalidateCandidate();
  const [open, setOpen] = useState(false);
  const fieldId = useId();

  const form = useForm<EmailFormValues>({ resolver: zodResolver(emailFormSchema), defaultValues: EMPTY_EMAIL });

  useEffect(() => {
    if (!open) return;
    form.reset(email ? { address: email.address, label: email.label ?? '', isPrimary: email.isPrimary } : EMPTY_EMAIL);
  }, [open, email, form]);

  const save = useMutation({
    mutationFn: (values: EmailFormValues) => {
      const body = { address: values.address, label: nullableString(values.label), isPrimary: values.isPrimary };
      return email
        ? api.patch<CandidateDetail>(`/candidates/${candidateId}/emails/${email.id}`, body)
        : api.post<CandidateDetail>(`/candidates/${candidateId}/emails`, body);
    },
    onSuccess: () => {
      invalidate();
      toast.success(email ? 'Email updated' : 'Email added');
      setOpen(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{email ? 'Edit email' : 'Add email'}</DialogTitle>
          <DialogDescription>Email addresses are used for outreach and duplicate detection.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-4">
          <fieldset disabled={save.isPending} className="space-y-4">
            {form.formState.errors.root ? (
              <p className="text-xs text-destructive">{form.formState.errors.root.message}</p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-address`}>Email</Label>
              <Input id={`${fieldId}-address`} type="email" {...form.register('address')} />
              <FieldError message={form.formState.errors.address?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-label`}>Label</Label>
              <Input id={`${fieldId}-label`} placeholder="Work, personal…" {...form.register('label')} />
            </div>
            <CheckRow
              id={`${fieldId}-primary`}
              label="Primary email"
              checked={form.watch('isPrimary')}
              onChange={(checked) => form.setValue('isPrimary', checked, { shouldDirty: true })}
            />
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {email ? 'Save' : 'Add email'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Phone editor
// ---------------------------------------------------------------------------

const EMPTY_PHONE: PhoneFormValues = { number: '', label: '', isPrimary: false };

function PhoneDialog({
  candidateId,
  phone,
  trigger,
}: {
  candidateId: string;
  phone?: CandidatePhone;
  trigger: ReactNode;
}) {
  const invalidate = useInvalidateCandidate();
  const [open, setOpen] = useState(false);
  const fieldId = useId();

  const form = useForm<PhoneFormValues>({ resolver: zodResolver(phoneFormSchema), defaultValues: EMPTY_PHONE });

  useEffect(() => {
    if (!open) return;
    form.reset(phone ? { number: phone.number, label: phone.label ?? '', isPrimary: phone.isPrimary } : EMPTY_PHONE);
  }, [open, phone, form]);

  const save = useMutation({
    mutationFn: (values: PhoneFormValues) => {
      const body = { number: values.number, label: nullableString(values.label), isPrimary: values.isPrimary };
      return phone
        ? api.patch<CandidateDetail>(`/candidates/${candidateId}/phones/${phone.id}`, body)
        : api.post<CandidateDetail>(`/candidates/${candidateId}/phones`, body);
    },
    onSuccess: () => {
      invalidate();
      toast.success(phone ? 'Phone updated' : 'Phone added');
      setOpen(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{phone ? 'Edit phone' : 'Add phone'}</DialogTitle>
          <DialogDescription>Add a reachable number, with an optional label.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-4">
          <fieldset disabled={save.isPending} className="space-y-4">
            {form.formState.errors.root ? (
              <p className="text-xs text-destructive">{form.formState.errors.root.message}</p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-number`}>Phone</Label>
              <Input id={`${fieldId}-number`} type="tel" {...form.register('number')} />
              <FieldError message={form.formState.errors.number?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-label`}>Label</Label>
              <Input id={`${fieldId}-label`} placeholder="Mobile, work…" {...form.register('label')} />
            </div>
            <CheckRow
              id={`${fieldId}-primary`}
              label="Primary phone"
              checked={form.watch('isPrimary')}
              onChange={(checked) => form.setValue('isPrimary', checked, { shouldDirty: true })}
            />
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {phone ? 'Save' : 'Add phone'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Experience editor
// ---------------------------------------------------------------------------

const EMPTY_EXPERIENCE: ExperienceFormValues = {
  company: '',
  title: '',
  employmentType: '',
  location: '',
  startDate: '',
  endDate: '',
  isCurrent: false,
  description: '',
  skills: '',
};

function ExperienceDialog({
  candidateId,
  experience,
  trigger,
}: {
  candidateId: string;
  experience?: CandidateExperience;
  trigger: ReactNode;
}) {
  const invalidate = useInvalidateCandidate();
  const [open, setOpen] = useState(false);
  const fieldId = useId();

  const form = useForm<ExperienceFormValues>({
    resolver: zodResolver(experienceFormSchema),
    defaultValues: EMPTY_EXPERIENCE,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      experience
        ? {
            company: experience.company,
            title: experience.title,
            employmentType: experience.employmentType ?? '',
            location: experience.location ?? '',
            startDate: toDateInput(experience.startDate),
            endDate: toDateInput(experience.endDate),
            isCurrent: experience.isCurrent,
            description: experience.description ?? '',
            skills: experience.skills.join(', '),
          }
        : EMPTY_EXPERIENCE,
    );
  }, [open, experience, form]);

  const save = useMutation({
    mutationFn: (values: ExperienceFormValues) => {
      const body = {
        company: values.company,
        title: values.title,
        employmentType: nullableString(values.employmentType),
        location: nullableString(values.location),
        startDate: nullableDate(values.startDate),
        endDate: nullableDate(values.endDate),
        isCurrent: values.isCurrent,
        description: nullableString(values.description),
        skills: fromCsv(values.skills),
      };
      return experience
        ? api.patch<CandidateDetail>(`/candidates/${candidateId}/experiences/${experience.id}`, body)
        : api.post<CandidateDetail>(`/candidates/${candidateId}/experiences`, body);
    },
    onSuccess: () => {
      invalidate();
      toast.success(experience ? 'Experience updated' : 'Experience added');
      setOpen(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{experience ? 'Edit experience' : 'Add experience'}</DialogTitle>
          <DialogDescription>Work history is used in candidate matching and submittals.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-4">
          <fieldset disabled={save.isPending} className="space-y-4">
            {form.formState.errors.root ? (
              <p className="text-xs text-destructive">{form.formState.errors.root.message}</p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-title`}>Title</Label>
                <Input id={`${fieldId}-title`} {...form.register('title')} />
                <FieldError message={form.formState.errors.title?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-company`}>Company</Label>
                <Input id={`${fieldId}-company`} {...form.register('company')} />
                <FieldError message={form.formState.errors.company?.message} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-type`}>Employment type</Label>
                <Input id={`${fieldId}-type`} placeholder="Full-time, contract…" {...form.register('employmentType')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-location`}>Location</Label>
                <Input id={`${fieldId}-location`} {...form.register('location')} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-start`}>Start date</Label>
                <Input id={`${fieldId}-start`} type="date" {...form.register('startDate')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-end`}>End date</Label>
                <Input id={`${fieldId}-end`} type="date" {...form.register('endDate')} />
              </div>
            </div>
            <CheckRow
              id={`${fieldId}-current`}
              label="Current role"
              description="Marks this as the candidate's present position."
              checked={form.watch('isCurrent')}
              onChange={(checked) => form.setValue('isCurrent', checked, { shouldDirty: true })}
            />
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-skills`}>Skills (comma separated)</Label>
              <Input id={`${fieldId}-skills`} {...form.register('skills')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-description`}>Description</Label>
              <Textarea id={`${fieldId}-description`} rows={3} {...form.register('description')} />
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {experience ? 'Save' : 'Add experience'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Education editor
// ---------------------------------------------------------------------------

const EMPTY_EDUCATION: EducationFormValues = {
  institution: '',
  degree: '',
  fieldOfStudy: '',
  startDate: '',
  endDate: '',
  grade: '',
  description: '',
};

function EducationDialog({
  candidateId,
  education,
  trigger,
}: {
  candidateId: string;
  education?: CandidateEducation;
  trigger: ReactNode;
}) {
  const invalidate = useInvalidateCandidate();
  const [open, setOpen] = useState(false);
  const fieldId = useId();

  const form = useForm<EducationFormValues>({
    resolver: zodResolver(educationFormSchema),
    defaultValues: EMPTY_EDUCATION,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      education
        ? {
            institution: education.institution,
            degree: education.degree ?? '',
            fieldOfStudy: education.fieldOfStudy ?? '',
            startDate: toDateInput(education.startDate),
            endDate: toDateInput(education.endDate),
            grade: education.grade ?? '',
            description: education.description ?? '',
          }
        : EMPTY_EDUCATION,
    );
  }, [open, education, form]);

  const save = useMutation({
    mutationFn: (values: EducationFormValues) => {
      const body = {
        institution: values.institution,
        degree: nullableString(values.degree),
        fieldOfStudy: nullableString(values.fieldOfStudy),
        startDate: nullableDate(values.startDate),
        endDate: nullableDate(values.endDate),
        grade: nullableString(values.grade),
        description: nullableString(values.description),
      };
      return education
        ? api.patch<CandidateDetail>(`/candidates/${candidateId}/educations/${education.id}`, body)
        : api.post<CandidateDetail>(`/candidates/${candidateId}/educations`, body);
    },
    onSuccess: () => {
      invalidate();
      toast.success(education ? 'Education updated' : 'Education added');
      setOpen(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{education ? 'Edit education' : 'Add education'}</DialogTitle>
          <DialogDescription>Degrees and qualifications the candidate has completed.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-4">
          <fieldset disabled={save.isPending} className="space-y-4">
            {form.formState.errors.root ? (
              <p className="text-xs text-destructive">{form.formState.errors.root.message}</p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-institution`}>Institution</Label>
              <Input id={`${fieldId}-institution`} {...form.register('institution')} />
              <FieldError message={form.formState.errors.institution?.message} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-degree`}>Degree</Label>
                <Input id={`${fieldId}-degree`} placeholder="B.Sc." {...form.register('degree')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-field`}>Field of study</Label>
                <Input id={`${fieldId}-field`} {...form.register('fieldOfStudy')} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-start`}>Start date</Label>
                <Input id={`${fieldId}-start`} type="date" {...form.register('startDate')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-end`}>End date</Label>
                <Input id={`${fieldId}-end`} type="date" {...form.register('endDate')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-grade`}>Grade</Label>
                <Input id={`${fieldId}-grade`} {...form.register('grade')} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-description`}>Description</Label>
              <Textarea id={`${fieldId}-description`} rows={3} {...form.register('description')} />
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {education ? 'Save' : 'Add education'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Skill editor — skills are catalogued server-side, so this edits the link only
// ---------------------------------------------------------------------------

const EMPTY_SKILL: SkillFormValues = { years: '', level: '', isPrimary: false, lastUsedAt: '' };

function SkillDialog({
  candidateId,
  skill,
  trigger,
}: {
  candidateId: string;
  skill: CandidateSkill;
  trigger: ReactNode;
}) {
  const invalidate = useInvalidateCandidate();
  const [open, setOpen] = useState(false);
  const fieldId = useId();

  const form = useForm<SkillFormValues>({ resolver: zodResolver(skillFormSchema), defaultValues: EMPTY_SKILL });

  useEffect(() => {
    if (!open) return;
    form.reset({
      years: skill.years === null ? '' : String(skill.years),
      level: skill.level === null ? '' : String(skill.level),
      isPrimary: skill.isPrimary,
      lastUsedAt: toDateInput(skill.lastUsedAt),
    });
  }, [open, skill, form]);

  const save = useMutation({
    mutationFn: (values: SkillFormValues) =>
      api.patch<CandidateDetail>(`/candidates/${candidateId}/skills/${skill.skillId}`, {
        years: nullableInt(values.years),
        level: values.level ? Number(values.level) : null,
        isPrimary: values.isPrimary,
        lastUsedAt: nullableDate(values.lastUsedAt),
      }),
    onSuccess: () => {
      invalidate();
      toast.success(`${skill.name} updated`);
      setOpen(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {skill.name}</DialogTitle>
          <DialogDescription>
            Adjust the candidate&apos;s proficiency. The skill itself is managed in the workspace
            catalogue.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-4">
          <fieldset disabled={save.isPending} className="space-y-4">
            {form.formState.errors.root ? (
              <p className="text-xs text-destructive">{form.formState.errors.root.message}</p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-years`}>Years of experience</Label>
                <Input id={`${fieldId}-years`} type="number" min={0} max={60} {...form.register('years')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-level`}>Level (1–5)</Label>
                <Input id={`${fieldId}-level`} type="number" min={1} max={5} {...form.register('level')} />
                <FieldError message={form.formState.errors.level?.message} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-last-used`}>Last used</Label>
              <Input id={`${fieldId}-last-used`} type="date" {...form.register('lastUsedAt')} />
            </div>
            <CheckRow
              id={`${fieldId}-primary`}
              label="Primary skill"
              checked={form.watch('isPrimary')}
              onChange={(checked) => form.setValue('isPrimary', checked, { shouldDirty: true })}
            />
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Certification editor
// ---------------------------------------------------------------------------

const EMPTY_CERTIFICATION: CertificationFormValues = {
  name: '',
  issuer: '',
  issuedAt: '',
  expiresAt: '',
  credentialId: '',
  credentialUrl: '',
};

function CertificationDialog({
  candidateId,
  certification,
  trigger,
}: {
  candidateId: string;
  certification?: CandidateCertification;
  trigger: ReactNode;
}) {
  const invalidate = useInvalidateCandidate();
  const [open, setOpen] = useState(false);
  const fieldId = useId();

  const form = useForm<CertificationFormValues>({
    resolver: zodResolver(certificationFormSchema),
    defaultValues: EMPTY_CERTIFICATION,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      certification
        ? {
            name: certification.name,
            issuer: certification.issuer ?? '',
            issuedAt: toDateInput(certification.issuedAt),
            expiresAt: toDateInput(certification.expiresAt),
            credentialId: certification.credentialId ?? '',
            credentialUrl: certification.credentialUrl ?? '',
          }
        : EMPTY_CERTIFICATION,
    );
  }, [open, certification, form]);

  const save = useMutation({
    mutationFn: (values: CertificationFormValues) => {
      const body = {
        name: values.name,
        issuer: nullableString(values.issuer),
        issuedAt: nullableDate(values.issuedAt),
        expiresAt: nullableDate(values.expiresAt),
        credentialId: nullableString(values.credentialId),
        credentialUrl: nullableString(values.credentialUrl),
      };
      return certification
        ? api.patch<CandidateDetail>(`/candidates/${candidateId}/certifications/${certification.id}`, body)
        : api.post<CandidateDetail>(`/candidates/${candidateId}/certifications`, body);
    },
    onSuccess: () => {
      invalidate();
      toast.success(certification ? 'Certification updated' : 'Certification added');
      setOpen(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{certification ? 'Edit certification' : 'Add certification'}</DialogTitle>
          <DialogDescription>Professional certifications and the credentials behind them.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-4">
          <fieldset disabled={save.isPending} className="space-y-4">
            {form.formState.errors.root ? (
              <p className="text-xs text-destructive">{form.formState.errors.root.message}</p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-name`}>Name</Label>
                <Input id={`${fieldId}-name`} placeholder="AWS Solutions Architect" {...form.register('name')} />
                <FieldError message={form.formState.errors.name?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-issuer`}>Issuer</Label>
                <Input id={`${fieldId}-issuer`} {...form.register('issuer')} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-issued`}>Issued</Label>
                <Input id={`${fieldId}-issued`} type="date" {...form.register('issuedAt')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-expires`}>Expires</Label>
                <Input id={`${fieldId}-expires`} type="date" {...form.register('expiresAt')} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-credential-id`}>Credential ID</Label>
                <Input id={`${fieldId}-credential-id`} {...form.register('credentialId')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-credential-url`}>Credential URL</Label>
                <Input id={`${fieldId}-credential-url`} type="url" {...form.register('credentialUrl')} />
                <FieldError message={form.formState.errors.credentialUrl?.message} />
              </div>
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {certification ? 'Save' : 'Add certification'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Language editor
// ---------------------------------------------------------------------------

const EMPTY_LANGUAGE: LanguageFormValues = { name: '', proficiency: 'PROFESSIONAL' };

function LanguageDialog({
  candidateId,
  language,
  trigger,
}: {
  candidateId: string;
  language?: CandidateLanguage;
  trigger: ReactNode;
}) {
  const invalidate = useInvalidateCandidate();
  const [open, setOpen] = useState(false);
  const fieldId = useId();

  const form = useForm<LanguageFormValues>({
    resolver: zodResolver(languageFormSchema),
    defaultValues: EMPTY_LANGUAGE,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(language ? { name: language.name, proficiency: language.proficiency } : EMPTY_LANGUAGE);
  }, [open, language, form]);

  const save = useMutation({
    mutationFn: (values: LanguageFormValues) => {
      const body = { name: values.name, proficiency: values.proficiency };
      return language
        ? api.patch<CandidateDetail>(`/candidates/${candidateId}/languages/${language.id}`, body)
        : api.post<CandidateDetail>(`/candidates/${candidateId}/languages`, body);
    },
    onSuccess: () => {
      invalidate();
      toast.success(language ? 'Language updated' : 'Language added');
      setOpen(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{language ? 'Edit language' : 'Add language'}</DialogTitle>
          <DialogDescription>Spoken languages and proficiency levels.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-4">
          <fieldset disabled={save.isPending} className="space-y-4">
            {form.formState.errors.root ? (
              <p className="text-xs text-destructive">{form.formState.errors.root.message}</p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-name`}>Language</Label>
              <Input id={`${fieldId}-name`} placeholder="Spanish" {...form.register('name')} />
              <FieldError message={form.formState.errors.name?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-proficiency`}>Proficiency</Label>
              <Select
                value={form.watch('proficiency')}
                onValueChange={(value) =>
                  form.setValue('proficiency', value as LanguageFormValues['proficiency'], { shouldDirty: true })
                }
              >
                <SelectTrigger id={`${fieldId}-proficiency`} aria-label="Proficiency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {skillProficiencySchema.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {SKILL_PROFICIENCY_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {language ? 'Save' : 'Add language'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Section cards
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: typeof Mail;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmailsCard({ candidate, canEdit }: { candidate: CandidateDetail; canEdit: boolean }) {
  return (
    <SectionCard
      title="Emails"
      icon={Mail}
      action={
        canEdit ? (
          <EmailDialog
            candidateId={candidate.id}
            trigger={
              <Button variant="outline" size="sm">
                <Plus className="size-4" aria-hidden="true" />
                Add
              </Button>
            }
          />
        ) : null
      }
    >
      {candidate.emails.length === 0 ? (
        <p className="text-sm text-muted-foreground">No email addresses on file.</p>
      ) : (
        <ul className="divide-y divide-border">
          {candidate.emails.map((email) => (
            <li key={email.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm">{email.address}</p>
                <p className="text-xs text-muted-foreground">{email.label ?? 'Email'}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {email.isPrimary ? <Badge variant="default">Primary</Badge> : null}
                {canEdit ? (
                  <>
                    <EmailDialog
                      candidateId={candidate.id}
                      email={email}
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${email.address}`}>
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </Button>
                      }
                    />
                    <RemoveSubResource
                      candidateId={candidate.id}
                      path={`/emails/${email.id}`}
                      label="Email"
                    />
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function PhonesCard({ candidate, canEdit }: { candidate: CandidateDetail; canEdit: boolean }) {
  return (
    <SectionCard
      title="Phone numbers"
      icon={Phone}
      action={
        canEdit ? (
          <PhoneDialog
            candidateId={candidate.id}
            trigger={
              <Button variant="outline" size="sm">
                <Plus className="size-4" aria-hidden="true" />
                Add
              </Button>
            }
          />
        ) : null
      }
    >
      {candidate.phones.length === 0 ? (
        <p className="text-sm text-muted-foreground">No phone numbers on file.</p>
      ) : (
        <ul className="divide-y divide-border">
          {candidate.phones.map((phone) => (
            <li key={phone.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm">{phone.number}</p>
                <p className="text-xs text-muted-foreground">{phone.label ?? 'Phone'}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {phone.isPrimary ? <Badge variant="default">Primary</Badge> : null}
                {canEdit ? (
                  <>
                    <PhoneDialog
                      candidateId={candidate.id}
                      phone={phone}
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${phone.number}`}>
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </Button>
                      }
                    />
                    <RemoveSubResource
                      candidateId={candidate.id}
                      path={`/phones/${phone.id}`}
                      label="Phone"
                    />
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ExperiencesCard({
  candidate,
  canEdit,
  timezone,
}: {
  candidate: CandidateDetail;
  canEdit: boolean;
  timezone?: string;
}) {
  return (
    <SectionCard
      title="Experience"
      icon={Sparkles}
      action={
        canEdit ? (
          <ExperienceDialog
            candidateId={candidate.id}
            trigger={
              <Button variant="outline" size="sm">
                <Plus className="size-4" aria-hidden="true" />
                Add
              </Button>
            }
          />
        ) : null
      }
    >
      {candidate.experiences.length === 0 ? (
        <p className="text-sm text-muted-foreground">No work history recorded yet.</p>
      ) : (
        <ol className="space-y-4">
          {candidate.experiences.map((experience) => (
            <li key={experience.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  {experience.title}
                  {experience.isCurrent ? <Badge variant="success">Current</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {experience.company}
                  {experience.location ? ` · ${experience.location}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(experience.startDate, 'MMM YYYY', timezone)} –{' '}
                  {experience.isCurrent || !experience.endDate
                    ? 'Present'
                    : formatDate(experience.endDate, 'MMM YYYY', timezone)}
                </p>
                {experience.skills.length > 0 ? (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {experience.skills.map((skill) => (
                      <Badge key={skill} variant="muted">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {experience.description ? (
                  <p className="whitespace-pre-wrap pt-1 text-sm text-muted-foreground">
                    {experience.description}
                  </p>
                ) : null}
              </div>
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                  <ExperienceDialog
                    candidateId={candidate.id}
                    experience={experience}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${experience.title} at ${experience.company}`}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                    }
                  />
                  <RemoveSubResource
                    candidateId={candidate.id}
                    path={`/experiences/${experience.id}`}
                    label="Experience"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

function EducationsCard({
  candidate,
  canEdit,
  timezone,
}: {
  candidate: CandidateDetail;
  canEdit: boolean;
  timezone?: string;
}) {
  return (
    <SectionCard
      title="Education"
      icon={GraduationCap}
      action={
        canEdit ? (
          <EducationDialog
            candidateId={candidate.id}
            trigger={
              <Button variant="outline" size="sm">
                <Plus className="size-4" aria-hidden="true" />
                Add
              </Button>
            }
          />
        ) : null
      }
    >
      {candidate.educations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No education recorded yet.</p>
      ) : (
        <ul className="space-y-4">
          {candidate.educations.map((education) => (
            <li key={education.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">{education.institution}</p>
                <p className="text-xs text-muted-foreground">
                  {[education.degree, education.fieldOfStudy].filter(Boolean).join(' · ') || '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(education.startDate, 'MMM YYYY', timezone)} –{' '}
                  {education.endDate ? formatDate(education.endDate, 'MMM YYYY', timezone) : 'Present'}
                  {education.grade ? ` · ${education.grade}` : ''}
                </p>
              </div>
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                  <EducationDialog
                    candidateId={candidate.id}
                    education={education}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${education.institution}`}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                    }
                  />
                  <RemoveSubResource
                    candidateId={candidate.id}
                    path={`/educations/${education.id}`}
                    label="Education"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function SkillsCard({ candidate, canEdit }: { candidate: CandidateDetail; canEdit: boolean }) {
  return (
    <SectionCard title="Skills" icon={Sparkles}>
      {candidate.candidateSkills.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No skills on file. They are added from résumé parsing or the workspace catalogue.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {candidate.candidateSkills.map((skill) => (
            <li
              key={skill.skillId}
              className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm">
                  {skill.name}
                  {skill.isPrimary ? <Badge variant="default">Primary</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    skill.years === null ? null : `${skill.years} yrs`,
                    skill.level === null ? null : `Level ${skill.level}/5`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'No proficiency recorded'}
                </p>
              </div>
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                  <SkillDialog
                    candidateId={candidate.id}
                    skill={skill}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${skill.name}`}>
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                    }
                  />
                  <RemoveSubResource
                    candidateId={candidate.id}
                    path={`/skills/${skill.skillId}`}
                    label="Skill"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function CertificationsCard({ candidate, canEdit }: { candidate: CandidateDetail; canEdit: boolean }) {
  return (
    <SectionCard
      title="Certifications"
      icon={Award}
      action={
        canEdit ? (
          <CertificationDialog
            candidateId={candidate.id}
            trigger={
              <Button variant="outline" size="sm">
                <Plus className="size-4" aria-hidden="true" />
                Add
              </Button>
            }
          />
        ) : null
      }
    >
      {candidate.certifications.length === 0 ? (
        <p className="text-sm text-muted-foreground">No certifications on file.</p>
      ) : (
        <ul className="divide-y divide-border">
          {candidate.certifications.map((certification) => {
            const url = safeHttpUrl(certification.credentialUrl);
            return (
              <li
                key={certification.id}
                className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{certification.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {certification.issuer ?? '—'}
                    {certification.issuedAt ? ` · issued ${new Date(certification.issuedAt).getFullYear()}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {url ? (
                    <Button asChild variant="ghost" size="icon-sm" aria-label={`Open ${certification.name} credential`}>
                      <a href={url} target="_blank" rel="noreferrer noopener">
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </a>
                    </Button>
                  ) : null}
                  {canEdit ? (
                    <>
                      <CertificationDialog
                        candidateId={candidate.id}
                        certification={certification}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${certification.name}`}
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </Button>
                        }
                      />
                      <RemoveSubResource
                        candidateId={candidate.id}
                        path={`/certifications/${certification.id}`}
                        label="Certification"
                      />
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function LanguagesCard({ candidate, canEdit }: { candidate: CandidateDetail; canEdit: boolean }) {
  return (
    <SectionCard
      title="Languages"
      icon={LanguagesIcon}
      action={
        canEdit ? (
          <LanguageDialog
            candidateId={candidate.id}
            trigger={
              <Button variant="outline" size="sm">
                <Plus className="size-4" aria-hidden="true" />
                Add
              </Button>
            }
          />
        ) : null
      }
    >
      {candidate.languages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No languages on file.</p>
      ) : (
        <ul className="divide-y divide-border">
          {candidate.languages.map((language) => (
            <li
              key={language.id}
              className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">{language.name}</p>
                <p className="text-xs text-muted-foreground">
                  {SKILL_PROFICIENCY_LABELS[language.proficiency]}
                </p>
              </div>
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                  <LanguageDialog
                    candidateId={candidate.id}
                    language={language}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${language.name}`}>
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                    }
                  />
                  <RemoveSubResource
                    candidateId={candidate.id}
                    path={`/languages/${language.id}`}
                    label="Language"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ProfileCard({ candidate, timezone }: { candidate: CandidateDetail; timezone?: string }) {
  const location =
    [candidate.locationCity, candidate.locationState, candidate.locationCountry].filter(Boolean).join(', ') ||
    candidate.location ||
    '—';

  const links = [
    { label: 'LinkedIn', href: safeHttpUrl(candidate.linkedinUrl) },
    { label: 'GitHub', href: safeHttpUrl(candidate.githubUrl) },
    { label: 'Portfolio', href: safeHttpUrl(candidate.portfolioUrl) },
    { label: 'Website', href: safeHttpUrl(candidate.websiteUrl) },
  ].filter((entry): entry is { label: string; href: string } => entry.href !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {candidate.headline ? <p className="text-sm font-medium">{candidate.headline}</p> : null}
        {candidate.summary ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{candidate.summary}</p>
        ) : null}

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="Current title">{orDash(candidate.currentTitle)}</DetailField>
          <DetailField label="Current company">{orDash(candidate.currentCompany)}</DetailField>
          <DetailField label="Location">{location}</DetailField>
          <DetailField label="Experience level">
            {candidate.experienceLevel
              ? (EXPERIENCE_LEVEL_LABELS[candidate.experienceLevel] ?? candidate.experienceLevel)
              : '—'}
          </DetailField>
          <DetailField label="Total experience">{months(candidate.totalExperienceMonths)}</DetailField>
          <DetailField label="Relevant experience">{months(candidate.relevantExperienceMonths)}</DetailField>
          <DetailField label="Work authorization">
            {WORK_AUTHORIZATION_LABELS[candidate.workAuthorization]}
          </DetailField>
          <DetailField label="Availability">
            {candidate.availability ? AVAILABILITY_LABELS[candidate.availability] : '—'}
          </DetailField>
          <DetailField label="Notice period">
            {candidate.noticePeriodDays === null ? '—' : `${candidate.noticePeriodDays} days`}
          </DetailField>
          <DetailField label="Expected salary">
            {money(candidate.expectedSalaryCents, candidate.expectedSalaryCurrency)}
          </DetailField>
          <DetailField label="Current salary">{money(candidate.currentSalaryCents, null)}</DetailField>
          <DetailField label="Expected rate">
            {rate(candidate.expectedRateCents, candidate.rateCurrency, candidate.ratePeriod)}
          </DetailField>
          <DetailField label="Current rate">
            {rate(candidate.currentRateCents, candidate.rateCurrency, candidate.ratePeriod)}
          </DetailField>
          <DetailField label="Willing to relocate">{candidate.willingToRelocate ? 'Yes' : 'No'}</DetailField>
          <DetailField label="Source">
            {CANDIDATE_SOURCE_LABELS[candidate.source]}
            {candidate.sourceDetail ? ` · ${candidate.sourceDetail}` : ''}
          </DetailField>
          <DetailField label="Status">{CANDIDATE_STATUS_LABELS[candidate.status]}</DetailField>
          <DetailField label="Added">
            {formatDate(candidate.createdAt, 'DD MMM YYYY', timezone)}
          </DetailField>
        </dl>

        {links.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {links.map((entry) => (
              <Button key={entry.label} asChild variant="outline" size="sm">
                <a href={entry.href} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="size-4" aria-hidden="true" />
                  {entry.label}
                </a>
              </Button>
            ))}
          </div>
        ) : null}

        {candidate.tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-4">
            {candidate.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function HotlistsCard({ candidate }: { candidate: CandidateDetail }) {
  return (
    <SectionCard title="Hotlists" icon={Sparkles}>
      {candidate.lists.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not on any hotlist or talent pool yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {candidate.lists.map((list) => (
            <Badge key={list.id} variant="outline">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: list.color ?? 'currentColor' }}
                aria-hidden="true"
              />
              {list.name}
            </Badge>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Tab content
// ---------------------------------------------------------------------------

function OverviewTab({ candidate, canEdit, canViewPii }: { candidate: CandidateDetail; canEdit: boolean; canViewPii: boolean }) {
  const { tenant } = useSession();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4 lg:col-span-2">
        <ProfileCard candidate={candidate} timezone={tenant?.timezone} />
      </div>

      {canViewPii ? (
        <>
          <EmailsCard candidate={candidate} canEdit={canEdit} />
          <PhonesCard candidate={candidate} canEdit={canEdit} />
        </>
      ) : (
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="flex items-center gap-3 pt-5">
              <ShieldOff className="size-4 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                Contact details are hidden. Ask a workspace administrator for the “View PII”
                permission.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <ExperiencesCard candidate={candidate} canEdit={canEdit} timezone={tenant?.timezone} />
      <EducationsCard candidate={candidate} canEdit={canEdit} timezone={tenant?.timezone} />
      <SkillsCard candidate={candidate} canEdit={canEdit} />
      <CertificationsCard candidate={candidate} canEdit={canEdit} />
      <LanguagesCard candidate={candidate} canEdit={canEdit} />
      <HotlistsCard candidate={candidate} />
    </div>
  );
}

function ResumeTab({ candidate }: { candidate: CandidateDetail }) {
  return <ResumePanel candidate={candidate} />;
}

function JobsTab({ candidate, timezone }: { candidate: CandidateDetail; timezone?: string }) {
  const { has } = useSession();
  const canSubmit = has('submission:send');

  if (candidate.applications.length === 0) {
    return (
      <EmptyState
        title="Not in any pipeline yet"
        description="When this candidate is added to a requisition, their applications appear here."
      />
    );
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <ul className="divide-y divide-border">
          {candidate.applications.map((application) => (
            <li key={application.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <Link
                  href={`/jobs/${application.jobId}`}
                  className="truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
                >
                  {application.jobTitle}
                </Link>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{application.jobReferenceCode}</span> · applied{' '}
                  {formatDate(application.appliedAt, 'DD MMM YYYY', timezone)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: application.stageColor }}
                    aria-hidden="true"
                  />
                  {application.stageName}
                </Badge>
                <Badge variant="muted">{humanizeEnum(application.status)}</Badge>
                {canSubmit ? (
                  <SubmitApplicationDialog
                    applicationId={application.id}
                    jobId={application.jobId}
                    candidateId={candidate.id}
                    trigger={
                      <Button variant="outline" size="sm">
                        Submit
                      </Button>
                    }
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'resume', label: 'Résumé' },
  { value: 'jobs', label: 'Jobs' },
  { value: 'activity', label: 'Activity' },
  { value: 'notes', label: 'Notes' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'attachments', label: 'Attachments' },
  { value: 'audit', label: 'Audit' },
] as const;

/** The eight-tab candidate workspace, with inline child-record editors. */
export function CandidateDetailTabs({ candidate }: { candidate: CandidateDetail }) {
  const { has } = useSession();
  const canEdit = has('candidate:update');
  const canViewPii = has('candidate:view_pii');

  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList className="h-auto flex-wrap">
        {TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="overview">
        <OverviewTab candidate={candidate} canEdit={canEdit} canViewPii={canViewPii} />
      </TabsContent>

      <TabsContent value="resume">
        <ResumeTab candidate={candidate} />
      </TabsContent>

      <TabsContent value="jobs">
        <JobsTab candidate={candidate} />
      </TabsContent>

      <TabsContent value="activity">
        <ActivityTimeline entityType="CANDIDATE" entityId={candidate.id} />
      </TabsContent>

      <TabsContent value="notes">
        <NotesPanel entityType="CANDIDATE" entityId={candidate.id} candidateId={candidate.id} />
      </TabsContent>

      <TabsContent value="tasks">
        <ActivityTimeline entityType="CANDIDATE" entityId={candidate.id} typeFilter={['TASK']} />
      </TabsContent>

      <TabsContent value="attachments">
        <EmptyState
          icon={Paperclip}
          title="No attachments"
          description="Attachments shared with this candidate will appear here."
        />
      </TabsContent>

      <TabsContent value="audit">
        <EmptyState
          icon={ShieldOff}
          title="Audit trail"
          description="A full change history for this record is available to administrators."
        />
      </TabsContent>
    </Tabs>
  );
}
