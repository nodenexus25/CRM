'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Pencil, SkipForward, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import {
  IMPORT_ENTITY_NOUN,
  IMPORT_STATUS_LABELS,
  type ImportJobSummary,
  type ImportStatus,
} from '@talentflow/types';
import { cn } from '@talentflow/ui';

import {
  isTerminalImportStatus,
  useImportPolling,
} from '@/components/imports/use-import-polling';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { queryKeys } from '@/lib/query-keys';

const STATUS_VARIANT: Record<ImportStatus, BadgeProps['variant']> = {
  PENDING: 'muted',
  MAPPING: 'info',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'destructive',
  CANCELLED: 'warning',
};

const numberFormatter = new Intl.NumberFormat();

/** Determinate progress bar; the percentage is computed server-side. */
function ProgressBar({ percent, failed }: { percent: number; failed: boolean }) {
  const value = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div
      role="progressbar"
      aria-label="Import progress"
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

type CounterTone = 'success' | 'muted' | 'destructive' | 'info';

const COUNTER_TONE_CLASS: Record<CounterTone, string> = {
  success: 'border-success/30 bg-success/8 [&_svg]:text-success',
  muted: 'border-border bg-muted/40 [&_svg]:text-muted-foreground',
  destructive: 'border-destructive/30 bg-destructive/8 [&_svg]:text-destructive',
  info: 'border-info/30 bg-info/8 [&_svg]:text-info',
};

/** One counter pill — updated/skipped/failed are hidden when they are zero. */
function Counter({
  icon: Icon,
  value,
  label,
  tone,
  className,
}: {
  icon: typeof CheckCircle2;
  value: number;
  label: string;
  tone: CounterTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs',
        COUNTER_TONE_CLASS[tone],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="font-medium tabular-nums">{numberFormatter.format(value)}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

interface ImportProgressProps {
  importJobId: string | null;
  /** Fires once when the job settles, so callers can refresh their lists. */
  onSettled?: (job: ImportJobSummary) => void;
}

/**
 * Live view of a single CSV/Excel import job.
 *
 * Polls `GET /imports/:id` until the job is terminal and then stops. Rows that
 * failed are listed (the API caps the recorded errors) and can be downloaded as
 * a CSV; a still-running job can be cancelled.
 */
export function ImportProgress({ importJobId, onSettled }: ImportProgressProps) {
  const queryClient = useQueryClient();

  const query = useImportPolling(importJobId, {
    onTerminal: (job) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports.all });
      onSettled?.(job);
    },
  });

  const job = query.data;

  const download = useMutation({
    mutationFn: () =>
      api.get<{ downloadUrl: string }>(`/imports/${importJobId}/errors`),
    onSuccess: ({ downloadUrl }) => {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && (error.isNotFound || error.isConflict)) {
        toast.info('This import has no error report to download yet.');
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Could not prepare the error report');
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.post<ImportJobSummary>(`/imports/${importJobId}/cancel`),
    onSuccess: (updated) => {
      if (importJobId) {
        queryClient.setQueryData(queryKeys.imports.detail(importJobId), updated);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports.all });
      toast.success('Import cancelled');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not cancel this import');
    },
  });

  if (!job) {
    if (query.isError) {
      return (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Could not load this import</AlertTitle>
          <AlertDescription>
            <p>{query.error instanceof Error ? query.error.message : 'Please try again in a moment.'}</p>
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      );
    }
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner />
        <span>Loading progress…</span>
      </div>
    );
  }

  const terminal = isTerminalImportStatus(job.status);
  const noun = IMPORT_ENTITY_NOUN[job.entity];
  const errors = job.errors;
  const capped = errors.length < job.failedRows;
  const failed = job.status === 'FAILED';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant={STATUS_VARIANT[job.status]}>{IMPORT_STATUS_LABELS[job.status]}</Badge>
          <span className="text-sm font-medium tabular-nums" aria-live="polite">
            {Math.min(100, Math.max(0, Math.round(job.progress)))}%
          </span>
        </div>
        <ProgressBar percent={job.progress} failed={failed} />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">
            {numberFormatter.format(job.processedRows)}
          </span>{' '}
          of {numberFormatter.format(job.totalRows)} row{job.totalRows === 1 ? '' : 's'} processed
          {!terminal ? (
            <>
              {' '}
              ·{' '}
              <span className="inline-flex items-center gap-1">
                <Spinner className="size-3" />
                running
              </span>
            </>
          ) : null}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Counter icon={CheckCircle2} value={job.createdRows} label={`${noun}s created`} tone="success" />
        {job.updatedRows > 0 ? (
          <Counter icon={Pencil} value={job.updatedRows} label={`${noun}s updated`} tone="info" />
        ) : null}
        {job.skippedRows > 0 ? (
          <Counter icon={SkipForward} value={job.skippedRows} label="skipped" tone="muted" />
        ) : null}
        {job.failedRows > 0 ? (
          <Counter icon={XCircle} value={job.failedRows} label="failed" tone="destructive" />
        ) : null}
      </div>

      {job.failedRows > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {capped
              ? `Showing the first ${numberFormatter.format(errors.length)} of ${numberFormatter.format(job.failedRows)} failures`
              : `${numberFormatter.format(job.failedRows)} row${job.failedRows === 1 ? '' : 's'} could not be imported`}
          </p>
          <div
            className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-2"
            tabIndex={0}
            aria-label="Failed rows"
          >
            {errors.map((error, index) => (
              <div key={`${error.row}-${error.field}-${index}`} className="flex items-start gap-2">
                <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-2xs text-muted-foreground">
                    Row {error.row}
                    {error.field ? ` · ${error.field}` : ''}
                  </p>
                  <p className="text-xs" title={error.message}>
                    {error.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {failed ? (
        <p className="text-xs text-destructive">
          The import finished with errors. Download the error report, fix the rows, then import again.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {job.failedRows > 0 ? (
          <Button
            variant="outline"
            size="sm"
            loading={download.isPending}
            disabled={download.isPending}
            onClick={() => download.mutate()}
          >
            <Download className="size-4" aria-hidden="true" />
            Download error CSV
          </Button>
        ) : null}
        {!terminal ? (
          <Button
            variant="outline"
            size="sm"
            loading={cancel.isPending}
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancel import
          </Button>
        ) : null}
      </div>
    </div>
  );
}
