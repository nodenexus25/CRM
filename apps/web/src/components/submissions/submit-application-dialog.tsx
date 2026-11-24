'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Send } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  RESUME_PARSE_STATUS_LABELS,
  type ClientContactItem,
  type JobDetail,
  type Paginated,
  type ResumeDetail,
  type ResumeSummary,
  type SubmissionDetail,
} from '@talentflow/types';
import { formatBytes } from '@talentflow/ui';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

/** Radix `Select` cannot hold an empty value, so "nothing" needs a sentinel. */
const NO_CONTACT = '__no_contact__';
const NO_RESUME = '__no_resume__';

const submitFormSchema = z.object({
  contactId: z.string(),
  resumeId: z.string(),
  hideContact: z.boolean(),
  note: z.string().trim().max(2000),
});
type SubmitFormValues = z.infer<typeof submitFormSchema>;

const EMPTY_VALUES: SubmitFormValues = {
  contactId: NO_CONTACT,
  resumeId: NO_RESUME,
  hideContact: false,
  note: '',
};

interface SubmitApplicationDialogProps {
  applicationId: string;
  /** The requisition the application sits on; supplies the client and its contacts. */
  jobId: string;
  /** Whose résumés are offered as the tailored snapshot. */
  candidateId: string;
  /** Controlled open state; omit to use the internal state driven by `trigger`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  onSubmitted?: () => void;
}

/**
 * Send a candidate to the client.
 *
 * The recruiter picks the contact the submission is addressed to and, optionally,
 * a tailored résumé snapshot. The "hide contact details" switch records that the
 * candidate's own phone/e-mail were stripped from what went out, which is the
 * agency's guarantee against being cut out of the deal.
 */
export function SubmitApplicationDialog({
  applicationId,
  jobId,
  candidateId,
  open,
  onOpenChange,
  trigger,
  onSubmitted,
}: SubmitApplicationDialogProps) {
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const actualOpen = isControlled ? open : internalOpen;
  const downloadTabRef = useRef<Window | null>(null);

  const form = useForm<SubmitFormValues>({
    resolver: zodResolver(submitFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  const job = useQuery({
    queryKey: queryKeys.jobs.detail(jobId),
    queryFn: () => api.get<JobDetail>(`/jobs/${jobId}`),
    enabled: actualOpen,
    staleTime: 5 * 60_000,
  });
  const clientId = job.data?.client?.id ?? null;

  const contacts = useQuery({
    queryKey: queryKeys.clients.contacts(clientId ?? ''),
    queryFn: () => api.get<ClientContactItem[]>(`/clients/${clientId}/contacts`),
    enabled: actualOpen && clientId !== null,
    staleTime: 5 * 60_000,
  });

  const resumes = useQuery({
    queryKey: queryKeys.resumes.list({ candidateId }),
    queryFn: () =>
      api.get<Paginated<ResumeSummary>>('/resumes', {
        query: { candidateId, pageSize: 50, sortBy: 'createdAt' },
      }),
    enabled: actualOpen,
    staleTime: 5 * 60_000,
  });

  const contactOptions = contacts.data ?? [];
  const resumeOptions = resumes.data?.items ?? [];

  // Seed the pickers once their sources land: the job's named contact, and the
  // candidate's primary résumé (falling back to the most recent one).
  useEffect(() => {
    if (!actualOpen || !job.data) return;
    const list = contacts.data ?? [];
    const preferred = job.data.contact?.id ?? list.find((contact) => contact.isPrimary)?.id ?? NO_CONTACT;
    form.setValue('contactId', preferred);
  }, [actualOpen, job.data, contacts.data, form]);

  useEffect(() => {
    if (!actualOpen) return;
    const list = resumes.data?.items;
    if (!list?.length) return;
    const primary = list.find((resume) => resume.isPrimary) ?? list[0];
    if (!primary) return;
    form.setValue('resumeId', primary.id);
  }, [actualOpen, resumes.data, form]);

  useEffect(() => {
    if (!actualOpen) form.reset(EMPTY_VALUES);
  }, [actualOpen, form]);

  function handleOpenChange(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  const openResume = useMutation({
    mutationFn: (id: string) => api.get<ResumeDetail>(`/resumes/${id}`),
    onSuccess: (detail) => {
      const tab = downloadTabRef.current;
      downloadTabRef.current = null;
      if (!detail.downloadUrl) {
        tab?.close();
        toast.error('A preview link could not be generated for this résumé.');
        return;
      }
      if (tab) tab.location.href = detail.downloadUrl;
      else window.open(detail.downloadUrl, '_blank', 'noopener,noreferrer');
    },
    onError: (error: unknown) => {
      downloadTabRef.current?.close();
      downloadTabRef.current = null;
      toast.error(error instanceof Error ? error.message : 'Could not prepare the preview');
    },
  });

  function previewResume(id: string) {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    downloadTabRef.current = tab;
    openResume.mutate(id);
  }

  const submit = useMutation({
    mutationFn: (values: SubmitFormValues) =>
      api.post<SubmissionDetail>(`/applications/${applicationId}/submit`, {
        hideContact: values.hideContact,
        contactId: values.contactId === NO_CONTACT ? null : values.contactId,
        resumeId: values.resumeId === NO_RESUME ? null : values.resumeId,
        note: values.note || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.submissions.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      toast.success('Candidate submitted to the client');
      handleOpenChange(false);
      onSubmitted?.();
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;
  const selectedResumeId = form.watch('resumeId');
  const selectedResume = resumeOptions.find((resume) => resume.id === selectedResumeId) ?? null;
  const clientName = job.data?.client?.name ?? null;
  const loadingSources = job.isPending || resumes.isPending;

  return (
    <Dialog open={actualOpen} onOpenChange={handleOpenChange}>
      {trigger}
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit this candidate</DialogTitle>
          <DialogDescription>
            {clientName
              ? `Send ${job.data?.title ?? 'this candidate'} to ${clientName}. The client review journey starts now.`
              : 'This job is not linked to a client, so the submission will be recorded without an addressee.'}
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => submit.mutate(values))}
          className="space-y-4"
        >
          <fieldset disabled={submit.isPending} className="space-y-4">
            {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

            <div className="space-y-1.5">
              <Label htmlFor="submit-contact">Client contact</Label>
              <Select
                value={form.watch('contactId')}
                onValueChange={(value) => form.setValue('contactId', value, { shouldDirty: true })}
                disabled={clientId === null || contacts.isPending}
              >
                <SelectTrigger id="submit-contact" aria-label="Client contact">
                  <SelectValue placeholder="Choose a contact" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CONTACT}>No specific contact</SelectItem>
                  {contactOptions.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.fullName}
                      {contact.title ? ` · ${contact.title}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {clientId === null ? (
                <p className="text-xs text-muted-foreground">
                  Link a client to this job to choose a contact and send from a branded résumé.
                </p>
              ) : contacts.isError ? (
                <p className="text-xs text-destructive">Could not load contacts. Close and try again.</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="submit-resume">Résumé</Label>
              <Select
                value={form.watch('resumeId')}
                onValueChange={(value) => form.setValue('resumeId', value, { shouldDirty: true })}
                disabled={resumes.isPending}
              >
                <SelectTrigger id="submit-resume" aria-label="Résumé">
                  <SelectValue placeholder="Choose a résumé" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RESUME}>No résumé attached</SelectItem>
                  {resumeOptions.map((resume) => (
                    <SelectItem key={resume.id} value={resume.id}>
                      {resume.fileName}
                      {resume.isPrimary ? ' · primary' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedResume ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-xs font-medium">{selectedResume.fileName}</p>
                    <p className="text-2xs text-muted-foreground">
                      {formatBytes(selectedResume.sizeBytes)} · v{selectedResume.version} ·{' '}
                      {RESUME_PARSE_STATUS_LABELS[selectedResume.parseStatus]}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    loading={openResume.isPending}
                    onClick={() => previewResume(selectedResume.id)}
                  >
                    <Eye className="size-3.5" aria-hidden="true" />
                    Preview
                  </Button>
                </div>
              ) : resumes.isError ? (
                <p className="text-xs text-destructive">Could not load résumés. Close and try again.</p>
              ) : null}
            </div>

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
              <div className="space-y-0.5">
                <Label htmlFor="submit-hide-contact">Hide contact details</Label>
                <p className="text-xs text-muted-foreground">
                  Strip the candidate’s phone and e-mail from what the client receives.
                </p>
              </div>
              <Switch
                id="submit-hide-contact"
                checked={form.watch('hideContact')}
                onCheckedChange={(checked) =>
                  form.setValue('hideContact', checked, { shouldDirty: true })
                }
              />
            </div>

            {form.watch('hideContact') ? (
              <Badge variant="info">The client will not see the candidate’s direct contact details.</Badge>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="submit-note">Note to the client (optional)</Label>
              <Textarea
                id="submit-note"
                rows={3}
                placeholder="Why this candidate fits the brief…"
                {...form.register('note')}
              />
            </div>
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submit.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={submit.isPending} disabled={loadingSources}>
              <Send className="size-4" aria-hidden="true" />
              Submit to client
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
