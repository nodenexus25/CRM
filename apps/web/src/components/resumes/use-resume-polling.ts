'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { ResumeDetail, ResumeParseStatus } from '@talentflow/types';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * The parse statuses that end the lifecycle. Polling stops the moment one is
 * observed; a resume that reaches `FAILED` or `NEEDS_OCR` is just as terminal
 * as a `COMPLETED` one.
 */
const TERMINAL_STATUSES: readonly ResumeParseStatus[] = ['COMPLETED', 'FAILED', 'NEEDS_OCR'];

export function isTerminalResumeStatus(
  status: ResumeParseStatus | string | null | undefined,
): boolean {
  return (
    status !== null &&
    status !== undefined &&
    (TERMINAL_STATUSES as readonly string[]).includes(status)
  );
}

interface UseResumePollingOptions {
  /** Gates the initial fetch and the timer; polling only runs while `true`. */
  enabled?: boolean;
  /** Fires once each time the parse settles into a terminal state. */
  onTerminal?: (resume: ResumeDetail) => void;
  /** Cadence between polls while the parse is in flight. */
  intervalMs?: number;
}

/**
 * Polls `GET /resumes/:id` until the parse is terminal.
 *
 * The timer is re-armed whenever `resumeId` changes or the status falls back to
 * a non-terminal state (e.g. after a re-parse), and is cleared on unmount and
 * the instant a terminal status is seen — a finished resume is never polled
 * again. `onTerminal` is latched per terminal streak so it fires exactly once.
 */
export function useResumePolling(
  resumeId: string | null,
  options: UseResumePollingOptions = {},
) {
  const { enabled = true, onTerminal, intervalMs = 1500 } = options;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.resumes.detail(resumeId ?? ''),
    queryFn: () => api.get<ResumeDetail>(`/resumes/${resumeId}`),
    enabled: Boolean(resumeId) && enabled,
  });

  const status = query.data?.parseStatus;
  const terminal = isTerminalResumeStatus(status);

  const onTerminalRef = useRef(onTerminal);
  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  const notifiedRef = useRef<string | null>(null);

  // A fresh resume (or a parse that fell back to a non-terminal state after a
  // re-parse) re-arms the terminal notification.
  useEffect(() => {
    if (!resumeId || terminal) return;
    notifiedRef.current = null;
  }, [resumeId, terminal]);

  useEffect(() => {
    if (!resumeId || !enabled || terminal) return;
    const timer = window.setInterval(() => {
      void queryClient.refetchQueries({
        queryKey: queryKeys.resumes.detail(resumeId),
        exact: true,
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [resumeId, enabled, terminal, intervalMs, queryClient]);

  const current = query.data;
  useEffect(() => {
    if (!current || !terminal) return;
    if (notifiedRef.current === current.id) return;
    notifiedRef.current = current.id;
    onTerminalRef.current?.(current);
  }, [current, terminal]);

  return query;
}

interface UseResumeListPollingOptions {
  /** Gates the timer; polling only runs while `true`. */
  enabled?: boolean;
  /** Cadence between polls while at least one row is still parsing. */
  intervalMs?: number;
}

/**
 * Refetches every active résumé query on a fixed cadence while at least one row
 * is still parsing.
 *
 * Shares the terminal rule with `useResumePolling`, so the moment the last row
 * settles the timer is torn down — a finished list is never polled again. Used
 * by the per-candidate panel, where the individual rows come from a single
 * list query rather than one query per row.
 */
export function useResumeListPolling(
  resumes: readonly { parseStatus: ResumeParseStatus | string }[],
  options: UseResumeListPollingOptions = {},
): void {
  const { enabled = true, intervalMs = 1500 } = options;
  const queryClient = useQueryClient();
  const pending = resumes.some((resume) => !isTerminalResumeStatus(resume.parseStatus));

  useEffect(() => {
    if (!enabled || !pending) return;
    const timer = window.setInterval(() => {
      void queryClient.refetchQueries({ queryKey: queryKeys.resumes.all, type: 'active' });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, pending, intervalMs, queryClient]);
}
