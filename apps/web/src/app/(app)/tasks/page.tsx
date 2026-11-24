'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheckBig, Plus, Search, ShieldOff } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';

import {
  type Paginated,
  type TaskListItem,
  type TaskStatus,
} from '@talentflow/types';

import {
  TaskAssignee,
  TaskCompleteCheckbox,
  TaskDueDate,
  TaskEntityLink,
  TaskPriorityBadge,
  TaskRowActions,
  TaskStatusBadge,
} from '@/components/tasks/task-list';
import { TaskDialog } from '@/components/tasks/task-dialog';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const PAGE_SIZE = 20;

type TaskView = 'all' | Extract<TaskStatus, 'OPEN' | 'IN_PROGRESS' | 'COMPLETED'>;

const VIEWS: readonly { value: TaskView; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
];

type TaskSortField = 'dueAt' | 'createdAt' | 'updatedAt';
const SORT_FIELD_SET = new Set<string>(['dueAt', 'createdAt', 'updatedAt']);

/**
 * Every task the caller can see: their assigned work by default, switchable to
 * the whole workspace. Ticking a row's checkbox completes the task through the
 * dedicated endpoint so the completion is stamped server-side.
 */
export default function TasksPage() {
  const { has } = useSession();
  const queryClient = useQueryClient();

  const canRead = has('task:read');
  const canCreate = has('task:create');
  const canUpdate = has('task:update');
  const canDelete = has('task:delete');

  const [view, setView] = useState<TaskView>('all');
  const [assignee, setAssignee] = useState<'me' | 'all'>('me');
  const [term, setTerm] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<TaskSortField>('dueAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [editing, setEditing] = useState<TaskListItem | null>(null);
  const [creating, setCreating] = useState(false);

  const deferredTerm = useDeferredValue(term.trim());

  const filters = {
    ...(view === 'all' ? {} : { status: view }),
    ...(assignee === 'all' ? {} : { assigneeId: assignee }),
    ...(deferredTerm ? { q: deferredTerm } : {}),
    ...(overdueOnly ? { overdue: true } : {}),
  };

  const query = { page, pageSize: PAGE_SIZE, sortBy, sortDir, ...filters };

  const tasks = useQuery({
    queryKey: queryKeys.tasks.list(query),
    queryFn: () => api.get<Paginated<TaskListItem>>('/tasks', { query }),
    enabled: canRead,
    staleTime: 15_000,
  });

  function invalidateTasks() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.myDay });
  }

  const complete = useMutation({
    mutationFn: (id: string) => api.post<TaskListItem>(`/tasks/${id}/complete`, {}),
    onSuccess: () => {
      invalidateTasks();
      toast.success('Task completed');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not complete the task');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/tasks/${id}`),
    onSuccess: () => {
      invalidateTasks();
      toast.success('Task deleted');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete the task');
    },
  });

  const items = tasks.data?.items ?? [];
  const meta = tasks.data?.meta;
  const isFiltered =
    view !== 'all' || assignee !== 'me' || deferredTerm.length > 0 || overdueOnly;

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader title="Tasks" description="The work you and your team have to do." />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to tasks"
          description="Ask a workspace administrator for the “View tasks” permission."
        />
      </div>
    );
  }

  const columns: DataTableColumn<TaskListItem>[] = [
    {
      id: 'complete',
      header: <span className="sr-only">Complete</span>,
      className: 'w-10',
      headClassName: 'w-10',
      cell: (task) => (
        <TaskCompleteCheckbox
          task={task}
          disabled={!canUpdate || complete.isPending}
          onComplete={(row) => complete.mutate(row.id)}
        />
      ),
    },
    {
      id: 'title',
      header: 'Task',
      cell: (task) => (
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-medium">{task.title}</p>
          {task.description ? (
            <p className="line-clamp-1 text-xs text-muted-foreground">{task.description}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'dueAt',
      header: 'Due',
      sortable: true,
      cell: (task) => <TaskDueDate task={task} />,
    },
    {
      id: 'priority',
      header: 'Priority',
      className: 'hidden sm:table-cell',
      headClassName: 'hidden sm:table-cell',
      cell: (task) => <TaskPriorityBadge priority={task.priority} />,
    },
    {
      id: 'status',
      header: 'Status',
      className: 'hidden md:table-cell',
      headClassName: 'hidden md:table-cell',
      cell: (task) => <TaskStatusBadge status={task.status} />,
    },
    {
      id: 'assignee',
      header: 'Assignee',
      className: 'hidden lg:table-cell',
      headClassName: 'hidden lg:table-cell',
      cell: (task) => <TaskAssignee assignee={task.assignee} />,
    },
    {
      id: 'entity',
      header: 'Linked to',
      className: 'hidden xl:table-cell',
      headClassName: 'hidden xl:table-cell',
      cell: (task) => <TaskEntityLink task={task} />,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (task) => (
        <div className="flex items-center justify-end">
          <TaskRowActions
            task={task}
            canUpdate={canUpdate}
            canDelete={canDelete}
            onEdit={(row) => setEditing(row)}
            onDelete={(row) => remove.mutate(row.id)}
            deleting={remove.isPending}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title="Tasks"
        description="Everything you have to follow up on, in one place."
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New task
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          value={view}
          onValueChange={(value) => {
            setView(value as TaskView);
            setPage(1);
          }}
        >
          <TabsList>
            {VIEWS.map((option) => (
              <TabsTrigger key={option.value} value={option.value}>
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                setPage(1);
              }}
              placeholder="Search tasks"
              aria-label="Search tasks"
              className="pl-9"
            />
          </div>

          <Select
            value={assignee}
            onValueChange={(value) => {
              setAssignee(value as 'me' | 'all');
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-52" aria-label="Filter by assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="me">Assigned to me</SelectItem>
              <SelectItem value="all">Everyone</SelectItem>
            </SelectContent>
          </Select>

          <Label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm font-normal">
            <Switch
              checked={overdueOnly}
              onCheckedChange={(checked) => {
                setOverdueOnly(checked);
                setPage(1);
              }}
              aria-label="Show overdue tasks only"
            />
            Overdue only
          </Label>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={items}
        getRowId={(task) => task.id}
        isPending={tasks.isPending}
        isError={tasks.isError}
        error={tasks.error}
        onRetry={() => void tasks.refetch()}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(id, dir) => {
          if (!SORT_FIELD_SET.has(id)) return;
          setSortBy(id as TaskSortField);
          setSortDir(dir);
          setPage(1);
        }}
        empty={
          <EmptyState
            icon={CircleCheckBig}
            title={isFiltered ? 'No tasks match those filters' : 'Nothing on your list'}
            description={
              isFiltered
                ? 'Try clearing the filters or widening the assignee.'
                : 'Create a task to keep track of what to do next.'
            }
            action={
              isFiltered ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setView('all');
                    setAssignee('me');
                    setTerm('');
                    setOverdueOnly(false);
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              ) : canCreate ? (
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="size-4" aria-hidden="true" />
                  New task
                </Button>
              ) : null
            }
          />
        }
      />

      {meta && meta.total > 0 ? (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            Showing {(meta.page - 1) * meta.pageSize + 1}–
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total} task
            {meta.total === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={!meta.hasPrevious || tasks.isFetching}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {meta.page} of {Math.max(1, meta.pageCount)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => value + 1)}
              disabled={!meta.hasNext || tasks.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <TaskDialog open={creating} onOpenChange={setCreating} />
      <TaskDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        task={editing}
      />
    </div>
  );
}
