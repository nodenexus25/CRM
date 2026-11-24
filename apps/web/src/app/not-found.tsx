import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background px-6 text-center">
      <p className="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Error 404</p>
      <h1 className="text-3xl font-semibold tracking-tight">We couldn&rsquo;t find that page</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The link may be out of date, or the record it pointed at may have been removed from the
        workspace.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </main>
  );
}
