'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  createClientContactSchema,
  emailSchema,
  phoneSchema,
  type ClientContactItem,
} from '@talentflow/types';

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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';

/**
 * Same trick as the client form: the API schema's optional e-mail/phone accept
 * `null`, so the form collects `''` and narrows on submit, while the field
 * constraints are reused verbatim.
 */
const contactFormSchema = z.object({
  firstName: createClientContactSchema.shape.firstName,
  lastName: createClientContactSchema.shape.lastName,
  email: z.union([emailSchema, z.literal('')]),
  phone: z.union([phoneSchema, z.literal('')]),
  title: z.string().trim().max(120),
  department: z.string().trim().max(120),
  isPrimary: z.boolean(),
  notes: z.string().trim().max(2000),
});

type ContactFormValues = z.infer<typeof contactFormSchema>;

const EMPTY_VALUES: ContactFormValues = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  title: '',
  department: '',
  isPrimary: false,
  notes: '',
};

function defaultsFromContact(contact: ClientContactItem): ContactFormValues {
  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    title: contact.title ?? '',
    department: contact.department ?? '',
    isPrimary: contact.isPrimary,
    notes: contact.notes ?? '',
  };
}

interface ClientContactDialogProps {
  clientId: string;
  /** Present when editing; omitted when adding a new contact. */
  contact?: ClientContactItem;
  trigger: ReactNode;
}

/** Add or edit a single contact on a client. */
export function ClientContactDialog({ clientId, contact, trigger }: ClientContactDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(contact ? defaultsFromContact(contact) : EMPTY_VALUES);
  }, [open, contact, form]);

  const save = useMutation({
    mutationFn: (values: ContactFormValues) => {
      const payload = {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email || null,
        phone: values.phone || null,
        title: values.title || null,
        department: values.department || null,
        isPrimary: values.isPrimary,
        notes: values.notes || null,
      };

      if (contact) {
        return api.patch<ClientContactItem>(`/contacts/${contact.id}`, payload);
      }
      return api.post<ClientContactItem>(`/clients/${clientId}/contacts`, payload);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(clientId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
      toast.success(`${saved.fullName} ${contact ? 'updated' : 'added'}`);
      setOpen(false);
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;
  const submitting = save.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{contact ? 'Edit contact' : 'Add contact'}</DialogTitle>
          <DialogDescription>
            {contact
              ? `Update the details for ${contact.fullName}.`
              : 'Record a person you reach out to at this client.'}
          </DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-4">
          <fieldset disabled={submitting} className="space-y-4">
            {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="contact-first-name">First name</Label>
                <Input id="contact-first-name" {...form.register('firstName')} />
                {form.formState.errors.firstName ? (
                  <p className="text-xs text-destructive">{form.formState.errors.firstName.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-last-name">Last name</Label>
                <Input id="contact-last-name" {...form.register('lastName')} />
                {form.formState.errors.lastName ? (
                  <p className="text-xs text-destructive">{form.formState.errors.lastName.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-title">Job title</Label>
                <Input id="contact-title" placeholder="Head of Engineering" {...form.register('title')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-department">Department</Label>
                <Input id="contact-department" placeholder="Engineering" {...form.register('department')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-email">Email</Label>
                <Input id="contact-email" type="email" {...form.register('email')} />
                {form.formState.errors.email ? (
                  <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-phone">Phone</Label>
                <Input id="contact-phone" {...form.register('phone')} />
                {form.formState.errors.phone ? (
                  <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
              <div className="space-y-0.5">
                <Label htmlFor="contact-primary">Primary contact</Label>
                <p className="text-xs text-muted-foreground">
                  The main point of contact for this account.
                </p>
              </div>
              <Switch
                id="contact-primary"
                checked={form.watch('isPrimary')}
                onCheckedChange={(checked) => form.setValue('isPrimary', checked, { shouldDirty: true })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contact-notes">Notes</Label>
              <Textarea
                id="contact-notes"
                rows={3}
                placeholder="Reporting line, best time to call, preferences…"
                {...form.register('notes')}
              />
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {contact ? 'Save changes' : 'Add contact'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
