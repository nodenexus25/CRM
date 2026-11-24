'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  CLIENT_STATUS_LABELS,
  clientStatusSchema,
  type ClientDetail,
  type ClientListItem,
  type ClientStatus,
} from '@talentflow/types';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ClientEditDialog } from '@/components/clients/client-edit-dialog';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

/** Every status other than the current one — clients have no transition rules. */
function statusOptions(current: ClientStatus): ClientStatus[] {
  return clientStatusSchema.options.filter((status) => status !== current);
}

/** Status / delete writes shared by the row menu and the header actions. */
function useClientMutations(clientId: string, onDeleted?: () => void) {
  const queryClient = useQueryClient();

  const changeStatus = useMutation({
    mutationFn: (status: ClientStatus) => api.patch<ClientDetail>(`/clients/${clientId}`, { status }),
    onSuccess: (client) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
      toast.success(`${client.name} is now ${CLIENT_STATUS_LABELS[client.status].toLowerCase()}`);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not change the status');
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete<{ deleted: true }>(`/clients/${clientId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
      toast.success('Client deleted');
      onDeleted?.();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete this client');
    },
  });

  return { changeStatus, remove };
}

function StatusItems({
  statuses,
  onSelect,
}: {
  statuses: readonly ClientStatus[];
  onSelect: (status: ClientStatus) => void;
}) {
  return (
    <>
      {statuses.map((status) => (
        <DropdownMenuItem key={status} onSelect={() => onSelect(status)}>
          {CLIENT_STATUS_LABELS[status]}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** The "⋯" menu on a clients list row. */
export function ClientRowActionsMenu({ client }: { client: ClientListItem }) {
  const { has } = useSession();
  const mutations = useClientMutations(client.id);
  const statuses = statusOptions(client.status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${client.name}`}>
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{client.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href={`/clients/${client.id}`}>View client</Link>
        </DropdownMenuItem>

        {has('client:update') ? (
          <ClientEditDialog
            clientId={client.id}
            trigger={
              <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </DropdownMenuItem>
            }
          />
        ) : null}

        {has('client:update') && statuses.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ArrowRightLeft className="size-4" aria-hidden="true" />
              Change status
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <StatusItems statuses={statuses} onSelect={(status) => mutations.changeStatus.mutate(status)} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}

        {has('client:delete') ? (
          <>
            <DropdownMenuSeparator />
            <ConfirmDialog
              destructive
              title={`Delete ${client.name}?`}
              description="The client is removed from every list. Its jobs, contacts and placements are retained."
              confirmLabel="Delete client"
              trigger={
                <DialogTrigger asChild>
                  <DropdownMenuItem destructive onSelect={(event) => event.preventDefault()}>
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete
                  </DropdownMenuItem>
                </DialogTrigger>
              }
              onConfirm={() => mutations.remove.mutateAsync().then(() => undefined)}
            />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The status / edit / delete actions on the client detail header. */
export function ClientHeaderActions({ client }: { client: ClientDetail }) {
  const { has } = useSession();
  const router = useRouter();
  const mutations = useClientMutations(client.id, () => router.push('/clients'));
  const statuses = statusOptions(client.status);

  return (
    <>
      {has('client:update') && statuses.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <ArrowRightLeft className="size-4" aria-hidden="true" />
              Status
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            <StatusItems statuses={statuses} onSelect={(status) => mutations.changeStatus.mutate(status)} />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {has('client:update') ? (
        <ClientEditDialog
          clientId={client.id}
          client={client}
          trigger={
            <Button variant="outline" size="sm">
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          }
        />
      ) : null}

      {has('client:delete') ? (
        <ConfirmDialog
          destructive
          title={`Delete ${client.name}?`}
          description="The client is removed from every list. Its jobs, contacts and placements are retained."
          confirmLabel="Delete client"
          trigger={
            <Button variant="outline" size="sm" className="text-destructive">
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </Button>
          }
          onConfirm={() => mutations.remove.mutateAsync().then(() => undefined)}
        />
      ) : null}
    </>
  );
}
