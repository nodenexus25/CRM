'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

/**
 * Theme ownership lives with `next-themes` so the `dark` class is applied to
 * `<html>` before paint overrides can flash. `attribute="class"` matches the
 * `darkMode: ['class']` setting in the shared Tailwind preset.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="tf-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
