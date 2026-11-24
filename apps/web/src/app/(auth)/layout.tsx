import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

import { Logo } from '@/components/shell/logo';

const HIGHLIGHTS = [
  'One workspace for jobs, candidates, clients and placements',
  'Per-workspace roles you can edit, not a fixed permission list',
  'Row-level security on every tenant-owned table',
  'Audit trail on every change, ready for client review',
] as const;

/**
 * Split-screen shell for every unauthenticated screen.
 *
 * The brand panel is decorative and hidden below `lg`, so the form keeps the
 * full width on phones; it is `aria-hidden` to keep screen readers on the form.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside
        aria-hidden="true"
        className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex"
      >
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_24rem_at_20%_0%,hsl(var(--primary)/0.28),transparent)]"
        />
        <Link href="/" className="relative text-sidebar-accent-foreground">
          <Logo />
        </Link>

        <div className="relative space-y-6">
          <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-sidebar-accent-foreground">
            Run the whole recruiting desk from one workspace
          </h2>
          <ul className="space-y-3">
            {HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-sidebar-muted">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sidebar-accent-foreground" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-sidebar-muted">
          Trusted by staffing agencies running permanent, contract and C2C desks.
        </p>
      </aside>

      <div className="flex flex-col">
        <div className="flex h-16 items-center px-6 lg:hidden">
          <Link href="/" className="text-primary">
            <Logo />
          </Link>
        </div>
        <main id="main" className="flex flex-1 items-center justify-center px-6 pb-16 pt-4 sm:px-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );
}
