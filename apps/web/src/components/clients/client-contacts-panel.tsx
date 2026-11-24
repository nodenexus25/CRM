'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, Pencil, Phone, Plus, Star, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';

import type { ClientContactItem, ClientDetail } from '@talentflow/types';
import { getInitials } from '@talentflow/ui';

import { ClientContactDialog } from '@/components/clients/client-contact-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogTrigger } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

/** Remove a contact; the API refuses while an open job still references it. */
function useRemoveContact(clientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (contactId: string) => api.delete<{ deleted: true }>(`/contacts/${contactId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(clientId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
      toast.success('Contact removed');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not remove this contact');
    },
  });
}

function ContactRow({ clientId, contact }: { clientId: string; contact: ClientContactItem }) {
  const { has } = useSession();
  const remove = useRemoveContact(clientId);

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback className="text-[10px]">{getInitials(contact.fullName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{contact.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {contact.title ?? 'No title'}
              {contact.department ? ` · ${contact.department}` : ''}
            </p>
          </div>
          {contact.isPrimary ? (
            <Badge variant="info" className="ml-1 gap-1">
              <Star className="size-3 fill-current" aria-hidden="true" />
              Primary
            </Badge>
          ) : null}
        </div>
      </TableCell>

      <TableCell>
        {contact.email ? (
          <a
            href={`mailto:${contact.email}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Mail className="size-3.5" aria-hidden="true" />
            {contact.email}
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell>
        {contact.phone ? (
          <a
            href={`tel:${contact.phone}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Phone className="size-3.5" aria-hidden="true" />
            {contact.phone}
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell className="w-20 text-right">
        <div className="flex items-center justify-end gap-1">
          {has('contact:update') ? (
            <ClientContactDialog
              clientId={clientId}
              contact={contact}
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${contact.fullName}`}>
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              }
            />
          ) : null}

          {has('contact:delete') ? (
            <ConfirmDialog
              destructive
              title={`Remove ${contact.fullName}?`}
              description="The contact is removed from this client. Jobs that still reference them keep their history."
              confirmLabel="Remove contact"
              trigger={
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    aria-label={`Remove ${contact.fullName}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </DialogTrigger>
              }
              onConfirm={() => remove.mutateAsync(contact.id).then(() => undefined)}
            />
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

/** The Contacts tab: everyone we talk to at this client. */
export function ClientContactsPanel({ client }: { client: ClientDetail }) {
  const { has } = useSession();
  const canCreate = has('contact:create');

  const addButton = canCreate ? (
    <ClientContactDialog
      clientId={client.id}
      trigger={
        <Button variant="outline" size="sm">
          <Plus className="size-4" aria-hidden="true" />
          Add contact
        </Button>
      }
    />
  ) : null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          Contacts
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {client.contacts.length}
          </span>
        </CardTitle>
        {addButton}
      </CardHeader>

      <CardContent>
        {client.contacts.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No contacts yet"
            description="Add the people you work with so submissions and interview invites have a named recipient."
            action={addButton ?? undefined}
          />
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="w-20 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {client.contacts.map((contact) => (
                  <ContactRow key={contact.id} clientId={client.id} contact={contact} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
