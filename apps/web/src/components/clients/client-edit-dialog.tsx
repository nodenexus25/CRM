'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import type { ClientDetail } from '@talentflow/types';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ClientForm } from '@/components/clients/client-form';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

interface ClientEditDialogProps {
  clientId: string;
  /** Prefetched on the detail page; the list rows let the dialog fetch it. */
  client?: ClientDetail;
  trigger: ReactNode;
}

/** Opens the client form in edit mode; the dialog owns its open state. */
export function ClientEditDialog({ clientId, client, trigger }: ClientEditDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: queryKeys.clients.detail(clientId),
    queryFn: () => api.get<ClientDetail>(`/clients/${clientId}`),
    enabled: open,
    initialData: client,
  });

  const current = client ?? detail.data;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit client</DialogTitle>
          <DialogDescription>
            Update the details for {current ? current.name : 'this client'}. Contacts are managed on
            the client page.
          </DialogDescription>
        </DialogHeader>

        {current ? (
          <ClientForm
            mode="edit"
            client={current}
            onSuccess={() => {
              void queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(clientId) });
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        ) : detail.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <p className="text-sm text-destructive">
            {detail.error instanceof Error ? detail.error.message : 'Could not load this client.'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
