'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import {
  BULK_OPERATION_STATUS_LABELS,
  BULK_OPERATION_TYPE_LABELS,
  type BulkOperationItem,
  type BulkOperationStatus,
} from '@talentflow/types';
import { cn, formatDateTime } from '@talentflow/ui';

import { isTerminalBulkStatus, useBulkOperationPolling } from '@/components/bulk-operations/use-bulk-operation-polling';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const STATUS_VARIANT: Record<BulkOperationStatus, BadgeProps['variant']> = {
  PENDING: 'muted',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'destructive',
};

/** Determinate progress bar; the percentage is computed server-side. */
function ProgressBar({ percent, failed }: { percent: number; failed: boolean }) {
  const value = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div
      role="progressbar"
      aria-label="Bulk operation progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-200',
          failed ? 'bg-destructive' : 'bg-primary',
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

/**
 * Requests a fresh, signed download link for a finished export and opens it.
 *
 * A 404/409 means the operation produced no file (or has not finished yet) and
 * is surfaced as an informational toast rather than an error, matching the API
 * contract for `GET /bulk-operations/:id/result`.
 *
 * `mutate()` downloads the bound `operationId`; passing an id explicitly (as the
 * history table does, one hook for every row) overrides it for that call.
 */
export function useBulkOperationResultDownload(operationId: string | null) {
  return useMutation({
    mutationFn: async (overrideId?: string) => {
      const target = overrideId ?? operationId;
      if (!target) throw new ApiError({ message: 'No operation selected.' }, 400);
      return api.get<{ downloadUrl: string }>(`/bulk-operations/${target}/result`);
    },
    onSuccess: ({ downloadUrl }) => {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && (error.isNotFound || error.isConflict)) {
        toast.info('This operation has no downloadable result yet.');
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Could not prepare the download');
    },
  });
}

interface BulkOperationProgressProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operationId: string | null;
  /** Fires once when the operation settles, so callers can refresh their lists. */
  onSettled?: (operation: BulkOperationItem) => void;
}

/**
 * Live view of a single bulk operation.
 *
 * Polls until the operation is terminal and then stops; closing the dialog is
 * purely presentational and never cancels the queued work.
 */
export function BulkOperationProgress({
  open,
  onOpenChange,
  operationId,
  onSettled,
}: BulkOperationProgressProps) {
  const { tenant } = useSession();
  const queryClient = useQueryClient();

  const query = useBulkOperationPolling(open ? operationId : null, {
    onTerminal: (operation) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bulkOperations.all });
      onSettled?.(operation);
    },
  });

  const operation = query.data;
  const download = useBulkOperationResultDownload(open ? operationId : null);

  const status = operation?.status ?? 'PENDING';
  const terminal = isTerminalBulkStatus(status);
  const progress = operation?.progress ?? 0;
  const errors = operation?.errors ?? [];
  const capped = operation !== undefined && errors.length < operation.failedItems;
  const canDownload = Boolean(
    operation && operation.status === 'COMPLETED' && operation.resultKey !== null,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {operation ? BULK_OPERATION_TYPE_LABELS[operation.type] : 'Bulk operation'}
          </DialogTitle>
          <DialogDescription>
            {operation
              ? `Started ${formatDateTime(operation.createdAt, tenant?.timezone)}. You can close this dialog — the operation keeps running.`
              : 'Loading the operation…'}
          </DialogDescription>
        </DialogHeader>

        {!operation ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner />
            <span>Loading progress…</span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant={STATUS_VARIANT[operation.status]}>
                  {BULK_OPERATION_STATUS_LABELS[operation.status]}
                </Badge>
                <span className="text-sm font-medium tabular-nums" aria-live="polite">
                  {Math.min(100, Math.max(0, Math.round(progress)))}%
                </span>
              </div>
              <ProgressBar percent={progress} failed={operation.status === 'FAILED'} />
              <p className="text-xs text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground">
                  {operation.processedItems.toLocaleString()}
                </span>{' '}
                of {operation.totalItems.toLocaleString()} item
                {operation.totalItems === 1 ? '' : 's'} processed
                {!terminal ? (
                  <>
                    {' '}
                    · <span className="inline-flex items-center gap-1">
                      <Spinner className="size-3" />
                      running
                    </span>
                  </>
                ) : null}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/8 px-2.5 py-1 text-xs">
                <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
                <span className="font-medium tabular-nums">{operation.succeededItems.toLocaleString()}</span>
                <span className="text-muted-foreground">succeeded</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/8 px-2.5 py-1 text-xs">
                <XCircle className="size-3.5 text-destructive" aria-hidden="true" />
                <span className="font-medium tabular-nums">{operation.failedItems.toLocaleString()}</span>
                <span className="text-muted-foreground">failed</span>
              </span>
            </div>

            {errors.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {capped
                    ? `Showing the first ${errors.length.toLocaleString()} of ${operation.failedItems.toLocaleString()} failures`
                    : `${errors.length.toLocaleString()} item${errors.length === 1 ? '' : 's'} could not be processed`}
                </p>
                <div
                  className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-2"
                  tabIndex={0}
                  aria-label="Failed items"
                >
                  {errors.map((error) => (
                    <div key={error.id} className="flex items-start gap-2">
                      <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-2xs text-muted-foreground" title={error.id}>
                          {error.id}
                        </p>
                        <p className="truncate text-xs" title={error.message}>
                          {error.message}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                {capped ? (
                  <p className="text-2xs text-muted-foreground">
                    Only the first {errors.length.toLocaleString()} failures are recorded; the counters
                    above carry the full total.
                  </p>
                ) : null}
              </div>
            ) : null}

            {operation.status === 'FAILED' ? (
              <p className="text-xs text-destructive">
                The operation finished with errors. Review the failures above, then retry the affected
                records.
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {terminal ? 'Close' : 'Close and keep running'}
          </Button>
          {canDownload ? (
            <Button loading={download.isPending} onClick={() => download.mutate()}>
              <Download className="size-4" aria-hidden="true" />
              Download result
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
