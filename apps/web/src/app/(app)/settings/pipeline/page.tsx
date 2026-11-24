'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, MoreHorizontal, Pencil, Plus, ShieldOff, Timer, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { STAGE_CATEGORY_LABELS, STAGE_TYPE_LABELS, type PipelineStageItem } from '@talentflow/types';
import { cn } from '@talentflow/ui';

import { PageHeader } from '@/components/shell/page-header';
import { DeleteStageDialog } from '@/components/pipeline/delete-stage-dialog';
import { StageDialog } from '@/components/pipeline/stage-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const CATEGORY_VARIANTS = {
  ACTIVE: 'info',
  HIRED: 'success',
  REJECTED: 'destructive',
  WITHDRAWN: 'muted',
} as const;

export default function PipelineSettingsPage() {
  const { has } = useSession();
  const queryClient = useQueryClient();
  const canRead = has('pipeline:read');
  const canManage = has('pipeline:manage');

  const stagesQuery = useQuery({
    queryKey: queryKeys.pipeline.stages,
    queryFn: () => api.get<PipelineStageItem[]>('/pipeline/stages'),
    enabled: canRead,
    staleTime: 30_000,
  });

  // The drag interaction needs an immediately reorderable local list; the
  // server payload is the source of truth and re-seeds it whenever it changes.
  const [order, setOrder] = useState<PipelineStageItem[]>([]);
  useEffect(() => {
    if (stagesQuery.data) setOrder(stagesQuery.data);
  }, [stagesQuery.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Space to pick up, arrows to move, space to drop, escape to cancel.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      api.put<PipelineStageItem[]>('/pipeline/stages/reorder', {
        stages: ids.map((id, index) => ({ id, order: index })),
      }),
    onSuccess: (stages) => {
      queryClient.setQueryData(queryKeys.pipeline.stages, stages);
      setOrder(stages);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not save the new order');
      void stagesQuery.refetch();
    },
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = order.findIndex((stage) => stage.id === active.id);
    const newIndex = order.findIndex((stage) => stage.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);

    if (!canManage) {
      toast.info('You need the “Manage pipeline settings” permission to reorder stages.');
      setOrder(order);
      return;
    }
    reorder.mutate(next.map((stage) => stage.id));
  }

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <PageHeader
          title="Pipeline stages"
          description="The ordered stages every job starts with."
        />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to pipeline settings"
          description="Ask a workspace administrator for the “View pipeline” permission."
        />
      </div>
    );
  }

  const activeCount = order.filter((stage) => stage.category === 'ACTIVE').length;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        title="Pipeline stages"
        description="Every job inherits this pipeline and can override it individually. Drag the handle, or focus it and use the arrow keys, to change the order candidates move through."
        actions={
          canManage ? (
            <StageDialog
              trigger={
                <Button size="sm">
                  <Plus className="size-4" aria-hidden="true" />
                  New stage
                </Button>
              }
            />
          ) : null
        }
      />

      {!canManage ? (
        <Alert>
          <AlertDescription>
            You have read-only access to pipeline settings. An administrator can reorder, rename and
            delete stages.
          </AlertDescription>
        </Alert>
      ) : null}

      {stagesQuery.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : stagesQuery.isError ? (
        <EmptyState
          title="Could not load the pipeline"
          description={
            stagesQuery.error instanceof Error
              ? stagesQuery.error.message
              : 'Please try again in a moment.'
          }
          action={
            <Button variant="outline" size="sm" onClick={() => void stagesQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : order.length === 0 ? (
        <EmptyState
          title="No stages yet"
          description="Add the first stage candidates enter your pipeline through."
          action={
            canManage ? (
              <StageDialog
                trigger={
                  <Button size="sm">
                    <Plus className="size-4" aria-hidden="true" />
                    New stage
                  </Button>
                }
              />
            ) : null
          }
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={order.map((stage) => stage.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="space-y-3">
              {order.map((stage, index) => (
                <SortableStageRow
                  key={stage.id}
                  stage={stage}
                  position={index + 1}
                  siblings={order}
                  draggable={canManage}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      {order.length > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-start gap-x-6 gap-y-2 p-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Timer className="size-3.5" aria-hidden="true" />
              {order.filter((stage) => stage.slaDays !== null).length} stages have a target time
            </span>
            <span>
              {activeCount} active stage{activeCount === 1 ? '' : 's'} · a pipeline needs at least one
            </span>
            <span>The first stage is the intake stage and cannot be deleted.</span>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

interface SortableStageRowProps {
  stage: PipelineStageItem;
  position: number;
  siblings: readonly PipelineStageItem[];
  draggable: boolean;
}

function SortableStageRow({ stage, position, siblings, draggable }: SortableStageRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
    disabled: !draggable,
  });

  const categoryVariant = CATEGORY_VARIANTS[stage.category];

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'rounded-lg border border-border bg-card shadow-xs transition-shadow',
        isDragging && 'relative z-10 shadow-lg ring-2 ring-primary/30',
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={!draggable}
          aria-label={`Reorder ${stage.name}`}
          className={cn(
            'mt-0.5 rounded-sm p-1 text-muted-foreground transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            draggable ? 'cursor-grab hover:bg-accent hover:text-foreground active:cursor-grabbing' : 'cursor-default opacity-50',
          )}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>

        <span
          aria-hidden="true"
          className="mt-1 size-3 shrink-0 rounded-full border border-black/10"
          style={{ backgroundColor: stage.color }}
        />

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{stage.name}</span>
            <span className="text-2xs text-muted-foreground">#{position}</span>
            {stage.isDefault ? <Badge variant="outline">Intake</Badge> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{STAGE_TYPE_LABELS[stage.type]}</Badge>
            <Badge variant={categoryVariant}>{STAGE_CATEGORY_LABELS[stage.category]}</Badge>
            {stage.isTerminal ? <Badge variant="muted">Terminal</Badge> : null}
            {stage.slaDays !== null ? (
              <Badge variant="muted" className="gap-1">
                <Timer className="size-3" aria-hidden="true" />
                {stage.slaDays}d target
              </Badge>
            ) : null}
            <Badge variant="muted" className="font-mono">
              {stage.key}
            </Badge>
          </div>

          {stage.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">{stage.description}</p>
          ) : null}

          <p className="text-xs text-muted-foreground">
            {stage.applicationCount === 0
              ? 'No candidates in this stage'
              : `${stage.applicationCount} candidate${stage.applicationCount === 1 ? '' : 's'} in this stage`}
          </p>
        </div>

        {draggable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${stage.name}`}>
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <StageDialog
                mode="edit"
                stage={stage}
                trigger={
                  <DialogTrigger asChild>
                    <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                      <Pencil className="size-4" aria-hidden="true" />
                      Edit stage
                    </DropdownMenuItem>
                  </DialogTrigger>
                }
              />
              <DropdownMenuSeparator />
              <DeleteStageDialog
                stage={stage}
                siblings={siblings}
                trigger={
                  <DialogTrigger asChild>
                    <DropdownMenuItem destructive onSelect={(event) => event.preventDefault()}>
                      <Trash2 className="size-4" aria-hidden="true" />
                      Delete stage
                    </DropdownMenuItem>
                  </DialogTrigger>
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  );
}
