'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@talentflow/ui';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Click-to-sort; `id` must be a field the server can sort by. */
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  className?: string;
  headClassName?: string;
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  getRowId: (row: T) => string;
  isPending?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Rendered instead of the default EmptyState when there are no rows. */
  empty?: ReactNode;
  /** Adds a leading checkbox column with a tri-state header checkbox. */
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  sortBy?: string | null;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (sortBy: string, sortDir: 'asc' | 'desc') => void;
  skeletonRows?: number;
  caption?: string;
}

const CONTAINER = 'overflow-hidden rounded-lg border border-border bg-card shadow-card';

const ALIGN_CLASS: Record<'left' | 'center' | 'right', string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

/**
 * Presentational table shared by every list screen.
 *
 * It owns no data fetching: the page passes rows, sort state and selection in,
 * and gets change notifications back, so every list renders an identical shell
 * (border, skeleton, empty state, pagination-aligned footer ordering).
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  isPending,
  isError,
  error,
  onRetry,
  empty,
  selectable,
  selectedIds,
  onSelectionChange,
  sortBy,
  sortDir = 'desc',
  onSortChange,
  skeletonRows,
  caption,
}: DataTableProps<T>) {
  const selected = selectedIds ?? new Set<string>();
  const rowIds = rows.map((row) => getRowId(row));
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.has(id));
  const someSelected = rowIds.some((id) => selected.has(id));

  function handleSort(columnId: string) {
    if (!onSortChange) return;
    const nextDir: 'asc' | 'desc' = sortBy === columnId && sortDir === 'asc' ? 'desc' : 'asc';
    onSortChange(columnId, nextDir);
  }

  function handleSelectAll(checked: boolean | 'indeterminate') {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (checked === false) {
      for (const id of rowIds) next.delete(id);
    } else {
      for (const id of rowIds) next.add(id);
    }
    onSelectionChange(next);
  }

  function handleSelectRow(id: string, checked: boolean) {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange(next);
  }

  if (isPending) {
    return (
      <div className={CONTAINER} aria-busy="true">
        <div className="space-y-2 p-5">
          {Array.from({ length: skeletonRows ?? 6 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={CONTAINER}>
        <div className="p-5">
          <EmptyState
            title="Could not load"
            description={error instanceof Error ? error.message : 'Please try again in a moment.'}
            action={
              onRetry ? (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              ) : undefined
            }
          />
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={CONTAINER}>
        <div className="p-5">{empty ?? <EmptyState title="Nothing to show yet" />}</div>
      </div>
    );
  }

  return (
    <div className={CONTAINER}>
      <Table>
        {caption ? <TableCaption>{caption}</TableCaption> : null}
        <TableHeader>
          <TableRow>
            {selectable ? (
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all rows on this page"
                />
                <span className="sr-only">Select</span>
              </TableHead>
            ) : null}

            {columns.map((column) => {
              const isActive = column.sortable === true && sortBy === column.id;
              const ariaSort = column.sortable
                ? isActive
                  ? sortDir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
                : undefined;

              return (
                <TableHead
                  key={column.id}
                  aria-sort={ariaSort}
                  className={cn(column.align ? ALIGN_CLASS[column.align] : undefined, column.headClassName)}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(column.id)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-sm font-medium transition-colors',
                        'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                        isActive && 'text-foreground',
                      )}
                    >
                      {column.header}
                      {isActive ? (
                        sortDir === 'asc' ? (
                          <ArrowUp className="size-3" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden="true" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-50" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => {
            const id = getRowId(row);
            return (
              <TableRow key={id} data-state={selected.has(id) ? 'selected' : undefined}>
                {selectable ? (
                  <TableCell className="w-10">
                    <Checkbox
                      checked={selected.has(id)}
                      onCheckedChange={(checked) => handleSelectRow(id, checked === true)}
                      aria-label="Select row"
                    />
                  </TableCell>
                ) : null}

                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn(column.align ? ALIGN_CLASS[column.align] : undefined, column.className)}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
