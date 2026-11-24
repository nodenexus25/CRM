'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Pin, PinOff, StickyNote, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  createNoteSchema,
  type EntityType,
  type NoteItem,
  type NoteQuery,
  type Paginated,
} from '@talentflow/types';
import { cn, formatRelativeTime, getInitials } from '@talentflow/ui';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogTrigger } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

/** The composer reuses the write schema's body constraints verbatim. */
const composerSchema = z.object({ body: createNoteSchema.shape.body });
type ComposerValues = z.infer<typeof composerSchema>;

interface NotesPanelProps {
  entityType: EntityType;
  entityId: string;
  /** Denormalised candidate link, when the note sits on a candidate's record. */
  candidateId?: string | null;
  className?: string;
}

/**
 * Pinnable, editable notes on any record. Unlike the activity timeline a note
 * is always editable and never carries a direction, duration or outcome, so it
 * gets its own panel rather than sharing the activity list.
 */
export function NotesPanel({ entityType, entityId, candidateId, className }: NotesPanelProps) {
  const { has, user } = useSession();
  const queryClient = useQueryClient();

  const canRead = has('note:read');
  const canCreate = has('note:create');
  const canDelete = has('note:delete');
  // Mirrors the API: `note:update` covers your own notes; editing someone
  // else's needs the moderator-tier `note:delete` as well.
  const canUpdateNote = (note: NoteItem) =>
    has('note:update') && (canDelete || (note.createdBy !== null && note.createdBy.id === user?.id));

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');

  const listQuery: Partial<NoteQuery> = { entityType, entityId };

  const notes = useQuery({
    queryKey: queryKeys.notes.list(listQuery),
    queryFn: () =>
      api.get<Paginated<NoteItem>>('/notes', { query: { entityType, entityId, pageSize: 50 } }),
    enabled: canRead,
    staleTime: 15_000,
  });

  const composer = useForm<ComposerValues>({
    resolver: zodResolver(composerSchema),
    defaultValues: { body: '' },
  });

  function invalidateNotes() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.notes.all });
  }

  const create = useMutation({
    mutationFn: (values: ComposerValues) =>
      api.post<NoteItem>('/notes', {
        body: values.body,
        entityType,
        entityId,
        ...(candidateId ? { candidateId } : {}),
      }),
    onSuccess: () => {
      invalidateNotes();
      composer.reset({ body: '' });
      toast.success('Note added');
    },
    onError: (error: unknown) => {
      composer.setError('root', {
        type: 'server',
        message: applyApiError(error, composer.setError),
      });
    },
  });

  const update = useMutation({
    mutationFn: (input: { id: string; body?: string; isPinned?: boolean }) =>
      api.patch<NoteItem>(`/notes/${input.id}`, {
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
      }),
    onSuccess: () => {
      invalidateNotes();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not update the note');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/notes/${id}`),
    onSuccess: () => {
      invalidateNotes();
      toast.success('Note deleted');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete the note');
    },
  });

  if (!canRead) return null;

  const items = notes.data?.items ?? [];
  const rootError = composer.formState.errors.root?.message;

  function saveEdit(note: NoteItem) {
    const body = editingBody.trim();
    if (body.length === 0) return;
    update.mutate(
      { id: note.id, body },
      {
        onSuccess: () => {
          setEditingId(null);
          setEditingBody('');
        },
      },
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <StickyNote className="size-4 text-muted-foreground" aria-hidden="true" />
          Notes
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {canCreate ? (
          <form
            noValidate
            onSubmit={composer.handleSubmit((values) => create.mutate(values))}
            className="space-y-2"
          >
            {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}
            <Textarea
              rows={2}
              placeholder="Add a note…"
              aria-label="New note"
              {...composer.register('body')}
            />
            {composer.formState.errors.body ? (
              <p className="text-xs text-destructive">{composer.formState.errors.body.message}</p>
            ) : null}
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                loading={create.isPending}
                disabled={composer.watch('body').trim().length === 0}
              >
                Add note
              </Button>
            </div>
          </form>
        ) : null}

        {notes.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : notes.isError ? (
          <EmptyState
            title="Could not load notes"
            description={notes.error instanceof Error ? notes.error.message : 'Please try again.'}
            action={
              <Button variant="outline" size="sm" onClick={() => void notes.refetch()}>
                Retry
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No notes yet. {canCreate ? 'Add the first one above.' : ''}
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((note) => {
              const editing = editingId === note.id;
              return (
                <li
                  key={note.id}
                  className={cn(
                    'rounded-lg border border-border p-3',
                    note.isPinned && 'border-primary/40 bg-primary/5',
                  )}
                >
                  {editing ? (
                    <div className="space-y-2">
                      <Textarea
                        rows={3}
                        value={editingBody}
                        aria-label="Edit note"
                        onChange={(event) => setEditingBody(event.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingId(null);
                            setEditingBody('');
                          }}
                          disabled={update.isPending}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          loading={update.isPending}
                          disabled={editingBody.trim().length === 0}
                          onClick={() => saveEdit(note)}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                          <Avatar className="size-5">
                            {note.createdBy?.avatarUrl ? (
                              <AvatarImage src={note.createdBy.avatarUrl} alt="" />
                            ) : null}
                            <AvatarFallback className="text-[9px]">
                              {note.createdBy ? getInitials(note.createdBy.fullName) : 'TF'}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate">
                            {note.createdBy?.fullName ?? 'TalentFlow'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="whitespace-nowrap">
                            {formatRelativeTime(note.updatedAt)}
                          </span>
                          {note.isPinned ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="flex items-center gap-1 text-primary">
                                <Pin className="size-3" aria-hidden="true" />
                                Pinned
                              </span>
                            </>
                          ) : null}
                        </div>

                        {canUpdateNote(note) || canDelete ? (
                          <div className="flex shrink-0 items-center gap-1">
                            {canUpdateNote(note) ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={note.isPinned ? 'Unpin note' : 'Pin note'}
                                disabled={update.isPending}
                                onClick={() =>
                                  update.mutate({ id: note.id, isPinned: !note.isPinned })
                                }
                              >
                                {note.isPinned ? (
                                  <PinOff className="size-3.5" aria-hidden="true" />
                                ) : (
                                  <Pin className="size-3.5" aria-hidden="true" />
                                )}
                              </Button>
                            ) : null}
                            {canUpdateNote(note) ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Edit note"
                                onClick={() => {
                                  setEditingId(note.id);
                                  setEditingBody(note.body);
                                }}
                              >
                                <Pencil className="size-3.5" aria-hidden="true" />
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <ConfirmDialog
                                destructive
                                title="Delete this note?"
                                description="It is removed from this record for everyone. This cannot be undone."
                                confirmLabel="Delete note"
                                trigger={
                                  <DialogTrigger asChild>
                                    <Button variant="ghost" size="icon-sm" aria-label="Delete note">
                                      <Trash2
                                        className="size-3.5 text-destructive"
                                        aria-hidden="true"
                                      />
                                    </Button>
                                  </DialogTrigger>
                                }
                                onConfirm={() => remove.mutateAsync(note.id).then(() => undefined)}
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
