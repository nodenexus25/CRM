import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';

/**
 * Authenticated workspace. `AppShell` holds the session gate, so nothing below
 * this boundary has to render a signed-out state.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
