import { Loader2 } from 'lucide-react';

import { cn } from '@talentflow/ui';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted-foreground', className)} aria-hidden="true" />;
}

/** Centred spinner with an accessible status message. */
export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted-foreground', className)}
    >
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** Full-viewport spinner for route-level suspense boundaries. */
export function FullPageLoader({ label = 'Loading your workspace…' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <LoadingState label={label} />
    </div>
  );
}
