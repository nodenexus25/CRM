'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Plus, ShieldOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { RejectionReasonItem } from '@talentflow/types';
import { cn } from '@talentflow/ui';

import { RejectionReasonDialog } from '@/components/pipeline/rejection-reason-dialog';
import { PageHeader } from '@/components/shell/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogTrigger } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

export default function RejectionReasonsPage() {
  const { has } = useSession();
  const queryClient = useQueryClient();
  const canRead = has('pipeline:read');
  const canManage = has('pipeline:manage');
  const [showInactive, setShowInactive] = useState(false);

  const reasonsQuery = useQuery({
    queryKey: queryKeys.pipeline.rejectionReasons({ includeInactive: showInactive }),
    queryFn: () =>
      api.get<RejectionReasonItem[]>('/pipeline/rejection-reasons', {
        query: { includeInactive: showInactive },
      }),
    enabled: canRead,
    staleTime: 60_000,
  });

  const setActive = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      api.patch<RejectionReasonItem>(`/pipeline/rejection-reasons/${input.id}`, {
        isActive: input.isActive,
      }),
    onSuccess: (reason) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipeline.all });
      toast.success(reason.isActive ? `${reason.label} activated` : `${reason.label} deactivated`);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not update this reason');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete<{ deleted: true }>(`/pipeline/rejection-reasons/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipeline.all });
      toast.success('Rejection reason deleted');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete this reason');
    },
  });

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <PageHeader title="Rejection reasons" description="The reasons recruiters choose from." />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to these settings"
          description="Ask a workspace administrator for the “View pipeline” permission."
        />
      </div>
    );
  }

  const reasons = reasonsQuery.data ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        title="Rejection reasons"
        description="Recruiters pick one of these when rejecting a candidate, which keeps rejection reporting consistent. Built-in reasons can be renamed or deactivated, but not deleted."
        actions={
          canManage ? (
            <RejectionReasonDialog
              trigger={
                <Button size="sm">
                  <Plus className="size-4" aria-hidden="true" />
                  New reason
                </Button>
              }
            />
          ) : null
        }
      />

      {!canManage ? (
        <Alert>
          <AlertDescription>
            You have read-only access to rejection reasons. An administrator can add, rename or retire
            them.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {reasonsQuery.isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : reasonsQuery.isError ? (
            <div className="p-4">
              <EmptyState
                title="Could not load rejection reasons"
                description={
                  reasonsQuery.error instanceof Error
                    ? reasonsQuery.error.message
                    : 'Please try again in a moment.'
                }
                action={
                  <Button variant="outline" size="sm" onClick={() => void reasonsQuery.refetch()}>
                    Retry
                  </Button>
                }
              />
            </div>
          ) : reasons.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={showInactive ? 'No rejection reasons yet' : 'No active rejection reasons'}
                description={
                  showInactive
                    ? 'Add the reasons recruiters should choose from.'
                    : 'Every reason is currently deactivated. Include inactive ones to reactivate them.'
                }
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="hidden sm:table-cell">Key</TableHead>
                  <TableHead className="w-28">Active</TableHead>
                  {canManage ? <TableHead className="w-24 text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {reasons.map((reason, index) => (
                  <TableRow key={reason.id} className={cn(!reason.isActive && 'opacity-60')}>
                    <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{reason.label}</span>
                        {reason.isSystem ? (
                          <Badge variant="outline" className="gap-1">
                            <Lock className="size-3" aria-hidden="true" />
                            Built-in
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                      {reason.key}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={reason.isActive}
                        disabled={!canManage || setActive.isPending}
                        aria-label={`${reason.isActive ? 'Deactivate' : 'Activate'} ${reason.label}`}
                        onCheckedChange={(checked) =>
                          setActive.mutate({ id: reason.id, isActive: checked })
                        }
                      />
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <RejectionReasonDialog
                            mode="edit"
                            reason={reason}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Rename ${reason.label}`}
                              >
                                <Pencil className="size-4" aria-hidden="true" />
                              </Button>
                            }
                          />

                          {reason.isSystem ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled
                              aria-label={`${reason.label} is built in and cannot be deleted`}
                            >
                              <Lock className="size-4" aria-hidden="true" />
                            </Button>
                          ) : (
                            <ConfirmDialog
                              destructive
                              title={`Delete ${reason.label}?`}
                              description="Candidates already rejected with this reason keep it in their history. The reason simply stops appearing in the picker."
                              confirmLabel="Delete reason"
                              trigger={
                                <DialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Delete ${reason.label}`}
                                  >
                                    <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                                  </Button>
                                </DialogTrigger>
                              }
                              onConfirm={() => remove.mutateAsync(reason.id).then(() => undefined)}
                            />
                          )}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <Switch checked={showInactive} onCheckedChange={setShowInactive} aria-label="Show inactive reasons" />
        Show deactivated reasons
      </label>
    </div>
  );
}
