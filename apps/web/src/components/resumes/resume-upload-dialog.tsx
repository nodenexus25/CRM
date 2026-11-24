'use client';

import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, FileText, FileUp, UploadCloud } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  RESUME_FILE_TYPES,
  RESUME_MAX_BYTES,
  RESUME_MIME_TYPES,
  fileExtension,
  isResumeFileAllowed,
  type ResumeDetail,
  type ResumeUploadRequest,
  type ResumeUploadTicket,
} from '@talentflow/types';
import { cn, formatBytes } from '@talentflow/ui';

import { isTerminalResumeStatus, useResumePolling } from '@/components/resumes/use-resume-polling';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';

/** `accept` hint for the picker, e.g. `.pdf,.docx,.doc,.txt,.rtf`. */
const ACCEPT_ATTRIBUTE = RESUME_FILE_TYPES.flatMap((type) => type.extensions).join(',');
const ACCEPTED_TYPES = RESUME_FILE_TYPES.map((type) => type.label).join(', ');

type Phase = 'idle' | 'uploading' | 'finalizing' | 'parsing' | 'done' | 'error';

interface ResumeUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Attach to an existing candidate, or omit for a detached (import) upload. */
  candidateId?: string;
  /** Called once the parse reaches a terminal state. */
  onUploaded: (resume: ResumeDetail) => void;
}

/**
 * Resolves the content type to declare for a picked file.
 *
 * Browsers occasionally report an empty `type`; in that case the extension is
 * mapped back to the MIME type the API expects so the extension/MIME
 * cross-check in `resumeUploadRequestSchema` still has something to match.
 */
function resolveMimeType(file: File): string {
  if (file.type && Object.prototype.hasOwnProperty.call(RESUME_MIME_TYPES, file.type)) {
    return file.type;
  }
  const extension = fileExtension(file.name);
  const match = Object.entries(RESUME_MIME_TYPES).find(([, extensions]) =>
    extensions.includes(extension),
  );
  return match?.[0] ?? file.type;
}

/** Client-side gate mirroring the API's upload schema. */
function validateFile(file: File): string | null {
  if (!isResumeFileAllowed(file.name, resolveMimeType(file))) {
    return `“${file.name}” is not an accepted résumé file. Upload ${ACCEPTED_TYPES}.`;
  }
  if (file.size > RESUME_MAX_BYTES) {
    return `“${file.name}” is ${formatBytes(file.size)} — the limit is ${formatBytes(RESUME_MAX_BYTES)}.`;
  }
  return null;
}

function describeUploadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) {
      return `This file is larger than the ${formatBytes(RESUME_MAX_BYTES)} limit.`;
    }
    if (error.status === 422) {
      return 'The file’s contents do not match its extension. Choose a genuine PDF, DOCX, DOC, TXT or RTF file and try again.';
    }
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : 'The résumé could not be uploaded. Please try again.';
}

/** Whether an error is a documented type/size rejection with an inline explanation. */
function isRejection(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 413 || error.status === 422);
}

/** Direct browser → object-storage PUT with real progress via `XMLHttpRequest`. */
function putToStorage(
  ticket: ResumeUploadTicket,
  file: File,
  onProgress: (percent: number) => void,
  register: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open(ticket.method, ticket.uploadUrl, true);
    xhr.timeout = 300_000;
    for (const [header, value] of Object.entries(ticket.headers)) {
      xhr.setRequestHeader(header, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError({ message: `Storage rejected the upload (status ${xhr.status}).` }, xhr.status));
    };
    xhr.onerror = () =>
      reject(
        new ApiError(
          { message: 'The upload could not reach storage. Check your connection and try again.' },
          503,
        ),
      );
    xhr.ontimeout = () => reject(new ApiError({ message: 'The upload timed out. Please try again.' }, 504));
    xhr.onabort = () => reject(new ApiError({ message: 'Upload cancelled.' }, 499));
    xhr.send(file);
  });
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-200"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function IndeterminateBar({ label }: { label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
    </div>
  );
}

/**
 * Upload a résumé to object storage, then wait for the parse to settle.
 *
 * The presigned `PUT` is issued straight to storage with `XMLHttpRequest` so the
 * dialog can show genuine progress; the `api` client is only used for the
 * upload ticket and the completion call, both of which need the session cookie.
 */
export function ResumeUploadDialog({
  open,
  onOpenChange,
  candidateId,
  onUploaded,
}: ResumeUploadDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  // Bumped on reset; a run whose token no longer matches is stale and ignored.
  const runRef = useRef(0);
  const startedRunRef = useRef(-1);
  const notifiedRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resume, setResume] = useState<ResumeDetail | null>(null);
  const [dragging, setDragging] = useState(false);

  const reset = useCallback(() => {
    runRef.current += 1;
    startedRunRef.current = -1;
    notifiedRef.current = null;
    xhrRef.current = null;
    setFile(null);
    setPhase('idle');
    setProgress(0);
    setError(null);
    setResume(null);
    setDragging(false);
  }, []);

  useEffect(() => {
    if (open) reset();
    else xhrRef.current?.abort();
  }, [open, reset]);

  const upload = useMutation({
    mutationFn: async (selected: File) => {
      const runId = runRef.current;
      startedRunRef.current = runId;

      const request: ResumeUploadRequest = {
        fileName: selected.name,
        mimeType: resolveMimeType(selected),
        sizeBytes: selected.size,
      };
      const ticket = await api.post<ResumeUploadTicket>('/resumes/upload-url', request);
      if (runRef.current !== runId) throw new ApiError({ message: 'Upload cancelled.' }, 499);

      setPhase('uploading');
      await putToStorage(ticket, selected, setProgress, (xhr) => {
        xhrRef.current = xhr;
      });
      if (runRef.current !== runId) throw new ApiError({ message: 'Upload cancelled.' }, 499);

      setPhase('finalizing');
      return api.post<ResumeDetail>(
        `/resumes/${ticket.resumeId}/complete`,
        candidateId ? { candidateId } : {},
      );
    },
    onSuccess: (detail) => {
      if (startedRunRef.current !== runRef.current) return;
      setProgress(100);
      setResume(detail);
      setPhase(isTerminalResumeStatus(detail.parseStatus) ? 'done' : 'parsing');
    },
    onError: (caught: unknown) => {
      if (startedRunRef.current !== runRef.current) return;
      const message = describeUploadError(caught);
      setError(message);
      setPhase('error');
      // Type/size rejections get a dedicated inline explanation; everything
      // else also surfaces a toast so the failure is not missed.
      if (!isRejection(caught)) toast.error(message);
    },
  });

  const polling = useResumePolling(
    resume && !isTerminalResumeStatus(resume.parseStatus) ? resume.id : null,
  );
  const liveResume = polling.data ?? resume;

  useEffect(() => {
    if (!liveResume || !isTerminalResumeStatus(liveResume.parseStatus)) return;
    if (notifiedRef.current === liveResume.id) return;
    notifiedRef.current = liveResume.id;
    setPhase('done');
    onUploaded(liveResume);
  }, [liveResume, onUploaded]);

  function choose(selected: File | null | undefined) {
    if (!selected) return;
    const validationError = validateFile(selected);
    if (validationError) {
      setFile(null);
      setError(validationError);
      setPhase('idle');
      return;
    }
    setFile(selected);
    setError(null);
    setPhase('idle');
  }

  function start() {
    if (!file) return;
    runRef.current += 1;
    setError(null);
    setResume(null);
    setProgress(0);
    setPhase('uploading');
    upload.mutate(file);
  }

  const busy = phase === 'uploading' || phase === 'finalizing' || phase === 'parsing';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="size-4 text-primary" aria-hidden="true" />
            Upload résumé
          </DialogTitle>
          <DialogDescription>
            {candidateId
              ? 'Attach a résumé to this candidate. It is parsed automatically once the upload finishes.'
              : 'Upload a résumé and TalentFlow parses it into a candidate you can review before saving.'}
          </DialogDescription>
        </DialogHeader>

        {phase === 'idle' || phase === 'error' ? (
          <>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                choose(event.dataTransfer.files.item(0));
              }}
              className={cn(
                'flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center transition-colors',
                dragging ? 'border-primary bg-primary/5' : 'border-border',
              )}
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <UploadCloud className="size-5" aria-hidden="true" />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium">Drag and drop a résumé here</p>
                <p className="text-xs text-muted-foreground">
                  {ACCEPTED_TYPES} · up to {formatBytes(RESUME_MAX_BYTES)}
                </p>
              </div>
              <input
                ref={inputRef}
                id={inputId}
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                className="sr-only"
                aria-label="Résumé file"
                onChange={(event) => {
                  choose(event.target.files?.item(0));
                  event.target.value = '';
                }}
              />
              <label htmlFor={inputId} className="sr-only">
                Résumé file
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
              >
                <UploadCloud className="size-4" aria-hidden="true" />
                Choose file
              </Button>
            </div>

            {file ? (
              <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                </div>
              </div>
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not upload this résumé</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : null}

        {phase === 'uploading' || phase === 'finalizing' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Spinner />
              <span>{phase === 'finalizing' ? 'Confirming upload…' : 'Uploading…'}</span>
            </div>
            <ProgressBar percent={phase === 'finalizing' ? 100 : progress} label="Upload progress" />
          </div>
        ) : null}

        {phase === 'parsing' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Spinner />
              <span>Parsing…</span>
            </div>
            <IndeterminateBar label="Parsing résumé" />
            <p className="text-xs text-muted-foreground">
              Extracting skills, experience and contact details. This usually takes a few seconds.
            </p>
          </div>
        ) : null}

        {phase === 'done' ? (
          <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/8 px-3 py-2 text-sm">
            <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
            <span>Résumé parsed.</span>
          </div>
        ) : null}

        <DialogFooter>
          {phase === 'done' ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : busy ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={upload.isPending}>
                Cancel
              </Button>
              <Button onClick={start} disabled={!file} loading={upload.isPending}>
                Upload résumé
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
