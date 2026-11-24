'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { ImportJobSummary, ImportStatus } from '@talentflow/types';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * The statuses that end an import's lifecycle. `PENDING`, `MAPPING` and
 * `PROCESSING` are live; the moment any terminal status is observed the timer is
 * torn down and the job is never polled again.
 */
const TERMINAL_STATUSES: readonly ImportStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export function isTerminalImportStatus(
  status: ImportStatus | string | null | undefined,
): boolean {
  return (
    status !== null &&
    status !== undefined &&
    (TERMINAL_STATUSES as readonly string[]).includes(status)
  );
}

interface UseImportPollingOptions {
  /** Gates the initial fetch and the timer; polling only runs while `true`. */
  enabled?: boolean;
  /** Fires once each time the job settles into a terminal state. */
  onTerminal?: (job: ImportJobSummary) => void;
  /** Cadence between polls while the job is still running. */
  intervalMs?: number;
}

/**
 * Polls `GET /imports/:id` until the job is terminal.
 *
 * Mirrors `useBulkOperationPolling`: the timer is re-armed whenever
 * `importJobId` changes or the status falls back to a non-terminal state, and is
 * cleared on unmount and the instant a terminal status is seen. `onTerminal` is
 * latched per terminal streak so it fires exactly once per job.
 */
export function useImportPolling(
  importJobId: string | null,
  options: UseImportPollingOptions = {},
) {
  const { enabled = true, onTerminal, intervalMs = 1500 } = options;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.imports.detail(importJobId ?? ''),
    queryFn: () => api.get<ImportJobSummary>(`/imports/${importJobId}`),
    enabled: Boolean(importJobId) && enabled,
  });

  const status = query.data?.status;
  const terminal = isTerminalImportStatus(status);

  const onTerminalRef = useRef(onTerminal);
  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  const notifiedRef = useRef<string | null>(null);

  // A fresh job re-arms the terminal notification.
  useEffect(() => {
    if (!importJobId || terminal) return;
    notifiedRef.current = null;
  }, [importJobId, terminal]);

  useEffect(() => {
    if (!importJobId || !enabled || terminal) return;
    const timer = window.setInterval(() => {
      void queryClient.refetchQueries({
        queryKey: queryKeys.imports.detail(importJobId),
        exact: true,
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [importJobId, enabled, terminal, intervalMs, queryClient]);

  const current = query.data;
  useEffect(() => {
    if (!current || !terminal) return;
    if (notifiedRef.current === current.id) return;
    notifiedRef.current = current.id;
    onTerminalRef.current?.(current);
  }, [current, terminal]);

  return query;
}

interface UseImportListPollingOptions {
  /** Gates the timer; polling only runs while `true`. */
  enabled?: boolean;
  /** Cadence between polls while at least one row is still live. */
  intervalMs?: number;
}

/**
 * Refetches the active import queries on a fixed cadence while at least one row
 * is still live.
 *
 * Shares the terminal rule with `useImportPolling`, so the moment the last row
 * settles the timer is torn down — a finished history is never polled again.
 * Only the rows that are still live are refetched (`type: 'active'`).
 */
export function useImportListPolling(
  jobs: readonly { status: ImportStatus | string }[],
  options: UseImportListPollingOptions = {},
): void {
  const { enabled = true, intervalMs = 1500 } = options;
  const queryClient = useQueryClient();
  const pending = jobs.some((job) => !isTerminalImportStatus(job.status));

  useEffect(() => {
    if (!enabled || !pending) return;
    const timer = window.setInterval(() => {
      void queryClient.refetchQueries({ queryKey: queryKeys.imports.all, type: 'active' });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, pending, intervalMs, queryClient]);
}
