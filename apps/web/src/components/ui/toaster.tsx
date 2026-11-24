'use client';

import { useTheme } from 'next-themes';
import { Toaster as SonnerToaster } from 'sonner';

/**
 * Toast host.
 *
 * Sonner owns the queue and the animation; the toast surface itself is re-skinned
 * with the design tokens so it matches dialogs and popovers in both themes.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-right"
      closeButton
      duration={4500}
      toastOptions={{
        classNames: {
          toast: 'group rounded-lg border border-border bg-popover text-popover-foreground shadow-popover',
          title: 'text-sm font-medium',
          description: 'text-sm text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-muted text-muted-foreground',
          closeButton: 'border-border bg-popover text-muted-foreground',
        },
      }}
    />
  );
}
