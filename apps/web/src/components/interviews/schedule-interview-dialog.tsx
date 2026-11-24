'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  INTERVIEW_TYPE_LABELS,
  interviewTypeSchema,
  type ApplicationListItem,
  type InterviewDetail,
  type JobListItem,
  type Paginated,
  type UserListItem,
} from '@talentflow/types';
import { getInitials } from '@talentflow/ui';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

/** Radix `Select` cannot hold an empty value, so "nobody" needs a sentinel. */
const NO_LEAD = '__no_lead__';

const scheduleFormSchema = z.object({
  jobId: z.string().min(1, 'Choose a requisition'),
  applicationId: z.string().min(1, 'Choose the candidate to interview'),
  type: interviewTypeSchema,
  round: z.coerce.number().int().min(1, 'At least round 1').max(20, 'At most round 20'),
  scheduledStart: z.string().min(1, 'Pick a date and time'),
  durationMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(600, 'At most 600 minutes'),
  timezone: z.string().trim().min(1).max(64),
  title: z.string().trim().max(200),
  location: z.string().trim().max(300),
  meetingUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => value === '' || /^https?:\/\/\S+$/i.test(value), 'Enter a valid URL'),
  leadInterviewerId: z.string(),
  additionalInterviewerIds: z.array(z.string()),
  externalInterviewer: z.string().trim().max(200),
});
type ScheduleFormValues = z.infer<typeof scheduleFormSchema>;

/** `datetime-local` wants a wall-clock string, not an instant. */
function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

interface ScheduleInterviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduled?: () => void;
}

/**
 * Schedules an interview: pick the requisition, then the candidate on it, then
 * the when, the shape and the panel. The lead interviewer is chosen explicitly
 * and is always sent first, which is what marks them as the panel lead.
 */
export function ScheduleInterviewDialog({
  open,
  onOpenChange,
  onScheduled,
}: ScheduleInterviewDialogProps) {
  const { tenant } = useSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const defaultTimezone = tenant?.timezone ?? 'UTC';

  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      jobId: '',
      applicationId: '',
      type: 'VIDEO',
      round: 1,
      scheduledStart: toLocalInputValue(new Date(Date.now() + 86_400_000)),
      durationMinutes: 60,
      timezone: defaultTimezone,
      title: '',
      location: '',
      meetingUrl: '',
      leadInterviewerId: NO_LEAD,
      additionalInterviewerIds: [],
      externalInterviewer: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      jobId: '',
      applicationId: '',
      type: 'VIDEO',
      round: 1,
      scheduledStart: toLocalInputValue(new Date(Date.now() + 86_400_000)),
      durationMinutes: 60,
      timezone: defaultTimezone,
      title: '',
      location: '',
      meetingUrl: '',
      leadInterviewerId: NO_LEAD,
      additionalInterviewerIds: [],
      externalInterviewer: '',
    });
    setSearch('');
  }, [open, defaultTimezone, form]);

  const jobId = form.watch('jobId');

  const jobs = useQuery({
    queryKey: queryKeys.jobs.list({ pageSize: 100, status: 'OPEN' }),
    queryFn: () =>
      api.get<Paginated<JobListItem>>('/jobs', {
        query: { pageSize: 100, status: 'OPEN', sortBy: 'updatedAt', sortDir: 'desc' },
      }),
    enabled: open,
    staleTime: 60_000,
  });

  const applications = useQuery({
    queryKey: queryKeys.applications.list({ jobId, status: 'ACTIVE', pageSize: 100 }),
    queryFn: () =>
      api.get<Paginated<ApplicationListItem>>('/applications', {
        query: { jobId, status: 'ACTIVE', pageSize: 100, sortBy: 'appliedAt', sortDir: 'desc' },
      }),
    enabled: open && jobId !== '',
    staleTime: 30_000,
  });

  const users = useQuery({
    queryKey: queryKeys.users.list({ pageSize: 100, status: 'ACTIVE' }),
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/users', { query: { pageSize: 100, status: 'ACTIVE' } }),
    enabled: open,
    staleTime: 60_000,
  });

  const createInterview = useMutation({
    mutationFn: (values: ScheduleFormValues) => {
      const lead = values.leadInterviewerId === NO_LEAD ? [] : [values.leadInterviewerId];
      const panel = [
        ...lead,
        ...values.additionalInterviewerIds.filter((id) => id !== values.leadInterviewerId),
      ];
      return api.post<InterviewDetail>('/interviews', {
        applicationId: values.applicationId,
        type: values.type,
        round: values.round,
        scheduledStart: new Date(values.scheduledStart).toISOString(),
        durationMinutes: values.durationMinutes,
        timezone: values.timezone,
        title: values.title || null,
        location: values.location || null,
        meetingUrl: values.meetingUrl || null,
        interviewerIds: panel,
        externalInterviewer: values.externalInterviewer || null,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.interviews.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      toast.success('Interview scheduled');
      onOpenChange(false);
      onScheduled?.();
    },
    onError: (error: unknown) => {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    },
  });

  const rootError = form.formState.errors.root?.message;
  const selectedApplicationId = form.watch('applicationId');
  const leadInterviewerId = form.watch('leadInterviewerId');
  const additionalIds = form.watch('additionalInterviewerIds');

  const applicationOptions = applications.data?.items ?? [];
  const panelOptions = (users.data?.items ?? []).filter((user) =>
    user.fullName.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function toggleAdditional(userId: string, checked: boolean) {
    const next = checked
      ? [...new Set([...additionalIds, userId])]
      : additionalIds.filter((id) => id !== userId);
    form.setValue('additionalInterviewerIds', next, { shouldDirty: true });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Schedule an interview</DialogTitle>
          <DialogDescription>
            Pick the requisition and the candidate on it, then the panel. The lead interviewer is
            marked as the panel owner.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((values) => createInterview.mutate(values))}
          className="space-y-4"
        >
          <fieldset disabled={createInterview.isPending} className="space-y-4">
            {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="schedule-job">Requisition</Label>
                <Select
                  value={jobId || undefined}
                  onValueChange={(value) => {
                    form.setValue('jobId', value, { shouldDirty: true });
                    form.setValue('applicationId', '', { shouldDirty: true });
                  }}
                  disabled={jobs.isPending}
                >
                  <SelectTrigger id="schedule-job" aria-label="Requisition">
                    <SelectValue placeholder="Choose a requisition" />
                  </SelectTrigger>
                  <SelectContent>
                    {(jobs.data?.items ?? []).map((job) => (
                      <SelectItem key={job.id} value={job.id}>
                        {job.title}
                        {job.client ? ` · ${job.client.name}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.jobId ? (
                  <p className="text-xs text-destructive">{form.formState.errors.jobId.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="schedule-application">Candidate</Label>
                <Select
                  value={selectedApplicationId || undefined}
                  onValueChange={(value) =>
                    form.setValue('applicationId', value, { shouldDirty: true })
                  }
                  disabled={jobId === '' || applications.isPending}
                >
                  <SelectTrigger id="schedule-application" aria-label="Candidate">
                    <SelectValue
                      placeholder={jobId === '' ? 'Choose a requisition first' : 'Choose a candidate'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {applicationOptions.map((application) => (
                      <SelectItem key={application.id} value={application.id}>
                        {application.candidate.fullName} · {application.stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.applicationId ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.applicationId.message}
                  </p>
                ) : jobId !== '' && !applications.isPending && applicationOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No active candidates on that requisition.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="schedule-type">Type</Label>
                <Select
                  value={form.watch('type')}
                  onValueChange={(value) =>
                    form.setValue('type', value as ScheduleFormValues['type'], { shouldDirty: true })
                  }
                >
                  <SelectTrigger id="schedule-type" aria-label="Interview type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {interviewTypeSchema.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {INTERVIEW_TYPE_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="schedule-round">Round</Label>
                <Input
                  id="schedule-round"
                  type="number"
                  min={1}
                  max={20}
                  {...form.register('round')}
                />
                {form.formState.errors.round ? (
                  <p className="text-xs text-destructive">{form.formState.errors.round.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="schedule-duration">Minutes</Label>
                <Input
                  id="schedule-duration"
                  type="number"
                  min={5}
                  max={600}
                  step={5}
                  {...form.register('durationMinutes')}
                />
                {form.formState.errors.durationMinutes ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.durationMinutes.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="schedule-start">Starts</Label>
                <Input id="schedule-start" type="datetime-local" {...form.register('scheduledStart')} />
                {form.formState.errors.scheduledStart ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.scheduledStart.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="schedule-timezone">Timezone</Label>
                <Input id="schedule-timezone" {...form.register('timezone')} placeholder="Asia/Calcutta" />
                {form.formState.errors.timezone ? (
                  <p className="text-xs text-destructive">{form.formState.errors.timezone.message}</p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                The times above are read in your browser’s local zone; the timezone is stored for the
                invite.
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="schedule-title">Title (optional)</Label>
                <Input id="schedule-title" {...form.register('title')} placeholder="Platform deep dive" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="schedule-meeting-url">Meeting link (optional)</Label>
                <Input
                  id="schedule-meeting-url"
                  {...form.register('meetingUrl')}
                  placeholder="https://meet.example.com/abc-defg"
                />
                {form.formState.errors.meetingUrl ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.meetingUrl.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="schedule-location">Location (optional)</Label>
                <Input id="schedule-location" {...form.register('location')} placeholder="Room 4 / On-site" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="schedule-external">External interviewer (optional)</Label>
                <Input
                  id="schedule-external"
                  {...form.register('externalInterviewer')}
                  placeholder="Client-side name"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="schedule-lead">Lead interviewer</Label>
              <Select
                value={leadInterviewerId}
                onValueChange={(value) =>
                  form.setValue('leadInterviewerId', value, { shouldDirty: true })
                }
                disabled={users.isPending}
              >
                <SelectTrigger id="schedule-lead" aria-label="Lead interviewer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LEAD}>No internal lead</SelectItem>
                  {(users.data?.items ?? []).map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.fullName}
                      {user.title ? ` · ${user.title}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="schedule-panel-search">Panel</Label>
              <Input
                id="schedule-panel-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter workspace users…"
              />
              <ScrollArea className="h-40 rounded-md border border-border">
                <ul className="divide-y divide-border">
                  {panelOptions.length === 0 ? (
                    <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No users match that search.
                    </li>
                  ) : (
                    panelOptions.map((user) => {
                      const isLead = leadInterviewerId === user.id;
                      return (
                        <li key={user.id} className="flex items-center gap-3 px-3 py-2">
                          <Checkbox
                            id={`panel-${user.id}`}
                            checked={isLead || additionalIds.includes(user.id)}
                            disabled={isLead}
                            onCheckedChange={(checked) => toggleAdditional(user.id, checked === true)}
                          />
                          <Avatar className="size-6">
                            {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
                            <AvatarFallback className="text-[9px]">
                              {getInitials(user.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <label htmlFor={`panel-${user.id}`} className="min-w-0 flex-1 cursor-pointer">
                            <span className="block truncate text-sm">{user.fullName}</span>
                            {user.title ? (
                              <span className="block truncate text-2xs text-muted-foreground">
                                {user.title}
                              </span>
                            ) : null}
                          </label>
                          {isLead ? <span className="text-2xs text-primary">Lead</span> : null}
                        </li>
                      );
                    })
                  )}
                </ul>
              </ScrollArea>
            </div>
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createInterview.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createInterview.isPending}>
              <CalendarPlus className="size-4" aria-hidden="true" />
              Schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
