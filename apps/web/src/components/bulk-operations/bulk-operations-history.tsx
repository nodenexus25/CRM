'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, History, ShieldOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  BULK_OPERATION_STATUS_LABELS,
  BULK_OPERATION_TYPE_LABELS,
  type BulkOperationItem,
  type BulkOperationQuery,
  type BulkOperationStatus,
  type Paginated,
} from '@talentflow/types';
import { formatDateTime } from '@talentflow/ui';

import {
  BulkOperationProgress,
  useBulkOperationResultDownload,
} from '@/components/bulk-operations/bulk-operation-progress';
import {
  isTerminalBulkStatus,
  useBulkOperationListPolling,
} from '@/components/bulk-operations/use-bulk-operation-polling';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const PAGE_SIZE = 20;

/** Mirrors `BULK_ACTION_PERMISSION_KEYS` on the API so the page can gate itself. */
const BULK_HISTORY_PERMISSIONS = [
  'candidate:bulk_update',
  'candidate:delete',
  'candidate:export',
  'application:create',
  'list:manage',
  'job:bulk_update',
  'job:assign',
  'candidate:read_all',
] as const;

const STATUS_VARIANT: Record<BulkOperationStatus, BadgeProps['variant']> = {
  PENDING: 'muted',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'destructive',
};

const numberFormatter = new Intl.NumberFormat();

/** Determinate progress cell: percentage plus the processed/total counters. */
function ProgressCell({ operation }: { operation: BulkOperationItem }) {
  const percent = Math.min(100, Math.max(0, Math.round(operation.progress)));
  const terminal = isTerminalBulkStatus(operation.status);
  return (
    <div className="min-w-32 space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium tabular-nums">{percent}%</span>
        <span className="tabular-nums text-muted-foreground">
          {numberFormatter.format(operation.processedItems)}/{numberFormatter.format(operation.totalItems)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`Progress for ${BULK_OPERATION_TYPE_LABELS[operation.type]}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={
            operation.status === 'FAILED'
              ? 'h-full rounded-full bg-destructive'
              : 'h-full rounded-full bg-primary'
          }
          style={{ width: `${percent}%` }}
        />
      </div>
      {!terminal && operation.totalItems === 0 ? (
        <p className="text-2xs text-muted-foreground">Resolving selection…</p>
      ) : null}
    </div>
  );
}

/**
 * Table of recent bulk operations for the `/settings/bulk-operations` page.
 *
 * Owns its own pagination and query, polls only the rows that are still live
 * (then stops), and lets a finished export be downloaded as a fresh signed
 * link. Deleting a live operation is attempted and the API's 409 is surfaced.
 */
export function BulkOperationsHistory() {
  const { has, tenant } = useSession();
  const queryClient = useQueryClient();

  const canRead = has('candidate:read_all') || BULK_HISTORY_PERMISSIONS.some((key) => has(key));

  const [page, setPage] = useState(1);
  const [progressId, setProgressId] = useState<string | null>(null);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    sortBy: 'createdAt' as const,
    sortDir: 'desc' as const,
  };

  const operations = useQuery({
    queryKey: queryKeys.bulkOperations.list(query as Partial<BulkOperationQuery>),
    queryFn: () => api.get<Paginated<BulkOperationItem>>('/bulk-operations', { query }),
    enabled: canRead,
    staleTime: 10_000,
  });

  const items = operations.data?.items ?? [];
  const meta = operations.data?.meta;

  useBulkOperationListPolling(items, { enabled: canRead });

  const download = useBulkOperationResultDownload(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/bulk-operations/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bulkOperations.all });
      toast.success('Operation removed from history');
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.isConflict) {
        toast.error('This operation is still running. Wait for it to finish, then delete it.');
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Could not delete this operation');
    },
  });

  if (!canRead) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="You do not have access to bulk operations"
        description="Ask a workspace administrator for a permission that can run bulk actions."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          {operations.isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : operations.isError ? (
            <div className="p-4">
              <EmptyState
                title="Could not load bulk operations"
                description={
                  operations.error instanceof Error
                    ? operations.error.message
                    : 'Please try again in a moment.'
                }
                action={
                  <Button variant="outline" size="sm" onClick={() => void operations.refetch()}>
                    Retry
                  </Button>
                }
              />
            </div>
          ) : items.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={History}
                title="No bulk operations yet"
                description="Select rows on the jobs or candidates list and run a bulk action — it will show up here."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operation</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-44">Progress</TableHead>
                  <TableHead className="hidden w-28 lg:table-cell">Result</TableHead>
                  <TableHead className="hidden w-36 md:table-cell">Created by</TableHead>
                  <TableHead className="hidden w-40 xl:table-cell">Created</TableHead>
                  <TableHead className="hidden w-40 xl:table-cell">Completed</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((operation) => {
                  const canDownload =
                    operation.status === 'COMPLETED' && operation.resultKey !== null;
                  return (
                    <TableRow key={operation.id}>
                      <TableCell>
                        <span className="font-medium">
                          {BULK_OPERATION_TYPE_LABELS[operation.type]}
                        </span>
                        <span className="block text-2xs text-muted-foreground">
                          {numberFormatter.format(operation.totalItems)} item
                          {operation.totalItems === 1 ? '' : 's'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[operation.status]}>
                          {BULK_OPERATION_STATUS_LABELS[operation.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ProgressCell operation={operation} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="text-xs">
                          <span className="font-medium tabular-nums text-foreground">
                            {numberFormatter.format(operation.succeededItems)}
                          </span>
                          <span className="text-muted-foreground"> ok</span>
                          {operation.failedItems > 0 ? (
                            <>
                              <span className="text-muted-foreground"> · </span>
                              <span className="font-medium tabular-nums text-destructive">
                                {numberFormatter.format(operation.failedItems)}
                              </span>
                              <span className="text-muted-foreground"> failed</span>
                            </>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="truncate text-xs">
                          {operation.createdBy?.fullName ?? 'System'}
                        </span>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground xl:table-cell">
                        {formatDateTime(operation.createdAt, tenant?.timezone)}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground xl:table-cell">
                        {operation.completedAt
                          ? formatDateTime(operation.completedAt, tenant?.timezone)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`View progress for ${BULK_OPERATION_TYPE_LABELS[operation.type]}`}
                            title="View progress"
                            onClick={() => setProgressId(operation.id)}
                          >
                            <History className="size-4" aria-hidden="true" />
                          </Button>

                          {canDownload ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Download result of ${BULK_OPERATION_TYPE_LABELS[operation.type]}`}
                              title="Download result"
                              onClick={() => download.mutate(operation.id)}
                            >
                              <Download className="size-4" aria-hidden="true" />
                            </Button>
                          ) : null}

                          <ConfirmDialog
                            destructive
                            title="Remove this operation from history?"
                            description="The record of this run is deleted. Any records it already changed are not affected."
                            confirmLabel="Delete operation"
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Delete ${BULK_OPERATION_TYPE_LABELS[operation.type]} operation`}
                                title="Delete"
                              >
                                <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                              </Button>
                            }
                            onConfirm={() =>
                              remove
                                .mutateAsync(operation.id)
                                .then(() => undefined)
                                .catch(() => undefined)
                            }
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {meta && meta.total > 0 ? (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            Showing {(meta.page - 1) * meta.pageSize + 1}–
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total} operation
            {meta.total === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={!meta.hasPrevious || operations.isFetching}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {meta.page} of {Math.max(1, meta.pageCount)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => value + 1)}
              disabled={!meta.hasNext || operations.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <BulkOperationProgress
        open={progressId !== null}
        onOpenChange={(open) => {
          if (!open) setProgressId(null);
        }}
        operationId={progressId}
      />
    </div>
  );
}
