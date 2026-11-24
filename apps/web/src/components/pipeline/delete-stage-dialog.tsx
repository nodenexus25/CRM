'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import type { PipelineStageItem } from '@talentflow/types';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const NO_TARGET = '__none__';

interface DeleteStageDialogProps {
  /** The stage being retired. */
  stage: PipelineStageItem;
  /** Every other stage in the pipeline — the possible destinations. */
  siblings: readonly PipelineStageItem[];
  trigger: ReactNode;
}

/**
 * Deleting a stage that still holds applications requires a destination: the
 * API moves every candidate (and records stage history) in the same
 * transaction, so this dialog mirrors that contract rather than hiding it.
 */
export function DeleteStageDialog({ stage, siblings, trigger }: DeleteStageDialogProps) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) setTarget('');
  }, [open]);

  const locked = stage.isDefault;
  const holding = stage.applicationCount > 0;
  const destinations = siblings.filter((candidate) => candidate.id !== stage.id);

  const remove = useMutation({
    mutationFn: () =>
      api.delete<{ deleted: true; movedApplications: number }>(`/pipeline/stages/${stage.id}`, {
        query: { moveToStageId: target || undefined },
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipeline.all });
      toast.success(
        result.movedApplications > 0
          ? `${stage.name} deleted · ${result.movedApplications} candidate${
              result.movedApplications === 1 ? '' : 's'
            } moved`
          : `${stage.name} deleted`,
      );
      setOpen(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete this stage');
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
            Delete {stage.name}?
          </DialogTitle>
          <DialogDescription>
            {locked
              ? 'The intake stage cannot be deleted — every candidate enters the pipeline there. Rename it instead.'
              : holding
                ? `This stage holds ${stage.applicationCount} application${
                    stage.applicationCount === 1 ? '' : 's'
                  }. Every candidate is moved, and the move is recorded in their history.`
                : 'Nothing is in this stage, so no candidate is affected. Jobs that already copied the pipeline keep their own version of it.'}
          </DialogDescription>
        </DialogHeader>

        {!locked && holding ? (
          <div className="space-y-1.5">
            <Label htmlFor="stage-move-target">Move candidates to</Label>
            <Select value={target || NO_TARGET} onValueChange={(value) => setTarget(value === NO_TARGET ? '' : value)}>
              <SelectTrigger id="stage-move-target">
                <SelectValue placeholder="Choose a stage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TARGET}>Choose a stage…</SelectItem>
                {destinations.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {locked ? (
          <Alert>
            <AlertDescription>
              Mark the stage inactive from the pipeline list, or rename it, if it is no longer needed.
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={remove.isPending}
            disabled={locked || (holding && !target)}
            onClick={() => remove.mutate()}
          >
            {holding ? 'Move and delete' : 'Delete stage'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
