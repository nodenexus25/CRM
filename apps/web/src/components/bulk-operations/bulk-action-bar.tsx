'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  BriefcaseBusiness,
  Download,
  Flame,
  ListPlus,
  Tags,
  Trash2,
  UserCog,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import {
  BULK_OPERATION_TYPE_LABELS,
  CANDIDATE_STATUS_LABELS,
  JOB_STATUS_LABELS,
  PRIORITY_LABELS,
  candidateStatusSchema,
  jobStatusSchema,
  prioritySchema,
  type BulkOperationItem,
  type BulkSelection,
  type CandidateListSummary,
  type CandidateStatus,
  type CreateBulkOperationRequest,
  type JobListItem,
  type JobPipelineStageSummary,
  type JobStatus,
  type Paginated,
  type Priority,
  type UserListItem,
} from '@talentflow/types';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const numberFormatter = new Intl.NumberFormat();

/** Sentinel for the "Unassigned" choice in the owner picker. */
const UNASSIGNED = '__unassigned__';

/** Splits a comma-separated tag field into a de-duplicated, capped list. */
function parseTags(value: string): string[] {
  const seen = new Set<string>();
  for (const entry of value.split(',')) {
    const tag = entry.trim();
    if (tag.length > 0) seen.add(tag);
  }
  return Array.from(seen).slice(0, 50);
}

interface BulkActionProps {
  selection: BulkSelection;
  /** How many records the action will touch. */
  count: number;
  /** Singular noun, e.g. "candidate". */
  noun: string;
  pending: boolean;
  /** Resolves to `false` when the request failed, so dialogs stay open. */
  start: (request: CreateBulkOperationRequest) => Promise<boolean>;
}

/** A disabled action button that explains why via a tooltip and a `title`. */
function GatedButton({
  label,
  icon: Icon,
  reason,
  destructive = false,
}: {
  label: string;
  icon: LucideIcon;
  reason: string;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" tabIndex={0}>
          <Button
            variant="outline"
            size="sm"
            disabled
            title={reason}
            className={destructive ? 'text-destructive' : undefined}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

interface ActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  icon: LucideIcon;
  allowed: boolean;
  reason: string;
  title: string;
  description: string;
  submitLabel: string;
  canSubmit: boolean;
  pending: boolean;
  onSubmit: () => void;
  children: ReactNode;
}

/** A toolbar action that opens a small dialog to collect its payload. */
function ActionDialog({
  open,
  onOpenChange,
  label,
  icon: Icon,
  allowed,
  reason,
  title,
  description,
  submitLabel,
  canSubmit,
  pending,
  onSubmit,
  children,
}: ActionDialogProps) {
  if (!allowed) return <GatedButton label={label} icon={Icon} reason={reason} />;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button loading={pending} disabled={!canSubmit} onClick={onSubmit}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Candidate actions
// ---------------------------------------------------------------------------

function CandidateTagsAction({ selection, count, noun, pending, start }: BulkActionProps) {
  const { has } = useSession();
  const allowed = has('candidate:bulk_update');
  const [open, setOpen] = useState(false);
  const [add, setAdd] = useState('');
  const [remove, setRemove] = useState('');

  const addTags = parseTags(add);
  const removeTags = parseTags(remove);
  const canSubmit = addTags.length > 0 || removeTags.length > 0;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setAdd('');
      setRemove('');
    }
  }

  function submit() {
    void start({
      type: 'CANDIDATE_TAGS',
      selection,
      payload: { add: addTags, remove: removeTags },
    }).then((ok) => {
      if (ok) handleOpenChange(false);
    });
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={handleOpenChange}
      label="Tags"
      icon={Tags}
      allowed={allowed}
      reason="You need the “Bulk update candidates” permission."
      title="Update candidate tags"
      description={`Add or remove tags on ${numberFormatter.format(count)} ${noun}${count === 1 ? '' : 's'}.`}
      submitLabel="Update tags"
      canSubmit={canSubmit}
      pending={pending}
      onSubmit={submit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="bulk-tags-add">Tags to add</Label>
        <Input
          id="bulk-tags-add"
          value={add}
          onChange={(event) => setAdd(event.target.value)}
          placeholder="e.g. react, typescript"
        />
        <p className="text-xs text-muted-foreground">Separate tags with commas.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="bulk-tags-remove">Tags to remove</Label>
        <Input
          id="bulk-tags-remove"
          value={remove}
          onChange={(event) => setRemove(event.target.value)}
          placeholder="e.g. unqualified"
        />
      </div>
    </ActionDialog>
  );
}

function CandidateOwnerAction({ selection, count, noun, pending, start }: BulkActionProps) {
  const { has } = useSession();
  const allowed = has('candidate:bulk_update');
  const [open, setOpen] = useState(false);
  const [ownerId, setOwnerId] = useState('');

  const users = useQuery({
    queryKey: queryKeys.users.list({ pageSize: 100, status: 'ACTIVE' }),
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/users', { query: { pageSize: 100, status: 'ACTIVE' } }),
    enabled: open && allowed,
    staleTime: 60_000,
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setOwnerId('');
  }

  function submit() {
    void start({
      type: 'CANDIDATE_OWNER',
      selection,
      payload: { ownerId: ownerId === UNASSIGNED ? null : ownerId },
    }).then((ok) => {
      if (ok) handleOpenChange(false);
    });
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={handleOpenChange}
      label="Owner"
      icon={UserCog}
      allowed={allowed}
      reason="You need the “Bulk update candidates” permission."
      title="Reassign owner"
      description={`Choose the recruiter who owns ${numberFormatter.format(count)} ${noun}${count === 1 ? '' : 's'}.`}
      submitLabel="Reassign"
      canSubmit={ownerId.length > 0 && !users.isPending}
      pending={pending}
      onSubmit={submit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="bulk-owner">Owner</Label>
        <Select value={ownerId} onValueChange={setOwnerId}>
          <SelectTrigger id="bulk-owner">
            <SelectValue placeholder="Choose an owner…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            {(users.data?.items ?? []).map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {users.isError ? (
          <p className="text-xs text-destructive">Could not load people. Close and try again.</p>
        ) : null}
      </div>
    </ActionDialog>
  );
}

function CandidateStatusAction({ selection, count, noun, pending, start }: BulkActionProps) {
  const { has } = useSession();
  const allowed = has('candidate:bulk_update');
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setStatus('');
  }

  function submit() {
    void start({
      type: 'CANDIDATE_STATUS',
      selection,
      payload: { status: status as CandidateStatus },
    }).then((ok) => {
      if (ok) handleOpenChange(false);
    });
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={handleOpenChange}
      label="Status"
      icon={ArrowRightLeft}
      allowed={allowed}
      reason="You need the “Bulk update candidates” permission."
      title="Change candidate status"
      description={`Set the status for ${numberFormatter.format(count)} ${noun}${count === 1 ? '' : 's'}.`}
      submitLabel="Change status"
      canSubmit={status.length > 0}
      pending={pending}
      onSubmit={submit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="bulk-candidate-status">Status</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger id="bulk-candidate-status">
            <SelectValue placeholder="Choose a status…" />
          </SelectTrigger>
          <SelectContent>
            {candidateStatusSchema.options.map((option) => (
              <SelectItem key={option} value={option}>
                {CANDIDATE_STATUS_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </ActionDialog>
  );
}

function CandidateAddToJobAction({ selection, count, noun, pending, start }: BulkActionProps) {
  const { has } = useSession();
  const allowed = has('application:create');
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState('');
  const [stageId, setStageId] = useState('');

  const jobs = useQuery({
    queryKey: queryKeys.jobs.list({ pageSize: 100 }),
    queryFn: () => api.get<Paginated<JobListItem>>('/jobs', { query: { pageSize: 100 } }),
    enabled: open && allowed,
    staleTime: 60_000,
  });

  const stages = useQuery({
    queryKey: queryKeys.jobs.pipeline(jobId || ''),
    queryFn: () => api.get<JobPipelineStageSummary[]>(`/jobs/${jobId}/pipeline`),
    enabled: open && allowed && jobId.length > 0,
    staleTime: 60_000,
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setJobId('');
      setStageId('');
    }
  }

  function submit() {
    void start({
      type: 'CANDIDATE_ADD_TO_JOB',
      selection,
      payload: stageId.length > 0 ? { jobId, stageId } : { jobId },
    }).then((ok) => {
      if (ok) handleOpenChange(false);
    });
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={handleOpenChange}
      label="Add to job"
      icon={BriefcaseBusiness}
      allowed={allowed}
      reason="You need the “Create applications” permission."
      title="Add candidates to a job"
      description={`Create applications for ${numberFormatter.format(count)} ${noun}${count === 1 ? '' : 's'} on the chosen requisition.`}
      submitLabel="Add to job"
      canSubmit={jobId.length > 0 && !jobs.isPending}
      pending={pending}
      onSubmit={submit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="bulk-add-job">Requisition</Label>
        <Select
          value={jobId}
          onValueChange={(value) => {
            setJobId(value);
            setStageId('');
          }}
        >
          <SelectTrigger id="bulk-add-job">
            <SelectValue placeholder="Choose a job…" />
          </SelectTrigger>
          <SelectContent>
            {(jobs.data?.items ?? []).map((job) => (
              <SelectItem key={job.id} value={job.id}>
                {job.referenceCode} · {job.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {jobs.isError ? (
          <p className="text-xs text-destructive">Could not load jobs. Close and try again.</p>
        ) : null}
      </div>

      {jobId.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor="bulk-add-job-stage">Stage (optional)</Label>
          <Select value={stageId} onValueChange={setStageId} disabled={stages.isPending}>
            <SelectTrigger id="bulk-add-job-stage">
              <SelectValue placeholder={stages.isPending ? 'Loading stages…' : 'Use the intake stage'} />
            </SelectTrigger>
            <SelectContent>
              {(stages.data ?? []).map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>
                  {stage.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </ActionDialog>
  );
}

function CandidateAddToListAction({ selection, count, noun, pending, start }: BulkActionProps) {
  const { has } = useSession();
  const allowed = has('list:manage');
  const [open, setOpen] = useState(false);
  const [listId, setListId] = useState('');

  const hotlists = useQuery({
    queryKey: queryKeys.candidateLists.list({ pageSize: 100 }),
    queryFn: () =>
      api.get<Paginated<CandidateListSummary>>('/candidate-lists', { query: { pageSize: 100 } }),
    enabled: open && allowed,
    staleTime: 60_000,
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setListId('');
  }

  function submit() {
    void start({
      type: 'CANDIDATE_ADD_TO_LIST',
      selection,
      payload: { listId },
    }).then((ok) => {
      if (ok) handleOpenChange(false);
    });
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={handleOpenChange}
      label="Add to hotlist"
      icon={ListPlus}
      allowed={allowed}
      reason="You need the “Manage hotlists” permission."
      title="Add to hotlist"
      description={`Add ${numberFormatter.format(count)} ${noun}${count === 1 ? '' : 's'} to a hotlist.`}
      submitLabel="Add to hotlist"
      canSubmit={listId.length > 0 && !hotlists.isPending}
      pending={pending}
      onSubmit={submit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="bulk-hotlist">Hotlist</Label>
        <Select value={listId} onValueChange={setListId}>
          <SelectTrigger id="bulk-hotlist">
            <SelectValue placeholder="Choose a hotlist…" />
          </SelectTrigger>
          <SelectContent>
            {(hotlists.data?.items ?? []).map((list) => (
              <SelectItem key={list.id} value={list.id}>
                {list.name} ({list.memberCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hotlists.isError ? (
          <p className="text-xs text-destructive">Could not load hotlists. Close and try again.</p>
        ) : null}
      </div>
    </ActionDialog>
  );
}

function CandidateDeleteAction({ selection, count, noun, start }: BulkActionProps) {
  const { has } = useSession();
  if (!has('candidate:delete')) {
    return (
      <GatedButton
        label="Delete"
        icon={Trash2}
        destructive
        reason="You need the “Delete candidates” permission."
      />
    );
  }

  return (
    <ConfirmDialog
      destructive
      title={`Delete ${numberFormatter.format(count)} ${noun}${count === 1 ? '' : 's'}?`}
      description="They are archived and removed from the talent pool. Resumes and history are retained."
      confirmLabel="Delete candidates"
      trigger={
        <Button variant="outline" size="sm" className="text-destructive">
          <Trash2 className="size-4" aria-hidden="true" />
          Delete
        </Button>
      }
      onConfirm={() =>
        start({ type: 'CANDIDATE_DELETE', selection, payload: {} }).then(() => undefined)
      }
    />
  );
}

function CandidateExportAction({ selection, pending, start }: BulkActionProps) {
  const { has } = useSession();
  if (!has('candidate:export')) {
    return (
      <GatedButton
        label="Export"
        icon={Download}
        reason="You need the “Export candidates” permission."
      />
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      loading={pending}
      onClick={() => void start({ type: 'CANDIDATE_EXPORT', selection, payload: { columns: [] } })}
    >
      <Download className="size-4" aria-hidden="true" />
      Export
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Job actions
// ---------------------------------------------------------------------------

function JobStatusAction({ selection, count, noun, pending, start }: BulkActionProps) {
  const { has } = useSession();
  const allowed = has('job:bulk_update');
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setStatus('');
      setReason('');
    }
  }

  function submit() {
    const trimmed = reason.trim();
    void start({
      type: 'JOB_STATUS',
      selection,
      payload: trimmed.length > 0 ? { status: status as JobStatus, reason: trimmed } : { status: status as JobStatus },
    }).then((ok) => {
      if (ok) handleOpenChange(false);
    });
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={handleOpenChange}
      label="Status"
      icon={ArrowRightLeft}
      allowed={allowed}
      reason="You need the “Bulk update jobs” permission."
      title="Change job status"
      description={`Set the status for ${numberFormatter.format(count)} ${noun}${count === 1 ? '' : 's'}.`}
      submitLabel="Change status"
      canSubmit={status.length > 0}
      pending={pending}
      onSubmit={submit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="bulk-job-status">Status</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger id="bulk-job-status">
            <SelectValue placeholder="Choose a status…" />
          </SelectTrigger>
          <SelectContent>
            {jobStatusSchema.options.map((option) => (
              <SelectItem key={option} value={option}>
                {JOB_STATUS_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="bulk-job-status-reason">Reason (optional)</Label>
        <Textarea
          id="bulk-job-status-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={400}
          placeholder="Why are these requisitions changing status?"
        />
      </div>
    </ActionDialog>
  );
}

function JobPriorityAction({ selection, count, noun, pending, start }: BulkActionProps) {
  const { has } = useSession();
  const allowed = has('job:bulk_update');
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState('');

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setPriority('');
  }

  function submit() {
    void start({
      type: 'JOB_PRIORITY',
      selection,
      payload: { priority: priority as Priority },
    }).then((ok) => {
      if (ok) handleOpenChange(false);
    });
  }

  return (
    <ActionDialog
      open={open}
      onOpenChange={handleOpenChange}
      label="Priority"
      icon={Flame}
      allowed={allowed}
      reason="You need the “Bulk update jobs” permission."
      title="Change job priority"
      description={`Set the priority for ${numberFormatter.format(count)} ${noun}${count === 1 ? '' : 's'}.`}
      submitLabel="Change priority"
      canSubmit={priority.length > 0}
      pending={pending}
      onSubmit={submit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="bulk-job-priority">Priority</Label>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger id="bulk-job-priority">
            <SelectValue placeholder="Choose a priority…" />
          </SelectTrigger>
          <SelectContent>
            {prioritySchema.options.map((option) => (
              <SelectItem key={option} value={option}>
                {PRIORITY_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </ActionDialog>
  );
}

function JobAssignRecruitersAction({ selection, count, noun, pending, start }: BulkActionProps) {
  const { has } = useSession();
  const allowed = has('job:assign');
  const [open, setOpen] = useState(false);
  const [userIds, setUserIds] = useState<Set<string>>(new Set());

  const users = useQuery({
    queryKey: queryKeys.users.list({ pageSize: 100, status: 'ACTIVE' }),
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/users', { query: { pageSize: 100, status: 'ACTIVE' } }),
    enabled: open && allowed,
    staleTime: 60_000,
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setUserIds(new Set());
  }

  function toggle(id: string) {
    setUserIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < 50) next.add(id);
      return next;
    });
  }

  function submit() {
    void start({
      type: 'JOB_ASSIGN_RECRUITERS',
      selection,
      payload: { userIds: [...userIds] },
    }).then((ok) => {
      if (ok) handleOpenChange(false);
    });
  }

  const items = users.data?.items ?? [];

  return (
    <ActionDialog
      open={open}
      onOpenChange={handleOpenChange}
      label="Assign recruiters"
      icon={UserPlus}
      allowed={allowed}
      reason="You need the “Assign recruiters” permission."
      title="Assign recruiters"
      description={`Add recruiters to ${numberFormatter.format(count)} ${noun}${count === 1 ? '' : 's'}. Assignments are added, not replaced.`}
      submitLabel="Assign recruiters"
      canSubmit={userIds.size > 0 && !users.isPending}
      pending={pending}
      onSubmit={submit}
    >
      <div className="space-y-1.5">
        <Label>Recruiters</Label>
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {users.isPending ? (
            <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <Spinner />
              <span>Loading people…</span>
            </div>
          ) : items.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">No active people to assign.</p>
          ) : (
            items.map((user) => {
              const checked = userIds.has(user.id);
              return (
                <label
                  key={user.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent"
                >
                  <Checkbox
                    checked={checked}
                    disabled={!checked && userIds.size >= 50}
                    onCheckedChange={() => toggle(user.id)}
                    aria-label={`Assign ${user.fullName}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{user.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                  </span>
                </label>
              );
            })
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {userIds.size} selected{userIds.size >= 50 ? ' · up to 50 per operation' : ''}
        </p>
      </div>
    </ActionDialog>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

export type BulkScope = 'candidate' | 'job';

/** The current selection, handed to the page's own `extra` controls. */
export interface BulkActionContext {
  /** True when the whole filtered set (not just the page) is selected. */
  allMatching: boolean;
  count: number;
  selection: BulkSelection;
}

interface BulkActionBarProps {
  scope: BulkScope;
  selectedIds: ReadonlySet<string>;
  /** Ids of the rows currently rendered, used to offer "select all matching". */
  pageRowIds: readonly string[];
  /** Total records the current filter matches, from the list's pagination meta. */
  total: number;
  /** The filter object sent to the list endpoint, minus pagination. */
  filters: Record<string, unknown>;
  onClear: () => void;
  onStarted: (operation: BulkOperationItem) => void;
  /**
   * Extra toolbar controls the page owns (e.g. Merge, a per-record delete that
   * has no server-side bulk equivalent). Receives the current selection so a
   * control can adapt to a whole-filtered-set selection.
   */
  extra?: (context: BulkActionContext) => ReactNode;
}

/**
 * Selection toolbar shared by the jobs and candidates lists.
 *
 * Owns the bar chrome, the "select all N matching" affordance and the
 * `POST /bulk-operations` dispatch; each entity contributes its own action
 * buttons. Permissions mirror the server's action map so an action a user
 * cannot run is shown disabled with a tooltip rather than hidden.
 */
export function BulkActionBar({
  scope,
  selectedIds,
  pageRowIds,
  total,
  filters,
  onClear,
  onStarted,
  extra,
}: BulkActionBarProps) {
  const queryClient = useQueryClient();
  const [allMatching, setAllMatching] = useState(false);

  const pageFullySelected = pageRowIds.length > 0 && pageRowIds.every((id) => selectedIds.has(id));
  const canSelectAllMatching = pageFullySelected && total > pageRowIds.length;

  // A filter change (or a deselected row) abandons a whole-set selection.
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    setAllMatching(false);
  }, [filterKey]);
  useEffect(() => {
    if (!pageFullySelected) setAllMatching(false);
  }, [pageFullySelected]);

  const selection: BulkSelection = allMatching ? { all: true, filters } : { ids: [...selectedIds] };
  const count = allMatching ? total : selectedIds.size;
  const noun = scope === 'candidate' ? 'candidate' : 'requisition';

  const create = useMutation({
    mutationFn: (request: CreateBulkOperationRequest) =>
      api.post<BulkOperationItem>('/bulk-operations', request),
    onSuccess: (operation) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bulkOperations.all });
      toast.success(
        `${BULK_OPERATION_TYPE_LABELS[operation.type]} queued for ${numberFormatter.format(count)} ${noun}${count === 1 ? '' : 's'}`,
      );
      setAllMatching(false);
      onClear();
      onStarted(operation);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not start the bulk action');
    },
  });

  async function start(request: CreateBulkOperationRequest): Promise<boolean> {
    try {
      await create.mutateAsync(request);
      return true;
    } catch {
      // The toast in `onError` is the user-facing surface; keep the dialog open.
      return false;
    }
  }

  const actionProps: BulkActionProps = {
    selection,
    count,
    noun,
    pending: create.isPending,
    start,
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-card">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-sm font-medium">
          {allMatching
            ? `All ${numberFormatter.format(total)} matching ${noun}s selected`
            : `${selectedIds.size} selected`}
        </span>
        {allMatching ? <Badge variant="info">Whole filtered set</Badge> : null}
      </div>

      {canSelectAllMatching && !allMatching ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => setAllMatching(true)}
        >
          Select all {numberFormatter.format(total)} matching
        </Button>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {scope === 'candidate' ? (
          <>
            <CandidateTagsAction {...actionProps} />
            <CandidateOwnerAction {...actionProps} />
            <CandidateStatusAction {...actionProps} />
            <CandidateAddToJobAction {...actionProps} />
            <CandidateAddToListAction {...actionProps} />
            <CandidateExportAction {...actionProps} />
            <CandidateDeleteAction {...actionProps} />
          </>
        ) : (
          <>
            <JobStatusAction {...actionProps} />
            <JobPriorityAction {...actionProps} />
            <JobAssignRecruitersAction {...actionProps} />
          </>
        )}
        {extra ? extra({ allMatching, count, selection }) : null}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={() => {
          setAllMatching(false);
          onClear();
        }}
      >
        Clear selection
      </Button>
    </div>
  );
}
