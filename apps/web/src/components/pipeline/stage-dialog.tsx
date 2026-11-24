'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  createPipelineStageSchema,
  stageCategorySchema,
  stageTypeSchema,
  STAGE_CATEGORY_LABELS,
  STAGE_TYPE_LABELS,
  type PipelineStageItem,
} from '@talentflow/types';
import { cn } from '@talentflow/ui';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';

/** Palette rather than a free-text hex field, so the value is always valid. */
const STAGE_COLORS = [
  '#64748B',
  '#0EA5E9',
  '#6366F1',
  '#8B5CF6',
  '#F59E0B',
  '#14B8A6',
  '#22C55E',
  '#EF4444',
  '#94A3B8',
] as const;

/**
 * The dialog collects the same constraints the API enforces; the API stays the
 * authority. `slugSchema` lowercases the key, so the preview below matches what
 * the server will store.
 */
const stageFormSchema = z.object({
  key: createPipelineStageSchema.shape.key,
  name: createPipelineStageSchema.shape.name,
  type: stageTypeSchema,
  category: stageCategorySchema,
  color: z.string().trim(),
  slaDays: z.string().trim(),
  description: z.string().trim().max(400),
  /** Only meaningful for ACTIVE stages; terminals derive it server-side. */
  isTerminal: z.boolean(),
});

type StageFormValues = z.infer<typeof stageFormSchema>;

const TYPE_OPTIONS = stageTypeSchema.options;
const CATEGORY_OPTIONS = stageCategorySchema.options;

const EMPTY: StageFormValues = {
  key: '',
  name: '',
  type: 'SCREENING',
  category: 'ACTIVE',
  color: '#64748B',
  slaDays: '',
  description: '',
  isTerminal: false,
};

interface StageDialogProps {
  mode?: 'create' | 'edit';
  stage?: PipelineStageItem;
  trigger: ReactNode;
}

/** Create or restyle a workspace pipeline stage. */
export function StageDialog({ mode = 'create', stage, trigger }: StageDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const form = useForm<StageFormValues>({
    resolver: zodResolver(stageFormSchema),
    defaultValues: EMPTY,
  });

  const color = form.watch('color');
  const category = form.watch('category');
  const isTerminal = form.watch('isTerminal');

  useEffect(() => {
    if (!open) return;
    form.reset(
      mode === 'edit' && stage
        ? {
            key: stage.key,
            name: stage.name,
            type: stage.type,
            category: stage.category,
            color: stage.color,
            slaDays: stage.slaDays === null ? '' : String(stage.slaDays),
            description: stage.description ?? '',
            isTerminal: stage.isTerminal,
          }
        : EMPTY,
    );
  }, [form, mode, open, stage]);

  const save = useMutation({
    mutationFn: (values: StageFormValues) => {
      const shared = {
        name: values.name,
        type: values.type,
        category: values.category,
        color: values.color,
        slaDays: values.slaDays === '' ? null : Number(values.slaDays),
        description: values.description || null,
      };

      if (mode === 'edit' && stage) {
        return api.patch<PipelineStageItem>(`/pipeline/stages/${stage.id}`, {
          ...shared,
          isTerminal: values.isTerminal,
        });
      }

      return api.post<PipelineStageItem>('/pipeline/stages', {
        ...shared,
        key: values.key,
        isTerminal: values.isTerminal,
      });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipeline.all });
      toast.success(mode === 'edit' ? `${saved.name} updated` : `${saved.name} added`);
      setOpen(false);
    },
    onError: (error) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;
  const submitting = save.isPending;
  const isDefaultStage = mode === 'edit' && stage?.isDefault;
  const terminalLocked = category !== 'ACTIVE';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? `Edit ${stage?.name}` : 'New pipeline stage'}</DialogTitle>
          <DialogDescription>
            Stages appear in order on every job&apos;s pipeline board. Jobs can override the set
            individually once they are created.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          className="space-y-4"
        >
          <fieldset disabled={submitting} className="space-y-4">
            {rootError ? (
              <Alert variant="destructive">
                <AlertDescription>{rootError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="stage-name">Name</Label>
                <Input id="stage-name" placeholder="Screening call" {...form.register('name')} />
                {form.formState.errors.name ? (
                  <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="stage-key">Key</Label>
                  {isDefaultStage ? (
                    <span className="text-2xs text-muted-foreground">Fixed</span>
                  ) : (
                    <span className="text-2xs text-muted-foreground">Stable identifier</span>
                  )}
                </div>
                <Input
                  id="stage-key"
                  className="font-mono"
                  placeholder="screening-call"
                  disabled={mode === 'edit'}
                  {...form.register('key')}
                />
                {form.formState.errors.key ? (
                  <p className="text-xs text-destructive">{form.formState.errors.key.message}</p>
                ) : (
                  <p className="text-2xs text-muted-foreground">
                    Lowercase letters, numbers and dashes. Used by automations and imports.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="stage-type">Stage type</Label>
                <Select
                  value={form.watch('type')}
                  onValueChange={(value) =>
                    form.setValue('type', value as StageFormValues['type'], { shouldDirty: true })
                  }
                >
                  <SelectTrigger id="stage-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {STAGE_TYPE_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="stage-category">Category</Label>
                <Select
                  value={category}
                  onValueChange={(value) =>
                    form.setValue('category', value as StageFormValues['category'], {
                      shouldDirty: true,
                    })
                  }
                  disabled={Boolean(isDefaultStage)}
                >
                  <SelectTrigger id="stage-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {STAGE_CATEGORY_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-2xs text-muted-foreground">
                  {terminalLocked
                    ? 'Non-active stages close the application.'
                    : 'Active stages keep an application open.'}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label asChild>
                <span>Colour</span>
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                {STAGE_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => form.setValue('color', swatch, { shouldDirty: true })}
                    aria-label={`Use ${swatch}`}
                    aria-pressed={color.toUpperCase() === swatch}
                    style={{ backgroundColor: swatch }}
                    className={cn(
                      'size-7 rounded-full border border-black/10 transition-transform',
                      color.toUpperCase() === swatch
                        ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                        : 'hover:scale-105',
                    )}
                  />
                ))}
              </div>
              {form.formState.errors.color ? (
                <p className="text-xs text-destructive">{form.formState.errors.color.message}</p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="stage-sla">SLA (days)</Label>
                <Input
                  id="stage-sla"
                  type="number"
                  min={1}
                  max={365}
                  placeholder="No target"
                  {...form.register('slaDays')}
                />
                {form.formState.errors.slaDays ? (
                  <p className="text-xs text-destructive">{form.formState.errors.slaDays.message}</p>
                ) : (
                  <p className="text-2xs text-muted-foreground">
                    Candidates sitting longer are flagged as stale.
                  </p>
                )}
              </div>

              {mode === 'edit' ? (
                <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="stage-terminal" className="cursor-pointer">
                      Terminal stage
                    </Label>
                    <p className="text-2xs text-muted-foreground">
                      {terminalLocked ? 'Forced on by the category.' : 'Closes the application here.'}
                    </p>
                  </div>
                  <Switch
                    id="stage-terminal"
                    checked={terminalLocked || isTerminal}
                    disabled={terminalLocked}
                    onCheckedChange={(checked) =>
                      form.setValue('isTerminal', checked, { shouldDirty: true })
                    }
                  />
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stage-description">Description</Label>
              <Textarea
                id="stage-description"
                rows={2}
                placeholder="What happens to a candidate while they are in this stage."
                {...form.register('description')}
              />
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={submitting}
              disabled={form.watch('name').trim().length === 0}
            >
              {mode === 'edit' ? 'Save changes' : 'Add stage'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
