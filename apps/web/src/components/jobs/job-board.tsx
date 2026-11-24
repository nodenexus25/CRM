'use client';

import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  type ApplicationCard as ApplicationCardData,
  type ApplicationDetail,
  type BoardColumn,
  type BoardResponse,
} from '@talentflow/types';
import { cn } from '@talentflow/ui';

import { ApplicationCard } from '@/components/jobs/application-card';
import {
  RejectApplicationDialog,
  WithdrawApplicationDialog,
} from '@/components/jobs/reject-application-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

/**
 * Fractional board order for inserting at `index` in `cards`.
 *
 * The API stores a sortable float per card, so we place a card between its two
 * neighbours rather than rewriting the whole column.
 */
function orderAt(cards: readonly ApplicationCardData[], index: number): number {
  const before = index > 0 ? cards[index - 1]?.boardOrder : undefined;
  const after = cards[index]?.boardOrder;
  if (before !== undefined && after !== undefined) return (before + after) / 2;
  if (before !== undefined) return before + 1;
  if (after !== undefined) return after - 1;
  return 0;
}

/** The job's pipeline as a drag-and-drop board, one column per stage. */
export function JobBoard({ jobId }: { jobId: string }) {
  const { has } = useSession();
  const queryClient = useQueryClient();
  const canMove = has('application:move_stage');

  const board = useQuery({
    queryKey: queryKeys.applications.board(jobId, {}),
    queryFn: () => api.get<BoardResponse>(`/jobs/${jobId}/board`),
    staleTime: 15_000,
  });

  const [columns, setColumns] = useState<BoardColumn[]>([]);
  useEffect(() => {
    if (board.data) setColumns(board.data.columns);
  }, [board.data]);

  const [rejectCard, setRejectCard] = useState<ApplicationCardData | null>(null);
  const [withdrawCard, setWithdrawCard] = useState<ApplicationCardData | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Space to pick up, arrows to move, space to drop, escape to cancel.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const move = useMutation({
    mutationFn: ({ id, toStageId, boardOrder }: { id: string; toStageId: string; boardOrder: number }) =>
      api.post<ApplicationDetail>(`/applications/${id}/move`, { toStageId, boardOrder }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not move the candidate');
      void board.refetch();
    },
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const card = columns.flatMap((column) => column.cards).find((entry) => entry.id === activeId);
    const sourceColumn = columns.find((column) =>
      column.cards.some((entry) => entry.id === activeId),
    );
    if (!card || !sourceColumn) return;

    const targetColumn =
      columns.find((column) => column.stage.id === overId) ??
      columns.find((column) => column.cards.some((entry) => entry.id === overId));
    if (!targetColumn) return;

    const toStageId = targetColumn.stage.id;

    if (targetColumn.stage.category === 'REJECTED') {
      setRejectCard(card);
      return;
    }
    if (targetColumn.stage.category === 'WITHDRAWN') {
      setWithdrawCard(card);
      return;
    }

    if (!canMove) {
      toast.info('You need the “Move pipeline stage” permission to change a candidate’s stage.');
      return;
    }

    const targetWithoutActive = targetColumn.cards.filter((entry) => entry.id !== activeId);
    let insertIndex =
      overId === toStageId
        ? targetWithoutActive.length
        : targetWithoutActive.findIndex((entry) => entry.id === overId);
    if (insertIndex === -1) insertIndex = targetWithoutActive.length;

    const boardOrder = orderAt(targetWithoutActive, insertIndex);

    setColumns((previous) =>
      previous.map((column) => {
        const isSource = column.stage.id === sourceColumn.stage.id;
        const isTarget = column.stage.id === toStageId;
        if (!isSource && !isTarget) return column;

        const withoutActive = column.cards.filter((entry) => entry.id !== activeId);
        if (isTarget) {
          const next = [...withoutActive];
          next.splice(insertIndex, 0, { ...card, stageId: toStageId, boardOrder });
          return { ...column, cards: next, total: next.length };
        }
        return { ...column, cards: withoutActive, total: withoutActive.length };
      }),
    );

    move.mutate({ id: activeId, toStageId, boardOrder });
  }

  if (board.isPending) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-2" aria-busy="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-80 w-72 shrink-0" />
        ))}
      </div>
    );
  }

  if (board.isError) {
    return (
      <EmptyState
        title="Could not load the pipeline board"
        description={board.error instanceof Error ? board.error.message : 'Please try again in a moment.'}
        action={
          <Button variant="outline" size="sm" onClick={() => void board.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  if (columns.length === 0) {
    return (
      <EmptyState
        title="This job has no pipeline stages"
        description="Add stages in pipeline settings to start moving candidates through."
      />
    );
  }

  return (
    <div className="space-y-4">
      {!canMove ? (
        <Alert>
          <AlertDescription>
            You have read-only access to this pipeline. A recruiter can move candidates between stages.
          </AlertDescription>
        </Alert>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-2" aria-label="Candidate pipeline board">
          {columns.map((column) => (
            <BoardColumnView
              key={column.stage.id}
              column={column}
              draggable={canMove}
              canMove={canMove}
              onReject={setRejectCard}
              onWithdraw={setWithdrawCard}
            />
          ))}
        </div>
      </DndContext>

      <RejectApplicationDialog
        applicationId={rejectCard?.id ?? ''}
        open={rejectCard !== null}
        onOpenChange={(open) => {
          if (!open) setRejectCard(null);
        }}
        onSubmitted={() => setRejectCard(null)}
      />

      <WithdrawApplicationDialog
        applicationId={withdrawCard?.id ?? ''}
        open={withdrawCard !== null}
        onOpenChange={(open) => {
          if (!open) setWithdrawCard(null);
        }}
        onSubmitted={() => setWithdrawCard(null)}
      />
    </div>
  );
}

interface BoardColumnViewProps {
  column: BoardColumn;
  draggable: boolean;
  canMove: boolean;
  onReject: (card: ApplicationCardData) => void;
  onWithdraw: (card: ApplicationCardData) => void;
}

function BoardColumnView({ column, draggable, canMove, onReject, onWithdraw }: BoardColumnViewProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage.id });

  return (
    <section className="flex w-72 shrink-0 flex-col" aria-label={`${column.stage.name} stage`}>
      <header className="flex items-center justify-between gap-2 px-1 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-full border border-black/10"
            style={{ backgroundColor: column.stage.color }}
            aria-hidden="true"
          />
          <span className="truncate text-sm font-medium">{column.stage.name}</span>
        </div>
        <Badge variant="muted">{column.total}</Badge>
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          'min-h-24 flex-1 space-y-2 rounded-lg border border-dashed border-transparent p-1.5 transition-colors',
          isOver && 'border-primary/40 bg-primary/5',
        )}
      >
        <SortableContext
          items={column.cards.map((card) => card.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2">
            {column.cards.map((card) => (
              <ApplicationCard
                key={card.id}
                card={card}
                draggable={draggable}
                canMove={canMove}
                onReject={onReject}
                onWithdraw={onWithdraw}
              />
            ))}
          </ul>
        </SortableContext>

        {column.cards.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">No candidates</p>
        ) : null}
      </div>
    </section>
  );
}
