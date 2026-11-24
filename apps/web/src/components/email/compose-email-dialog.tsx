'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Braces, Send } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  MERGE_FIELD_GROUPS,
  emailSchema,
  type EmailPreview,
  type EmailTemplateItem,
  type EntityType,
  type Paginated,
  type PreviewEmailRequest,
} from '@talentflow/types';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

/** Radix `Select` needs a concrete value for "write it from scratch". */
const NO_TEMPLATE = '__none__';

const PREVIEW_DEBOUNCE_MS = 400;

/** Splits a comma-, semicolon- or whitespace-separated string into addresses. */
function parseAddressList(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const composerSchema = z
  .object({
    templateId: z.string().trim().optional(),
    to: z.string().trim().optional(),
    cc: z.string().trim().optional(),
    bcc: z.string().trim().optional(),
    subject: z.string().trim().max(300).optional(),
    body: z.string().trim().max(50000).optional(),
  })
  .superRefine((value, ctx) => {
    const to = parseAddressList(value.to);
    if (to.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'Add at least one recipient',
      });
    } else {
      const invalid = to.find((address) => !emailSchema.safeParse(address).success);
      if (invalid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['to'],
          message: `“${invalid}” is not a valid email address`,
        });
      }
    }

    for (const field of ['cc', 'bcc'] as const) {
      const addresses = parseAddressList(value[field]);
      const invalid = addresses.find((address) => !emailSchema.safeParse(address).success);
      if (invalid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `“${invalid}” is not a valid email address`,
        });
      }
    }

    const hasTemplate = Boolean(value.templateId && value.templateId !== NO_TEMPLATE);
    const hasVerbatim = Boolean(value.subject && value.body);
    if (!hasTemplate && !hasVerbatim) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subject'],
        message: 'Pick a template, or write both a subject and a body.',
      });
    }
  });

type ComposerValues = z.infer<typeof composerSchema>;

const EMPTY_VALUES: ComposerValues = {
  templateId: '',
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  body: '',
};

interface ComposeEmailDialogProps {
  trigger: ReactNode;
  entityType: EntityType;
  entityId: string;
  candidateId?: string | null;
  jobId?: string | null;
  /** Pre-fills the To field, e.g. with a candidate's email. */
  defaultTo?: string;
}

/** Insert-at-end menu of the merge keys the server's renderer understands. */
function MergeFieldMenu({ label, onInsert }: { label: string; onInsert: (key: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
          <Braces className="size-3.5" aria-hidden="true" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
        {MERGE_FIELD_GROUPS.map((group, index) => (
          <DropdownMenuGroup key={group.label}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.fields.map((field) => (
              <DropdownMenuItem key={field.key} onSelect={() => onInsert(field.key)}>
                {field.label}
                <span className="ml-auto font-mono text-2xs text-muted-foreground">{field.key}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Compose and send a template-driven or ad-hoc email against any record, with a
 * debounced server-rendered preview so the sender sees the resolved merge fields
 * — and any the server could not fill in — before they hit send.
 */
export function ComposeEmailDialog({
  trigger,
  entityType,
  entityId,
  candidateId,
  jobId,
  defaultTo,
}: ComposeEmailDialogProps) {
  const { has } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [previewInput, setPreviewInput] = useState<PreviewEmailRequest | null>(null);

  const canSend = has('email:send');

  const form = useForm<ComposerValues>({
    resolver: zodResolver(composerSchema),
    defaultValues: EMPTY_VALUES,
  });

  const [templateId, subject, body] = useWatch({
    control: form.control,
    name: ['templateId', 'subject', 'body'],
  });

  const templates = useQuery({
    queryKey: queryKeys.emailTemplates.list({
      pageSize: 100,
      isActive: true,
      sortBy: 'name',
      sortDir: 'asc',
    }),
    queryFn: () =>
      api.get<Paginated<EmailTemplateItem>>('/email/templates', {
        query: { pageSize: 100, isActive: true, sortBy: 'name', sortDir: 'asc' },
      }),
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    form.reset({ ...EMPTY_VALUES, ...(defaultTo ? { to: defaultTo } : {}) });
  }, [defaultTo, form, open]);

  // Debounce the preview so a fast typist does not fire a render per keystroke.
  useEffect(() => {
    if (!open) {
      setPreviewInput(null);
      return;
    }
    const chosenTemplate = templateId && templateId !== NO_TEMPLATE ? templateId : undefined;
    const trimmedSubject = (subject ?? '').trim();
    const trimmedBody = (body ?? '').trim();

    if (!chosenTemplate && (!trimmedSubject || !trimmedBody)) {
      setPreviewInput(null);
      return;
    }

    const handle = setTimeout(() => {
      setPreviewInput({
        ...(chosenTemplate ? { templateId: chosenTemplate } : {}),
        ...(trimmedSubject ? { subject: trimmedSubject } : {}),
        ...(trimmedBody ? { body: trimmedBody } : {}),
        entityType,
        entityId,
        ...(candidateId ? { candidateId } : {}),
        ...(jobId ? { jobId } : {}),
      });
    }, PREVIEW_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [open, templateId, subject, body, entityType, entityId, candidateId, jobId]);

  const preview = useQuery({
    queryKey: ['email-preview', previewInput] as const,
    queryFn: () => {
      if (!previewInput) return Promise.reject(new Error('Nothing to preview'));
      return api.post<EmailPreview>('/email/preview', previewInput);
    },
    enabled: open && previewInput !== null,
    staleTime: 5_000,
    retry: false,
  });

  const send = useMutation({
    mutationFn: (values: ComposerValues) => {
      const chosenTemplate =
        values.templateId && values.templateId !== NO_TEMPLATE ? values.templateId : undefined;
      const trimmedSubject = (values.subject ?? '').trim();
      const trimmedBody = (values.body ?? '').trim();

      return api.post('/email/send', {
        to: parseAddressList(values.to),
        cc: parseAddressList(values.cc),
        bcc: parseAddressList(values.bcc),
        ...(chosenTemplate ? { templateId: chosenTemplate } : {}),
        ...(trimmedSubject ? { subject: trimmedSubject } : {}),
        ...(trimmedBody ? { body: trimmedBody } : {}),
        entityType,
        entityId,
        ...(candidateId ? { candidateId } : {}),
        ...(jobId ? { jobId } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.emailMessages.all });
      toast.success('Email sent');
      setOpen(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  function applyTemplate(value: string) {
    form.setValue('templateId', value, { shouldDirty: true });
    const template = (templates.data?.items ?? []).find((item) => item.id === value);
    if (template) {
      form.setValue('subject', template.subject, { shouldDirty: true });
      form.setValue('body', template.body, { shouldDirty: true });
    }
  }

  function insertMergeField(field: 'subject' | 'body', key: string) {
    const token = `{{ ${key} }}`;
    const current = form.getValues(field) ?? '';
    const spacer = current.length > 0 && !current.endsWith(' ') ? ' ' : '';
    form.setValue(field, `${current}${spacer}${token}`, { shouldDirty: true });
  }

  if (!canSend) return null;

  const rootError = form.formState.errors.root?.message;
  const submitting = send.isPending;
  const selectedTemplate = templateId && templateId !== NO_TEMPLATE ? templateId : NO_TEMPLATE;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compose email</DialogTitle>
          <DialogDescription>
            Pick a template or write from scratch. Merge fields are resolved by the server.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => send.mutate(values))}
          className="space-y-4"
        >
          <fieldset disabled={submitting} className="space-y-4">
            {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

            <div className="space-y-1.5">
              <Label htmlFor="compose-template">Template</Label>
              <Select value={selectedTemplate} onValueChange={applyTemplate}>
                <SelectTrigger id="compose-template" aria-label="Email template">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEMPLATE}>No template</SelectItem>
                  {(templates.data?.items ?? []).map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="compose-to">To</Label>
                <Input id="compose-to" placeholder="name@example.com" {...form.register('to')} />
                {form.formState.errors.to ? (
                  <p className="text-xs text-destructive">{form.formState.errors.to.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="compose-cc">Cc</Label>
                <Input id="compose-cc" {...form.register('cc')} />
                {form.formState.errors.cc ? (
                  <p className="text-xs text-destructive">{form.formState.errors.cc.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="compose-bcc">Bcc</Label>
                <Input id="compose-bcc" {...form.register('bcc')} />
                {form.formState.errors.bcc ? (
                  <p className="text-xs text-destructive">{form.formState.errors.bcc.message}</p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="compose-subject">Subject</Label>
                    <MergeFieldMenu
                      label="Insert field"
                      onInsert={(key) => insertMergeField('subject', key)}
                    />
                  </div>
                  <Input id="compose-subject" {...form.register('subject')} />
                  {form.formState.errors.subject ? (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.subject.message}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="compose-body">Body</Label>
                    <MergeFieldMenu
                      label="Insert field"
                      onInsert={(key) => insertMergeField('body', key)}
                    />
                  </div>
                  <Textarea id="compose-body" rows={10} {...form.register('body')} />
                </div>
              </div>

              <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  Preview
                </p>
                {previewInput === null ? (
                  <p className="text-sm text-muted-foreground">
                    Pick a template or write a subject and body to preview the resolved email.
                  </p>
                ) : preview.isPending ? (
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-32 w-full" />
                  </div>
                ) : preview.isError ? (
                  <p className="text-sm text-muted-foreground">
                    Preview unavailable.{' '}
                    {preview.error instanceof Error ? preview.error.message : ''}
                  </p>
                ) : preview.data ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">{preview.data.subject || '(no subject)'}</p>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {preview.data.body}
                    </p>
                    {preview.data.missingFields.length > 0 ? (
                      <Alert variant="destructive">
                        <AlertDescription>
                          Missing merge fields:{' '}
                          <span className="font-mono">
                            {preview.data.missingFields.join(', ')}
                          </span>
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              <Send className="size-4" aria-hidden="true" />
              Send email
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
