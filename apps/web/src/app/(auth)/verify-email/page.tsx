import type { Metadata } from 'next';

import { VerifyEmailPanel } from '@/components/auth/verify-email-panel';

export const metadata: Metadata = { title: 'Confirm your email' };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw) ?? null;

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Confirm your email</h1>
        <p className="text-sm text-muted-foreground">
          Verifying your address unlocks invitations, client submissions and outbound email.
        </p>
      </header>

      <VerifyEmailPanel token={token} />
    </div>
  );
}
