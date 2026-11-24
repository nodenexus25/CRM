import Link from 'next/link';

import { Logo } from '@/components/shell/logo';
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';

const FOOTER_LINKS = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Security', href: '#security' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Contact', href: 'mailto:hello@talentflow.app' },
      { label: 'Sign in', href: '/login' },
      { label: 'Start free trial', href: '/signup' },
    ],
  },
] as const;

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link href="/" className="rounded-md text-primary focus-visible:outline-none">
            <Logo />
            <span className="sr-only">{env.appName} home</span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            <Button asChild variant="ghost" size="sm">
              <Link href="/#features">Features</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/pricing">Pricing</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/#security">Security</Link>
            </Button>
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Start free trial</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-border bg-muted/40">
        <div className="container grid gap-10 py-12 md:grid-cols-[1.5fr_1fr_1fr]">
          <div className="space-y-3">
            <Logo className="text-primary" />
            <p className="max-w-sm text-sm text-muted-foreground">
              The applicant tracking system and recruitment CRM for staffing agencies and recruiting
              firms — jobs, candidates, submissions, clients and placements in one workspace.
            </p>
          </div>

          {FOOTER_LINKS.map((column) => (
            <div key={column.title} className="space-y-3">
              <p className="text-sm font-medium text-foreground">{column.title}</p>
              <ul className="space-y-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-border">
          <div className="container flex flex-col items-start justify-between gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center">
            <p>
              © {new Date().getFullYear()} {env.appName}. All rights reserved.
            </p>
            <p>{env.rootDomain}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
