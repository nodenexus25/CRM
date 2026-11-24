import type { HTMLAttributes } from 'react';

import { cn } from '@talentflow/ui';

/** Neutral placeholder used while a query is in flight. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="presentation"
      className={cn('relative overflow-hidden rounded-md bg-muted', className)}
      {...props}
    >
      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-foreground/5 to-transparent" />
    </div>
  );
}
