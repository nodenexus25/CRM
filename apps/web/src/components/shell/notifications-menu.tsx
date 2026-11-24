'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

import type { NotificationItem, NotificationSummary } from '@talentflow/types';
import { cn, formatRelativeTime } from '@talentflow/ui';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const MAX_VISIBLE = 6;

export function NotificationsMenu() {
  const queryClient = useQueryClient();

  const summaryQuery = useQuery({
    queryKey: queryKeys.notifications.summary,
    queryFn: () => api.get<NotificationSummary>('/notifications/summary'),
    // Cheap endpoint, and the badge is the only live indicator in the shell.
    refetchInterval: 60_000,
    staleTime: 20_000,
  });

  const markRead = useMutation({
    mutationFn: (ids: string[]) => api.post('/notifications/read', { ids, read: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
      toast.success('All notifications marked as read');
    },
  });

  const unread = summaryQuery.data?.unread ?? 0;
  const items = (summaryQuery.data?.items ?? []).slice(0, MAX_VISIBLE);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={notificationLabel(unread)}>
          <Bell aria-hidden="true" />
          {unread > 0 ? (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1',
                'text-[0.625rem] font-semibold leading-4 text-destructive-foreground',
              )}
              aria-hidden="true"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[22rem] p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <p className="text-sm font-medium">Notifications</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={unread === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            <CheckCheck aria-hidden="true" />
            Mark all read
          </Button>
        </div>

        <Separator />

        {summaryQuery.isPending ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-12 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <BellOff className="size-5 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">You&rsquo;re all caught up.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="p-1.5">
              {items.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onRead={() => markRead.mutate([notification.id])}
                />
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({ notification, onRead }: { notification: NotificationItem; onRead: () => void }) {
  const content = (
    <div className="flex gap-2.5">
      <span
        className={cn(
          'mt-1.5 size-1.5 shrink-0 rounded-full',
          notification.read ? 'bg-transparent' : 'bg-primary',
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-0.5">
        <p className={cn('truncate text-sm', notification.read ? 'text-muted-foreground' : 'font-medium')}>
          {notification.title}
        </p>
        {notification.body ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{notification.body}</p>
        ) : null}
        <p className="text-2xs text-muted-foreground">{formatRelativeTime(notification.createdAt)}</p>
      </div>
    </div>
  );

  if (notification.link) {
    return (
      <li>
        <Link
          href={notification.link}
          onClick={() => {
            if (!notification.read) onRead();
          }}
          className="block rounded-md px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {content}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          if (!notification.read) onRead();
        }}
        className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {content}
      </button>
    </li>
  );
}

function notificationLabel(unread: number): string {
  if (unread === 0) return 'Notifications';
  return `Notifications, ${unread} unread`;
}
