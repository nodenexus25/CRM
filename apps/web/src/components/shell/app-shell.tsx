'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@talentflow/ui';

import { CommandPalette } from '@/components/shell/command-palette';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { FullPageLoader } from '@/components/ui/spinner';
import { useSession } from '@/providers/session-provider';

const SIDEBAR_STORAGE_KEY = 'tf.sidebar';

/**
 * The authenticated workspace frame.
 *
 * Middleware already redirects anonymous visitors, so the session query here is
 * the second opinion: it holds the shell back until the API confirms the user,
 * which also means no component below has to handle a `null` session.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isPending, isAuthenticated } = useSession();

  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Restore the collapsed preference, then persist changes.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed');
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!isPending && !isAuthenticated) router.replace('/login');
  }, [isPending, isAuthenticated, router]);

  // Mobile drawer: lock scrolling and move focus into the panel.
  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [drawerOpen]);

  if (isPending) return <FullPageLoader />;

  if (!isAuthenticated) {
    return <FullPageLoader label="Redirecting to sign in…" />;
  }

  return (
    <div className="flex min-h-dvh bg-muted/30">
      <a
        href="#main"
        className="sr-only-focusable absolute left-3 top-3 z-50 rounded-md bg-background px-3 py-2 text-sm shadow-popover"
      >
        Skip to content
      </a>

      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        className="sticky top-0 hidden w-60 shrink-0 lg:flex"
      />

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 w-64 max-w-[85vw] shadow-popover outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-left-4"
            data-state="open"
          >
            <Sidebar onNavigate={() => setDrawerOpen(false)} className="w-full" />
          </div>
        </div>
      ) : null}

      <div className={cn('flex min-w-0 flex-1 flex-col')}>
        <Topbar onOpenSidebar={() => setDrawerOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
