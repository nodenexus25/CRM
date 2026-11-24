'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { BulkOperationItem, BulkOperationStatus } from '@talentflow/types';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * The statuses that end a bulk operation's lifecycle. `PENDING` and
 * `PROCESSING` are live; the moment either terminal status is observed the
 * timer is torn down and the operation is never polled again.
 */
const TERMINAL_STATUSES: readonly BulkOperationStatus[] = ['COMPLETED', 'FAILED'];

export function isTerminalBulkStatus(
  status: BulkOperationStatus | string | null | undefined,
): boolean {
  return (
    status !== null &&
    status !== undefined &&
    (TERMINAL_STATUSES as readonly string[]).includes(status)
  );
}

interface UseBulkOperationPollingOptions {
  /** Gates the initial fetch and the timer; polling only runs while `true`. */
  enabled?: boolean;
  /** Fires once each time the operation settles into a terminal state. */
  onTerminal?: (operation: BulkOperationItem) => void;
  /** Cadence between polls while the operation is still running. */
  intervalMs?: number;
}

/**
 * Polls `GET /bulk-operations/:id` until the operation is terminal.
 *
 * Mirrors `useResumePolling`: the timer is re-armed whenever `operationId`
 * changes or the status falls back to a non-terminal state, and is cleared on
 * unmount and the instant a terminal status is seen. `onTerminal` is latched
 * per terminal streak so it fires exactly once per operation.
 */
export function useBulkOperationPolling(
  operationId: string | null,
  options: UseBulkOperationPollingOptions = {},
) {
  const { enabled = true, onTerminal, intervalMs = 1500 } = options;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.bulkOperations.detail(operationId ?? ''),
    queryFn: () => api.get<BulkOperationItem>(`/bulk-operations/${operationId}`),
    enabled: Boolean(operationId) && enabled,
  });

  const status = query.data?.status;
  const terminal = isTerminalBulkStatus(status);

  const onTerminalRef = useRef(onTerminal);
  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  const notifiedRef = useRef<string | null>(null);

  // A fresh operation re-arms the terminal notification.
  useEffect(() => {
    if (!operationId || terminal) return;
    notifiedRef.current = null;
  }, [operationId, terminal]);

  useEffect(() => {
    if (!operationId || !enabled || terminal) return;
    const timer = window.setInterval(() => {
      void queryClient.refetchQueries({
        queryKey: queryKeys.bulkOperations.detail(operationId),
        exact: true,
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [operationId, enabled, terminal, intervalMs, queryClient]);

  const current = query.data;
  useEffect(() => {
    if (!current || !terminal) return;
    if (notifiedRef.current === current.id) return;
    notifiedRef.current = current.id;
    onTerminalRef.current?.(current);
  }, [current, terminal]);

  return query;
}

interface UseBulkOperationListPollingOptions {
  /** Gates the timer; polling only runs while `true`. */
  enabled?: boolean;
  /** Cadence between polls while at least one row is still live. */
  intervalMs?: number;
}

/**
 * Refetches the active bulk-operation queries on a fixed cadence while at least
 * one row is still live.
 *
 * Shares the terminal rule with `useBulkOperationPolling`, so the moment the
 * last row settles the timer is torn down — a finished history is never polled
 * again. Only the rows that are still live are refetched (`type: 'active'`).
 */
export function useBulkOperationListPolling(
  operations: readonly { status: BulkOperationStatus | string }[],
  options: UseBulkOperationListPollingOptions = {},
): void {
  const { enabled = true, intervalMs = 1500 } = options;
  const queryClient = useQueryClient();
  const pending = operations.some(
    (operation) => !isTerminalBulkStatus(operation.status),
  );

  useEffect(() => {
    if (!enabled || !pending) return;
    const timer = window.setInterval(() => {
      void queryClient.refetchQueries({ queryKey: queryKeys.bulkOperations.all, type: 'active' });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, pending, intervalMs, queryClient]);
}
