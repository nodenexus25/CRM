'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Mail, Pencil, Plus, ShieldOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  EMAIL_TEMPLATE_CATEGORIES,
  type EmailTemplateCategory,
  type EmailTemplateItem,
  type Paginated,
} from '@talentflow/types';
import { humanizeEnum } from '@talentflow/ui';

import { EmailTemplateDialog } from '@/components/email/email-template-dialog';
import { PageHeader } from '@/components/shell/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogTrigger } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

const PAGE_SIZE = 20;

type TemplateSortField = 'name' | 'createdAt' | 'updatedAt';
const SORT_FIELD_SET = new Set<string>(['name', 'createdAt', 'updatedAt']);

/**
 * The workspace's email templates. System templates ship with the product: they
 * can be activated and edited but never deleted, so a workspace cannot strand a
 * notification that still references one.
 */
export default function EmailTemplatesPage() {
  const { has } = useSession();
  const queryClient = useQueryClient();

  const canRead = has('email:template_read');
  const canManage = has('email:template_manage');

  const [category, setCategory] = useState<'all' | EmailTemplateCategory>('all');
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<TemplateSortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const query = {
    page,
    pageSize: PAGE_SIZE,
    sortBy,
    sortDir,
    ...(category === 'all' ? {} : { category }),
    ...(showInactive ? {} : { isActive: true }),
  };

  const templates = useQuery({
    queryKey: queryKeys.emailTemplates.list(query),
    queryFn: () => api.get<Paginated<EmailTemplateItem>>('/email/templates', { query }),
    enabled: canRead,
    staleTime: 30_000,
  });

  const setActive = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      api.patch<EmailTemplateItem>(`/email/templates/${input.id}`, { isActive: input.isActive }),
    onSuccess: (template) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.emailTemplates.all });
      toast.success(template.isActive ? `${template.name} activated` : `${template.name} deactivated`);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not update the template');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/email/templates/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.emailTemplates.all });
      toast.success('Template deleted');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete the template');
    },
  });

  const items = templates.data?.items ?? [];
  const meta = templates.data?.meta;
  const isFiltered = category !== 'all' || showInactive;

  if (!canRead) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeader title="Email templates" description="Reusable emails for your team." />
        <EmptyState
          icon={ShieldOff}
          title="You do not have access to email templates"
          description="Ask a workspace administrator for the “View email templates” permission."
        />
      </div>
    );
  }

  const columns: DataTableColumn<EmailTemplateItem>[] = [
    {
      id: 'name',
      header: 'Template',
      sortable: true,
      cell: (template) => (
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{template.name}</span>
            {template.isSystem ? (
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" aria-hidden="true" />
                System
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{template.subject}</p>
        </div>
      ),
    },
    {
      id: 'key',
      header: 'Key',
      className: 'hidden md:table-cell',
      headClassName: 'hidden md:table-cell',
      cell: (template) => (
        <span className="font-mono text-xs text-muted-foreground">{template.key}</span>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      className: 'hidden sm:table-cell',
      headClassName: 'hidden sm:table-cell',
      cell: (template) => <Badge variant="secondary">{humanizeEnum(template.category)}</Badge>,
    },
    {
      id: 'active',
      header: 'Active',
      className: 'w-24',
      headClassName: 'w-24',
      cell: (template) => (
        <Switch
          checked={template.isActive}
          disabled={!canManage || setActive.isPending}
          aria-label={`${template.isActive ? 'Deactivate' : 'Activate'} ${template.name}`}
          onCheckedChange={(checked) => setActive.mutate({ id: template.id, isActive: checked })}
        />
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (template) => (
        <div className="flex items-center justify-end gap-1">
          {canManage ? (
            <EmailTemplateDialog
              mode="edit"
              template={template}
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${template.name}`}>
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              }
            />
          ) : null}
          {canManage ? (
            template.isSystem ? (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled
                aria-label={`${template.name} is a system template and cannot be deleted`}
              >
                <Lock className="size-4" aria-hidden="true" />
              </Button>
            ) : (
              <ConfirmDialog
                destructive
                title={`Delete ${template.name}?`}
                description="Emails already sent with this template keep their history. The template simply stops appearing when composing."
                confirmLabel="Delete template"
                trigger={
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${template.name}`}
                      disabled={remove.isPending}
                    >
                      <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                    </Button>
                  </DialogTrigger>
                }
                onConfirm={() => remove.mutateAsync(template.id).then(() => undefined)}
              />
            )
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title="Email templates"
        description="Reusable subject lines and bodies, with merge fields the server resolves when an email is sent."
        actions={
          canManage ? (
            <EmailTemplateDialog
              trigger={
                <Button size="sm">
                  <Plus className="size-4" aria-hidden="true" />
                  New template
                </Button>
              }
            />
          ) : null
        }
      />

      {!canManage ? (
        <Alert>
          <AlertDescription>
            You have read-only access to email templates. An administrator can create and edit them.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Select
          value={category}
          onValueChange={(value) => {
            setCategory(value as 'all' | EmailTemplateCategory);
            setPage(1);
          }}
        >
          <SelectTrigger className="lg:w-56" aria-label="Filter by category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {EMAIL_TEMPLATE_CATEGORIES.map((option) => (
              <SelectItem key={option} value={option}>
                {humanizeEnum(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm font-normal">
          <Switch
            checked={showInactive}
            onCheckedChange={(checked) => {
              setShowInactive(checked);
              setPage(1);
            }}
            aria-label="Show inactive templates"
          />
          Show inactive templates
        </Label>
      </div>

      <DataTable
        columns={columns}
        rows={items}
        getRowId={(template) => template.id}
        isPending={templates.isPending}
        isError={templates.isError}
        error={templates.error}
        onRetry={() => void templates.refetch()}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(id, dir) => {
          if (!SORT_FIELD_SET.has(id)) return;
          setSortBy(id as TemplateSortField);
          setSortDir(dir);
          setPage(1);
        }}
        empty={
          <EmptyState
            icon={Mail}
            title={isFiltered ? 'No templates match those filters' : 'No email templates yet'}
            description={
              isFiltered
                ? 'Try a different category, or include the inactive templates.'
                : 'Create a template so your team can send consistent, merge-field-driven email.'
            }
            action={
              isFiltered ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCategory('all');
                    setShowInactive(false);
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              ) : canManage ? (
                <EmailTemplateDialog
                  trigger={
                    <Button size="sm">
                      <Plus className="size-4" aria-hidden="true" />
                      New template
                    </Button>
                  }
                />
              ) : null
            }
          />
        }
      />

      {meta && meta.total > 0 ? (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            Showing {(meta.page - 1) * meta.pageSize + 1}–
            {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total} template
            {meta.total === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={!meta.hasPrevious || templates.isFetching}
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
              disabled={!meta.hasNext || templates.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
