'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  FileText,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  ShieldOff,
  Star,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  RESUME_PARSE_STATUS_LABELS,
  type CandidateDetail,
  type Paginated,
  type ResumeDetail,
  type ResumeParseStatus,
  type ResumeSummary,
} from '@talentflow/types';
import { formatBytes, formatDate } from '@talentflow/ui';

import { ResumeReviewDialog } from '@/components/resumes/resume-review-dialog';
import { ResumeUploadDialog } from '@/components/resumes/resume-upload-dialog';
import { useResumeListPolling } from '@/components/resumes/use-resume-polling';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const STATUS_VARIANT: Record<ResumeParseStatus, BadgeProps['variant']> = {
  PENDING: 'muted',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'destructive',
  NEEDS_OCR: 'warning',
};

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

interface ResumePanelProps {
  candidate: CandidateDetail;
}

/**
 * The Résumé tab: every file attached to a candidate, with upload, review,
 * re-parse, primary/rename/download and delete actions.
 *
 * Writes are gated by `candidate:create`; reads by either candidate read scope.
 * While a row is still parsing the list refetches on a short cadence through the
 * shared `useResumeListPolling` hook, so statuses settle without a manual
 * refresh and stop polling the moment the last row is terminal.
 */
export function ResumePanel({ candidate }: ResumePanelProps) {
  const { has, tenant } = useSession();
  const queryClient = useQueryClient();

  const canRead = has('candidate:read_all') || has('candidate:read_own');
  const canWrite = has('candidate:create');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ResumeSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const downloadTabRef = useRef<Window | null>(null);

  const list = useQuery({
    queryKey: queryKeys.resumes.list({ candidateId: candidate.id }),
    queryFn: () =>
      api.get<Paginated<ResumeSummary>>('/resumes', {
        query: { candidateId: candidate.id, pageSize: 50, sortBy: 'createdAt' },
      }),
    enabled: canRead,
  });

  const resumes = list.data?.items ?? [];
  useResumeListPolling(resumes, { enabled: canRead });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.resumes.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.all });
  }

  const reparse = useMutation({
    mutationFn: (id: string) => api.post<ResumeDetail>(`/resumes/${id}/reparse`, { parser: 'auto' }),
    onSuccess: () => {
      invalidate();
      toast.success('Re-parsing résumé…');
    },
    onError: (error: unknown) => toast.error(describeError(error, 'Could not start a re-parse.')),
  });

  const setPrimary = useMutation({
    mutationFn: (id: string) => api.patch<ResumeDetail>(`/resumes/${id}`, { isPrimary: true }),
    onSuccess: () => {
      invalidate();
      toast.success('Primary résumé updated');
    },
    onError: (error: unknown) =>
      toast.error(describeError(error, 'Could not set the primary résumé.')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/resumes/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Résumé deleted');
    },
    onError: (error: unknown) => toast.error(describeError(error, 'Could not delete the résumé.')),
  });

  const rename = useMutation({
    mutationFn: ({ id, fileName }: { id: string; fileName: string }) =>
      api.patch<ResumeDetail>(`/resumes/${id}`, { fileName }),
    onSuccess: () => {
      invalidate();
      setRenameTarget(null);
      toast.success('Résumé renamed');
    },
    onError: (error: unknown) => toast.error(describeError(error, 'Could not rename the résumé.')),
  });

  // The link is minted per request, so download fetches a fresh detail first.
  // The tab is opened synchronously so the browser treats it as user-initiated.
  const download = useMutation({
    mutationFn: (id: string) => api.get<ResumeDetail>(`/resumes/${id}`),
    onSuccess: (detail) => {
      const tab = downloadTabRef.current;
      downloadTabRef.current = null;
      if (!detail.downloadUrl) {
        tab?.close();
        toast.error('A download link could not be generated for this résumé.');
        return;
      }
      if (tab) tab.location.href = detail.downloadUrl;
      else window.open(detail.downloadUrl, '_blank', 'noopener,noreferrer');
    },
    onError: (error: unknown) => {
      downloadTabRef.current?.close();
      downloadTabRef.current = null;
      toast.error(describeError(error, 'Could not prepare the download.'));
    },
  });

  function startDownload(id: string) {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    downloadTabRef.current = tab;
    download.mutate(id);
  }

  function openRename(resume: ResumeSummary) {
    setRenameTarget(resume);
    setRenameValue(resume.fileName);
  }

  if (!canRead) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="You do not have access to résumés"
        description="Ask a workspace administrator for the “View candidates” permission."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Résumés</h3>
          <p className="text-xs text-muted-foreground">
            {resumes.length === 0
              ? 'No files attached yet.'
              : `${resumes.length} file${resumes.length === 1 ? '' : 's'} on this candidate.`}
          </p>
        </div>
        {canWrite ? (
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <UploadCloud className="size-4" aria-hidden="true" />
            Upload résumé
          </Button>
        ) : null}
      </div>

      {list.isPending ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <EmptyState
          title="Could not load résumés"
          description={describeError(list.error, 'Please try again in a moment.')}
          action={
            <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
              Retry
            </Button>
          }
        />
      ) : resumes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No résumé on file"
          description="Upload a résumé and TalentFlow parses it into the profile for you to review."
          action={
            canWrite ? (
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <UploadCloud className="size-4" aria-hidden="true" />
                Upload résumé
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {resumes.map((resume) => {
            const parsing = resume.parseStatus === 'PROCESSING' || resume.parseStatus === 'PENDING';
            return (
              <li
                key={resume.id}
                className="flex flex-wrap items-start gap-3 px-3 py-3 first:rounded-t-lg last:rounded-b-lg sm:px-4"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <FileText className="size-4" aria-hidden="true" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 truncate text-sm font-medium">{resume.fileName}</p>
                    {resume.isPrimary ? <Badge variant="default">Primary</Badge> : null}
                    <Badge variant={STATUS_VARIANT[resume.parseStatus]}>
                      {RESUME_PARSE_STATUS_LABELS[resume.parseStatus]}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatBytes(resume.sizeBytes)} · added{' '}
                    {formatDate(resume.createdAt, 'DD MMM YYYY', tenant?.timezone)}
                    {resume.uploadedBy ? <> · {resume.uploadedBy.fullName}</> : null}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {canWrite ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={resume.parseStatus !== 'COMPLETED'}
                      onClick={() => setReviewId(resume.id)}
                      title={
                        resume.parseStatus === 'COMPLETED'
                          ? undefined
                          : 'Review is available once the résumé has parsed.'
                      }
                    >
                      {parsing ? 'Parsing…' : 'Review & accept'}
                    </Button>
                  ) : null}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${resume.fileName}`}
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canWrite ? (
                        <>
                          <DropdownMenuItem onSelect={() => openRename(resume)}>
                            <Pencil className="size-4" aria-hidden="true" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => reparse.mutate(resume.id)}
                            disabled={reparse.isPending}
                          >
                            <RefreshCw className="size-4" aria-hidden="true" />
                            Re-parse
                          </DropdownMenuItem>
                          {!resume.isPrimary ? (
                            <DropdownMenuItem
                              onSelect={() => setPrimary.mutate(resume.id)}
                              disabled={setPrimary.isPending}
                            >
                              <Star className="size-4" aria-hidden="true" />
                              Set as primary
                            </DropdownMenuItem>
                          ) : null}
                        </>
                      ) : null}
                      <DropdownMenuItem onSelect={() => startDownload(resume.id)}>
                        <Download className="size-4" aria-hidden="true" />
                        Download
                      </DropdownMenuItem>
                      {canWrite ? (
                        <>
                          <DropdownMenuSeparator />
                          <ConfirmDialog
                            destructive
                            title={`Delete “${resume.fileName}”?`}
                            description="The file is removed from this candidate. Any data already reviewed into the profile is kept."
                            confirmLabel="Delete résumé"
                            trigger={
                              <DialogTrigger asChild>
                                <DropdownMenuItem
                                  destructive
                                  onSelect={(event) => event.preventDefault()}
                                >
                                  <Trash2 className="size-4" aria-hidden="true" />
                                  Delete
                                </DropdownMenuItem>
                              </DialogTrigger>
                            }
                            onConfirm={() => remove.mutateAsync(resume.id).then(() => undefined)}
                          />
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canWrite ? (
        <ResumeUploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          candidateId={candidate.id}
          onUploaded={(uploaded) => {
            invalidate();
            setUploadOpen(false);
            setReviewId(uploaded.id);
          }}
        />
      ) : null}

      {canWrite && reviewId ? (
        <ResumeReviewDialog
          open={reviewId !== null}
          onOpenChange={(open) => {
            if (!open) setReviewId(null);
          }}
          resumeId={reviewId}
          candidateId={candidate.id}
          onAccepted={() => {
            invalidate();
            setReviewId(null);
          }}
        />
      ) : null}

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename résumé</DialogTitle>
            <DialogDescription>
              Give this file a name that is easy to recognise later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="resume-rename">File name</Label>
            <Input
              id="resume-rename"
              value={renameValue}
              maxLength={255}
              onChange={(event) => setRenameValue(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} disabled={rename.isPending}>
              Cancel
            </Button>
            <Button
              loading={rename.isPending}
              disabled={renameValue.trim().length === 0}
              onClick={() => {
                if (renameTarget) {
                  rename.mutate({ id: renameTarget.id, fileName: renameValue.trim() });
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
