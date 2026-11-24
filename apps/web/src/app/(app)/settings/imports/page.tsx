'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, History, ShieldOff, Trash2, Upload, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  IMPORT_ENTITY_TYPE_LABELS,
  IMPORT_STATUS_LABELS,
  type ImportJobQuery,
  type ImportJobSummary,
  type ImportStatus,
  type Paginated,
} from '@talentflow/types';
import { formatDateTime } from '@talentflow/ui';

import { ImportProgress } from '@/components/imports/import-progress';
import { ImportWizardDialog } from '@/components/imports/import-wizard-dialog';
import {
  isTerminalImportStatus,
  useImportListPolling,
} from '@/components/imports/use-import-polling';
import { PageHeader } from '@/components/shell/page-header';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

/** A user needs any of these to reach the import surface. */
const IMPORT_PERMISSIONS = [
  'import:create',
  'candidate:import',
  'candidate:create',
  'client:create',
  'job:create',
  'contact:create',
] as const;

const STATUS_VARIANT: Record<ImportStatus, BadgeProps['variant']> = {
  PENDING: 'muted',
  MAPPING: 'info',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'destructive',
  CANCELLED: 'warning',
};

const numberFormatter = new Intl.NumberFormat();

/** Determinate progress cell: percentage plus the processed/total counters. */
function ProgressCell({ job }: { job: ImportJobSummary }) {
  const percent = Math.min(100, Math.max(0, Math.round(job.progress)));
  const terminal = isTerminalImportStatus(job.status);
  return (
    <div className="min-w-32 space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium tabular-nums">{percent}%</span>
        <span className="tabular-nums text-muted-foreground">
          {numberFormatter.format(job.processedRows)}/{numberFormatter.format(job.totalRows)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`Progress for ${IMPORT_ENTITY_TYPE_LABELS[job.entity]}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={
            job.status === 'FAILED'
              ? 'h-full rounded-full bg-destructive'
              : 'h-full rounded-full bg-primary'
          }
          style={{ width: `${percent}%` }}
        />
      </div>
      {!terminal && job.totalRows === 0 ? (
        <p className="text-2xs text-muted-foreground">Reading the file…</p>
      ) : null}
    </div>
  );
}

/** Requests a fresh, signed link to a job's error report and opens it. */
function useImportErrorDownload() {
  return useMutation({
    mutationFn: (id: string) => api.get<{ downloadUrl: string }>(`/imports/${id}/errors`),
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
}

export default function SettingsImportsPage() {
  const { has, tenant } = useSession();
  const queryClient = useQueryClient();

  const canRead = IMPORT_PERMISSIONS.some((key) => has(key));

  const [page, setPage] = useState(1);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [progressId, setProgressId] = useState<string | null>(null);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    sortBy: 'createdAt' as const,
    sortDir: 'desc' as const,
  };

  const imports = useQuery({
    queryKey: queryKeys.imports.list(query as Partial<ImportJobQuery>),
    queryFn: () => api.get<Paginated<ImportJobSummary>>('/imports', { query }),
    enabled: canRead,
    staleTime: 10_000,
  });

  const items = imports.data?.items ?? [];
  const meta = imports.data?.meta;

  useImportListPolling(items, { enabled: canRead });

  const download = useImportErrorDownload();

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/imports/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports.all });
      toast.success('Import removed from history');
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.isConflict) {
        toast.error('This import is still processing. Wait for it to finish, then delete it.');
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Could not delete this import');
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post<ImportJobSummary>(`/imports/${id}/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports.all });
      toast.success('Import cancelled');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not cancel this import');
    },
  });

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader title="Import data" />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to data imports"
          description="Ask a workspace administrator for a permission that can create records."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title="Import data"
        description="Bring candidates, clients, jobs and contacts in from a CSV or Excel file. Imports keep running if you leave this page."
        actions={
          <Button size="sm" onClick={() => setWizardOpen(true)}>
            <Upload className="size-4" aria-hidden="true" />
            New import
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {imports.isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : imports.isError ? (
            <div className="p-4">
              <EmptyState
                title="Could not load imports"
                description={
                  imports.error instanceof Error
                    ? imports.error.message
                    : 'Please try again in a moment.'
                }
                action={
                  <Button variant="outline" size="sm" onClick={() => void imports.refetch()}>
                    Retry
                  </Button>
                }
              />
            </div>
          ) : items.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={History}
                title="No imports yet"
                description="Start an import to bring your existing records into TalentFlow."
                action={
                  <Button size="sm" onClick={() => setWizardOpen(true)}>
                    <Upload className="size-4" aria-hidden="true" />
                    New import
                  </Button>
                }
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Import</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-44">Progress</TableHead>
                  <TableHead className="hidden w-40 lg:table-cell">Result</TableHead>
                  <TableHead className="hidden w-36 md:table-cell">Created by</TableHead>
                  <TableHead className="hidden w-40 xl:table-cell">Created</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((job) => {
                  const terminal = isTerminalImportStatus(job.status);
                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <span className="font-medium">
                          {IMPORT_ENTITY_TYPE_LABELS[job.entity]}
                        </span>
                        <span className="block max-w-64 truncate text-2xs text-muted-foreground" title={job.fileName}>
                          {job.fileName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[job.status]}>
                          {IMPORT_STATUS_LABELS[job.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ProgressCell job={job} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="text-xs">
                          <span className="font-medium tabular-nums text-foreground">
                            {numberFormatter.format(job.createdRows)}
                          </span>
                          <span className="text-muted-foreground"> new</span>
                          {job.updatedRows > 0 ? (
                            <>
                              <span className="text-muted-foreground"> · </span>
                              <span className="font-medium tabular-nums">
                                {numberFormatter.format(job.updatedRows)}
                              </span>
                              <span className="text-muted-foreground"> updated</span>
                            </>
                          ) : null}
                          {job.skippedRows > 0 ? (
                            <>
                              <span className="text-muted-foreground"> · </span>
                              <span className="font-medium tabular-nums">
                                {numberFormatter.format(job.skippedRows)}
                              </span>
                              <span className="text-muted-foreground"> skipped</span>
                            </>
                          ) : null}
                          {job.failedRows > 0 ? (
                            <>
                              <span className="text-muted-foreground"> · </span>
                              <span className="font-medium tabular-nums text-destructive">
                                {numberFormatter.format(job.failedRows)}
                              </span>
                              <span className="text-muted-foreground"> failed</span>
                            </>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="truncate text-xs">
                          {job.createdBy?.fullName ?? 'System'}
                        </span>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground xl:table-cell">
                        {formatDateTime(job.createdAt, tenant?.timezone)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`View progress for ${IMPORT_ENTITY_TYPE_LABELS[job.entity]}`}
                            title="View progress"
                            onClick={() => setProgressId(job.id)}
                          >
                            <History className="size-4" aria-hidden="true" />
                          </Button>

                          {job.failedRows > 0 ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Download errors for ${IMPORT_ENTITY_TYPE_LABELS[job.entity]}`}
                              title="Download error CSV"
                              onClick={() => download.mutate(job.id)}
                            >
                              <Download className="size-4" aria-hidden="true" />
                            </Button>
                          ) : null}

                          {!terminal ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Cancel ${IMPORT_ENTITY_TYPE_LABELS[job.entity]} import`}
                              title="Cancel import"
                              onClick={() => cancel.mutate(job.id)}
                            >
                              <XCircle className="size-4 text-destructive" aria-hidden="true" />
                            </Button>
                          ) : null}

                          <ConfirmDialog
                            destructive
                            title="Remove this import from history?"
                            description="The record of this run is deleted. Any records it already created are not affected."
                            confirmLabel="Delete import"
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Delete ${IMPORT_ENTITY_TYPE_LABELS[job.entity]} import`}
                                title="Delete"
                              >
                                <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                              </Button>
                            }
                            onConfirm={() =>
                              remove
                                .mutateAsync(job.id)
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
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total} import
            {meta.total === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={!meta.hasPrevious || imports.isFetching}
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
              disabled={!meta.hasNext || imports.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <ImportWizardDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        entity="CANDIDATE"
        onCompleted={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.imports.all });
        }}
      />

      <Dialog
        open={progressId !== null}
        onOpenChange={(open) => {
          if (!open) setProgressId(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Import progress</DialogTitle>
            <DialogDescription>
              You can close this dialog — the import keeps running.
            </DialogDescription>
          </DialogHeader>
          <ImportProgress importJobId={progressId} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
