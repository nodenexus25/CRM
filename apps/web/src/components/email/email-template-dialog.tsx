'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  EMAIL_TEMPLATE_CATEGORIES,
  createEmailTemplateSchema,
  extractMergeFields,
  isMergeField,
  type EmailTemplateItem,
} from '@talentflow/types';
import { humanizeEnum } from '@talentflow/ui';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
 * The form reuses the create schema's constraints; `category` and `isActive`
 * have their defaults stripped because the form seeds them from `defaultValues`,
 * and `htmlBody` is held as a plain optional string.
 */
const templateFormSchema = z.object({
  name: createEmailTemplateSchema.shape.name,
  key: createEmailTemplateSchema.shape.key,
  category: createEmailTemplateSchema.shape.category.removeDefault(),
  subject: createEmailTemplateSchema.shape.subject,
  body: createEmailTemplateSchema.shape.body,
  htmlBody: z.string().trim().max(100000).optional(),
  isActive: createEmailTemplateSchema.shape.isActive.removeDefault(),
});

type TemplateFormValues = z.infer<typeof templateFormSchema>;

const EMPTY: TemplateFormValues = {
  name: '',
  key: '',
  category: 'GENERAL',
  subject: '',
  body: '',
  htmlBody: '',
  isActive: true,
};

interface EmailTemplateDialogProps {
  mode?: 'create' | 'edit';
  template?: EmailTemplateItem;
  trigger: ReactNode;
}

/** Creates a template, or edits an existing one (the key is immutable). */
export function EmailTemplateDialog({ mode = 'create', template, trigger }: EmailTemplateDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const isEdit = mode === 'edit' && Boolean(template);

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    if (isEdit && template) {
      form.reset({
        name: template.name,
        key: template.key,
        category: template.category,
        subject: template.subject,
        body: template.body,
        htmlBody: template.htmlBody ?? '',
        isActive: template.isActive,
      });
    } else {
      form.reset(EMPTY);
    }
  }, [form, isEdit, open, template]);

  const save = useMutation({
    mutationFn: (values: TemplateFormValues) => {
      const htmlBody = (values.htmlBody ?? '').trim();
      const payload = {
        name: values.name,
        subject: values.subject,
        body: values.body,
        category: values.category,
        htmlBody: htmlBody.length > 0 ? htmlBody : null,
        isActive: values.isActive,
      };

      return isEdit && template
        ? api.patch<EmailTemplateItem>(`/email/templates/${template.id}`, payload)
        : api.post<EmailTemplateItem>('/email/templates', { ...payload, key: values.key });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.emailTemplates.all });
      toast.success(isEdit ? `${saved.name} updated` : `${saved.name} created`);
      setOpen(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;
  const submitting = save.isPending;
  const detected = extractMergeFields(form.watch('subject') ?? '', form.watch('body') ?? '');
  const unknownFields = detected.filter((key) => !isMergeField(key));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${template?.name}` : 'New email template'}</DialogTitle>
          <DialogDescription>
            Templates can reference merge fields such as{' '}
            <span className="font-mono">{'{{ candidate.firstName }}'}</span>, which the server
            resolves when the email is sent.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          className="space-y-4"
        >
          <fieldset disabled={submitting} className="space-y-4">
            {rootError ? (
              <Alert variant="destructive">
                <AlertDescription>{rootError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="template-name">Name</Label>
                <Input id="template-name" placeholder="Interview invitation" {...form.register('name')} />
                {form.formState.errors.name ? (
                  <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="template-key">Key</Label>
                  <span className="text-2xs text-muted-foreground">
                    {isEdit ? 'Fixed' : 'Stable identifier'}
                  </span>
                </div>
                <Input
                  id="template-key"
                  className="font-mono"
                  placeholder="candidate.outreach"
                  disabled={isEdit}
                  {...form.register('key')}
                />
                {form.formState.errors.key ? (
                  <p className="text-xs text-destructive">{form.formState.errors.key.message}</p>
                ) : (
                  <p className="text-2xs text-muted-foreground">Lower-case; it cannot change later.</p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="template-category">Category</Label>
                <Select
                  value={form.watch('category')}
                  onValueChange={(value) =>
                    form.setValue('category', value as TemplateFormValues['category'], {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger id="template-category" aria-label="Category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMAIL_TEMPLATE_CATEGORIES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {humanizeEnum(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Label className="flex cursor-pointer items-center gap-3 text-sm font-normal">
                  <Switch
                    checked={form.watch('isActive')}
                    onCheckedChange={(checked) =>
                      form.setValue('isActive', checked, { shouldDirty: true })
                    }
                    aria-label="Template is active"
                  />
                  Active (available when composing)
                </Label>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="template-subject">Subject</Label>
              <Input
                id="template-subject"
                placeholder="Interview invitation for {{ job.title }}"
                {...form.register('subject')}
              />
              {form.formState.errors.subject ? (
                <p className="text-xs text-destructive">{form.formState.errors.subject.message}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="template-body">Body</Label>
              <Textarea id="template-body" rows={8} {...form.register('body')} />
              {form.formState.errors.body ? (
                <p className="text-xs text-destructive">{form.formState.errors.body.message}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="template-html">HTML body (optional)</Label>
              <Textarea
                id="template-html"
                rows={4}
                className="font-mono text-xs"
                {...form.register('htmlBody')}
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Detected merge fields</p>
              {detected.length === 0 ? (
                <p className="text-2xs text-muted-foreground">
                  None yet. Reference a field as{' '}
                  <span className="font-mono">{'{{ candidate.fullName }}'}</span>.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {detected.map((key) => (
                    <Badge key={key} variant={isMergeField(key) ? 'secondary' : 'destructive'}>
                      <span className="font-mono">{key}</span>
                    </Badge>
                  ))}
                </div>
              )}
              {unknownFields.length > 0 ? (
                <p className="text-2xs text-destructive">
                  {unknownFields.length === 1 ? 'That field is' : 'Those fields are'} not recognised
                  and will be left as-is: {unknownFields.join(', ')}.
                </p>
              ) : null}
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={submitting}
              disabled={
                form.watch('name').trim().length === 0 ||
                form.watch('subject').trim().length === 0 ||
                form.watch('body').trim().length === 0
              }
            >
              {isEdit ? 'Save changes' : 'Create template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
