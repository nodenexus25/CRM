'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileUp,
  Play,
  UploadCloud,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  DUPLICATE_STRATEGY_HINTS,
  DUPLICATE_STRATEGY_LABELS,
  IMPORT_ENTITY_TYPE_LABELS,
  IMPORT_FIELD_DEFINITIONS,
  IMPORT_FILE_ACCEPT,
  duplicateStrategySchema,
  importEntityTypeSchema,
  type DuplicateStrategy,
  type ImportEntityType,
  type ImportJobSummary,
  type ImportMappingRequest,
  type ImportPreviewResponse,
  type ImportPreviewRow,
  type ImportSampleTemplate,
  type ImportTemplateSummary,
  type ImportUploadTicket,
  type Paginated,
  type UserListItem,
} from '@talentflow/types';
import { cn, formatBytes } from '@talentflow/ui';

import { ImportProgress } from '@/components/imports/import-progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { queryKeys } from '@/lib/query-keys';

/** Sentinel stored in a mapping to mean "leave this column out". */
const SKIP = '__skip__';
/** Radix `Select` rejects an empty string, so the "none" choices use a sentinel. */
const NONE = '__none__';
/** Mirrors the API's `importUploadQuerySchema` size cap. */
const MAX_BYTES = 50 * 1024 * 1024;

const STEPS = ['Entity & file', 'Map columns', 'Preview', 'Import'] as const;
type Step = 0 | 1 | 2 | 3;

const ENTITY_OPTIONS = importEntityTypeSchema.options;
const STRATEGY_OPTIONS = duplicateStrategySchema.options;

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};
const ACCEPTED_EXTENSIONS = Object.keys(MIME_BY_EXTENSION);

/** Browsers occasionally report an empty `type`; fall back to the extension. */
function resolveMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'text/csv';
}

/** Client-side gate mirroring the API's upload schema. */
function validateFile(file: File): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    return `“${file.name}” is not a supported file. Upload a CSV or Excel file.`;
  }
  if (file.size > MAX_BYTES) {
    return `“${file.name}” is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_BYTES)}.`;
  }
  return null;
}

function describeError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

/** Turns the raw CSV text of a sample into a browser download. */
function triggerDownload(fileName: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType || 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Direct browser → object-storage PUT with real progress via `XMLHttpRequest`. */
function putToStorage(
  ticket: ImportUploadTicket,
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
      else
        reject(
          new ApiError({ message: `Storage rejected the upload (status ${xhr.status}).` }, xhr.status),
        );
    };
    xhr.onerror = () =>
      reject(
        new ApiError(
          { message: 'The upload could not reach storage. Check your connection and try again.' },
          503,
        ),
      );
    xhr.ontimeout = () =>
      reject(new ApiError({ message: 'The upload timed out. Please try again.' }, 504));
    xhr.onabort = () => reject(new ApiError({ message: 'Upload cancelled.' }, 499));
    xhr.send(file);
  });
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function StepIndicator({ step }: { step: Step }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Import steps">
      {STEPS.map((label, index) => {
        const done = index < step;
        const active = index === step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full border text-2xs font-medium',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : done
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="size-3" aria-hidden="true" /> : index + 1}
            </span>
            <span className={cn(active ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {label}
            </span>
            {index < STEPS.length - 1 ? (
              <ChevronRight className="size-3.5 text-border" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function UploadProgressBar({ percent }: { percent: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Upload progress"
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

function FieldSelect({
  entity,
  id,
  value,
  onChange,
}: {
  entity: ImportEntityType;
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label="Destination field">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SKIP}>Don&apos;t import</SelectItem>
        {IMPORT_FIELD_DEFINITIONS[entity].map((field) => (
          <SelectItem key={field.key} value={field.key}>
            {field.label}
            {field.required ? ' *' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PreviewStatus({ row }: { row: ImportPreviewRow }) {
  if (row.errors.length > 0) {
    return (
      <ul className="space-y-0.5">
        {row.errors.map((error, index) => (
          <li key={`${error.field}-${index}`} className="flex items-start gap-1 text-2xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-medium">{error.field}</span>: {error.message}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (row.duplicateOf) {
    return <Badge variant="warning">Duplicate of {row.duplicateOf.label}</Badge>;
  }
  return <Badge variant="success">Valid</Badge>;
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

interface ImportWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Entity the wizard opens on. Defaults to `CANDIDATE`. */
  entity?: ImportEntityType;
  /** Fired once the job reaches a terminal state. */
  onCompleted?: (job: ImportJobSummary) => void;
}

/**
 * Four-step CSV / Excel import wizard.
 *
 * `POST /imports/upload-url` → presigned `PUT` of the bytes → `/preview` to
 * suggest a mapping → `/preview` again to validate the edited mapping → `/run`.
 * Once the run is accepted the body becomes the live `ImportProgress` panel, so
 * the user watches the counters climb without leaving the page.
 */
export function ImportWizardDialog({
  open,
  onOpenChange,
  entity: entityProp,
  onCompleted,
}: ImportWizardDialogProps) {
  const uid = useId();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const initialEntity = entityProp ?? 'CANDIDATE';

  const [step, setStep] = useState<Step>(0);
  const [entity, setEntity] = useState<ImportEntityType>(initialEntity);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [importJobId, setImportJobId] = useState<string | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>('SKIP');
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [ownerId, setOwnerId] = useState('');
  const [defaultSource, setDefaultSource] = useState('');
  const [tag, setTag] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [saveTemplateName, setSaveTemplateName] = useState('');

  const [running, setRunning] = useState(false);
  const [job, setJob] = useState<ImportJobSummary | null>(null);
  const [jobSettled, setJobSettled] = useState(false);

  const reset = useCallback(() => {
    xhrRef.current = null;
    setStep(0);
    setEntity(initialEntity);
    setFile(null);
    setDragging(false);
    setError(null);
    setUploading(false);
    setUploadProgress(0);
    setImportJobId(null);
    setPreviewing(false);
    setPreview(null);
    setMapping({});
    setDuplicateStrategy('SKIP');
    setHasHeaderRow(true);
    setOwnerId('');
    setDefaultSource('');
    setTag('');
    setTemplateId('');
    setSaveTemplateName('');
    setRunning(false);
    setJob(null);
    setJobSettled(false);
  }, [initialEntity]);

  // Reset on both open and close so nothing leaks between entities or runs.
  useEffect(() => {
    if (!open) xhrRef.current?.abort();
    reset();
  }, [open, reset]);

  const templates = useQuery({
    queryKey: queryKeys.imports.templates(entity),
    queryFn: () =>
      api.get<ImportTemplateSummary[]>('/imports/templates', { query: { entity } }),
    enabled: open && step === 1,
    staleTime: 30_000,
  });

  const owners = useQuery({
    queryKey: queryKeys.users.list({ status: 'ACTIVE', pageSize: 100 }),
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/users', { query: { status: 'ACTIVE', pageSize: 100 } }),
    enabled: open && step === 1,
    staleTime: 60_000,
  });

  const sample = useMutation({
    mutationFn: (target: ImportEntityType) =>
      api.get<ImportSampleTemplate>('/imports/sample', { query: { entity: target } }),
    onSuccess: (template) => {
      triggerDownload(template.fileName, template.mimeType, template.content);
    },
    onError: (caught: unknown) => {
      toast.error(describeError(caught, 'Could not fetch the sample file.'));
    },
  });

  function buildOptions(): ImportMappingRequest['options'] {
    return {
      duplicateStrategy,
      hasHeaderRow,
      ownerId: ownerId || null,
      defaultSource: defaultSource.trim() || null,
      tag: tag.trim() || null,
    };
  }

  function choose(selected: File | null | undefined) {
    if (!selected) return;
    const message = validateFile(selected);
    if (message) {
      setFile(null);
      setError(message);
      return;
    }
    // A new file invalidates the previously uploaded job/preview.
    setFile(selected);
    setImportJobId(null);
    setPreview(null);
    setMapping({});
    setError(null);
  }

  function changeEntity(next: ImportEntityType) {
    setEntity(next);
    setFile(null);
    setImportJobId(null);
    setPreview(null);
    setMapping({});
    setTemplateId('');
    setError(null);
    setUploadProgress(0);
  }

  async function uploadAndSuggest() {
    if (!file) return;
    setError(null);

    try {
      // Reuse the existing upload when the same file is still selected.
      let targetId = importJobId;
      if (!targetId) {
        setUploading(true);
        setUploadProgress(0);
        const ticket = await api.post<ImportUploadTicket>('/imports/upload-url', {
          entity,
          fileName: file.name,
          mimeType: resolveMimeType(file),
          sizeBytes: file.size,
        });
        await putToStorage(ticket, file, setUploadProgress, (xhr) => {
          xhrRef.current = xhr;
        });
        setUploadProgress(100);
        targetId = ticket.importJobId;
        setImportJobId(targetId);
      }

      setPreviewing(true);
      const suggested = await api.post<ImportPreviewResponse>(`/imports/${targetId}/preview`, {
        mapping: {},
        options: buildOptions(),
      });
      setPreview(suggested);
      setMapping({ ...suggested.suggestedMapping });
      setStep(1);
    } catch (caught) {
      setError(describeError(caught, 'The file could not be uploaded. Please try again.'));
    } finally {
      setUploading(false);
      setPreviewing(false);
    }
  }

  async function runPreview() {
    if (!importJobId) return;
    setError(null);
    setPreviewing(true);
    try {
      const result = await api.post<ImportPreviewResponse>(`/imports/${importJobId}/preview`, {
        mapping,
        options: buildOptions(),
      });
      setPreview(result);
      setStep(2);
    } catch (caught) {
      setError(describeError(caught, 'The preview could not be generated.'));
    } finally {
      setPreviewing(false);
    }
  }

  async function startRun() {
    if (!importJobId) return;
    setError(null);
    setRunning(true);
    try {
      const started = await api.post<ImportJobSummary>(`/imports/${importJobId}/run`, {
        mapping,
        options: buildOptions(),
        saveAsTemplate: saveTemplateName.trim() || null,
      });
      setJob(started);
      setJobSettled(false);
      setStep(3);
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports.all });
    } catch (caught) {
      setError(describeError(caught, 'The import could not be started.'));
      if (caught instanceof ApiError && caught.isConflict) {
        toast.error(caught.message);
      }
    } finally {
      setRunning(false);
    }
  }

  function handleSettled(settled: ImportJobSummary) {
    setJob(settled);
    setJobSettled(true);
    void queryClient.invalidateQueries({ queryKey: queryKeys.imports.all });
    if (settled.entity === 'CANDIDATE') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.all });
    } else if (settled.entity === 'JOB') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    }
    onCompleted?.(settled);
  }

  function applyTemplate(template: ImportTemplateSummary) {
    setTemplateId(template.id);
    setMapping({ ...template.mapping });
    const options = template.options;
    if (
      typeof options.duplicateStrategy === 'string' &&
      duplicateStrategySchema.safeParse(options.duplicateStrategy).success
    ) {
      setDuplicateStrategy(options.duplicateStrategy as DuplicateStrategy);
    }
    if (typeof options.hasHeaderRow === 'boolean') setHasHeaderRow(options.hasHeaderRow);
    if (typeof options.ownerId === 'string') setOwnerId(options.ownerId);
    if (typeof options.defaultSource === 'string') setDefaultSource(options.defaultSource);
    if (typeof options.tag === 'string') setTag(options.tag);
  }

  const requiredKeys = useMemo(
    () => IMPORT_FIELD_DEFINITIONS[entity].filter((field) => field.required).map((field) => field.key),
    [entity],
  );
  const unmappedRequired = useMemo(() => {
    const mapped = new Set(Object.values(mapping).filter((value) => value !== SKIP));
    return requiredKeys.filter((key) => !mapped.has(key));
  }, [mapping, requiredKeys]);

  const fieldLabels = useMemo(
    () => new Map(IMPORT_FIELD_DEFINITIONS[entity].map((field) => [field.key, field.label])),
    [entity],
  );

  const visibleHeaders = useMemo(() => {
    const headers = preview?.headers ?? [];
    const mapped = headers.filter((header) => {
      const target = mapping[header];
      return target !== undefined && target !== SKIP;
    });
    return mapped.length > 0 ? mapped : headers;
  }, [preview, mapping]);

  const listHref = entity === 'CANDIDATE' ? '/candidates' : entity === 'JOB' ? '/jobs' : null;
  const busy = uploading || previewing || running;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="size-4 text-primary" aria-hidden="true" />
            Import from CSV or Excel
          </DialogTitle>
          <DialogDescription>
            Upload a spreadsheet, map its columns onto TalentFlow fields, review a sample, then run
            the import. Nothing is written until you start the import.
          </DialogDescription>
        </DialogHeader>

        <StepIndicator step={step} />

        {error ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {/* Step 1 — entity + file ------------------------------------------ */}
        {step === 0 ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-entity`}>What are you importing?</Label>
                <Select
                  value={entity}
                  onValueChange={(value) => changeEntity(value as ImportEntityType)}
                >
                  <SelectTrigger id={`${uid}-entity`} aria-label="Import entity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTITY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {IMPORT_ENTITY_TYPE_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={sample.isPending}
                  disabled={sample.isPending}
                  onClick={() => sample.mutate(entity)}
                >
                  <Download className="size-4" aria-hidden="true" />
                  Download sample CSV
                </Button>
              </div>
            </div>

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
                <p className="text-sm font-medium">Drag and drop your file here</p>
                <p className="text-xs text-muted-foreground">
                  CSV or Excel · up to {formatBytes(MAX_BYTES)}
                </p>
              </div>
              <input
                ref={inputRef}
                id={`${uid}-file`}
                type="file"
                accept={IMPORT_FILE_ACCEPT}
                className="sr-only"
                aria-label="Import file"
                onChange={(event) => {
                  choose(event.target.files?.item(0));
                  event.target.value = '';
                }}
              />
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
                <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                </div>
              </div>
            ) : null}

            {uploading ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Spinner />
                  <span>Uploading…</span>
                </div>
                <UploadProgressBar percent={uploadProgress} />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Step 2 — mapping ------------------------------------------------ */}
        {step === 1 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-template`}>Start from a saved mapping</Label>
                <Select
                  value={templateId || NONE}
                  onValueChange={(value) => {
                    if (value === NONE) {
                      setTemplateId('');
                      return;
                    }
                    const match = (templates.data ?? []).find((entry) => entry.id === value);
                    if (match) applyTemplate(match);
                  }}
                >
                  <SelectTrigger id={`${uid}-template`} className="w-64" aria-label="Saved mapping">
                    <SelectValue placeholder="No template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No template</SelectItem>
                    {(templates.data ?? []).map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                {preview ? `${preview.headers.length} column${preview.headers.length === 1 ? '' : 's'} detected` : null}
              </p>
            </div>

            {!preview ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div
                className="max-h-72 overflow-y-auto rounded-lg border border-border"
                tabIndex={0}
                aria-label="Column mapping"
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/2">Column in file</TableHead>
                      <TableHead className="w-1/2">Imports into</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.headers.map((header, index) => (
                      <TableRow key={`${header}-${index}`}>
                        <TableCell>
                          <span className="font-mono text-xs" title={header}>
                            {header}
                          </span>
                        </TableCell>
                        <TableCell>
                          <FieldSelect
                            entity={entity}
                            id={`${uid}-map-${index}`}
                            value={mapping[header] ?? SKIP}
                            onChange={(value) =>
                              setMapping((prev) => ({ ...prev, [header]: value }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {unmappedRequired.length > 0 ? (
              <Alert variant="warning">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>Required fields are not mapped</AlertTitle>
                <AlertDescription>
                  Map a column onto {unmappedRequired.map((key) => fieldLabels.get(key) ?? key).join(', ')} before continuing.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`${uid}-strategy`}>When a row matches an existing record</Label>
                <Select
                  value={duplicateStrategy}
                  onValueChange={(value) => setDuplicateStrategy(value as DuplicateStrategy)}
                >
                  <SelectTrigger id={`${uid}-strategy`} aria-label="Duplicate strategy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STRATEGY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {DUPLICATE_STRATEGY_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {DUPLICATE_STRATEGY_HINTS[duplicateStrategy]}
                </p>
              </div>

              <div className="flex items-center gap-2 sm:col-span-2">
                <Checkbox
                  id={`${uid}-header`}
                  checked={hasHeaderRow}
                  onCheckedChange={(value) => setHasHeaderRow(value === true)}
                />
                <label htmlFor={`${uid}-header`} className="cursor-pointer text-sm">
                  The first row contains column headers
                </label>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-owner`}>Default owner</Label>
                <Select
                  value={ownerId || NONE}
                  onValueChange={(value) => setOwnerId(value === NONE ? '' : value)}
                >
                  <SelectTrigger id={`${uid}-owner`} aria-label="Default owner">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Unassigned</SelectItem>
                    {(owners.data?.items ?? []).map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-source`}>Default source</Label>
                <Input
                  id={`${uid}-source`}
                  value={defaultSource}
                  maxLength={60}
                  placeholder="e.g. LinkedIn"
                  onChange={(event) => setDefaultSource(event.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-tag`}>Tag every imported row</Label>
                <Input
                  id={`${uid}-tag`}
                  value={tag}
                  maxLength={60}
                  placeholder="e.g. spring-campaign"
                  onChange={(event) => setTag(event.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-save-template`}>Save this mapping as a template</Label>
                <Input
                  id={`${uid}-save-template`}
                  value={saveTemplateName}
                  maxLength={80}
                  placeholder="Optional template name"
                  onChange={(event) => setSaveTemplateName(event.target.value)}
                />
              </div>
            </div>
          </div>
        ) : null}

        {/* Step 3 — preview ------------------------------------------------- */}
        {step === 2 ? (
          <div className="space-y-3">
            {previewing ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                <span>Validating the sample…</span>
              </div>
            ) : null}

            {!preview ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-success">
                    {preview.validRows} ready
                  </span>
                  {' · '}
                  <span
                    className={cn(
                      preview.invalidRows > 0
                        ? 'font-medium text-destructive'
                        : 'text-muted-foreground',
                    )}
                  >
                    {preview.invalidRows} need attention
                  </span>
                  {' · '}
                  {preview.totalRowsSampled} row{preview.totalRowsSampled === 1 ? '' : 's'} sampled
                  out of the file.
                </p>

                <div
                  className="max-h-80 overflow-auto rounded-lg border border-border"
                  tabIndex={0}
                  aria-label="Preview sample"
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        {visibleHeaders.map((header) => (
                          <TableHead key={header}>
                            <span className="block text-foreground">{header}</span>
                            <span className="block text-2xs font-normal">
                              {fieldLabels.get(mapping[header] ?? '') ?? 'Ignored'}
                            </span>
                          </TableHead>
                        ))}
                        <TableHead className="min-w-40">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.map((row) => (
                        <TableRow key={row.rowNumber}>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.rowNumber}
                          </TableCell>
                          {visibleHeaders.map((header) => (
                            <TableCell key={header}>
                              <span className="block max-w-48 truncate text-xs" title={row.values[header] ?? ''}>
                                {row.values[header] ?? ''}
                              </span>
                            </TableCell>
                          ))}
                          <TableCell>
                            <PreviewStatus row={row} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* Step 4 — run + progress ----------------------------------------- */}
        {step === 3 && job ? (
          <ImportProgress importJobId={job.id} onSettled={handleSettled} />
        ) : null}

        <DialogFooter>
          {step === 0 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
                Cancel
              </Button>
              <Button onClick={() => void uploadAndSuggest()} disabled={!file} loading={busy}>
                {uploading || previewing ? null : <UploadCloud className="size-4" aria-hidden="true" />}
                Upload &amp; continue
              </Button>
            </>
          ) : step === 1 ? (
            <>
              <Button variant="outline" onClick={() => setStep(0)} disabled={busy}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back
              </Button>
              <Button
                onClick={() => void runPreview()}
                disabled={unmappedRequired.length > 0}
                loading={previewing}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Preview
              </Button>
            </>
          ) : step === 2 ? (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={busy}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back
              </Button>
              <Button
                onClick={() => void startRun()}
                disabled={unmappedRequired.length > 0 || !preview}
                loading={running}
              >
                <Play className="size-4" aria-hidden="true" />
                Start import
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {jobSettled ? 'Done' : 'Close and keep running'}
              </Button>
              {jobSettled && listHref ? (
                <Button asChild onClick={() => onOpenChange(false)}>
                  <Link href={listHref}>
                    <ExternalLink className="size-4" aria-hidden="true" />
                    View {IMPORT_ENTITY_TYPE_LABELS[entity]}
                  </Link>
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
