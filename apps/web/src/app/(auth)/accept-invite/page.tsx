import { AlertCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { AcceptInviteForm } from '@/components/auth/accept-invite-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Accept your invitation' };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = (await searchParams).token;
  const token = Array.isArray(raw) ? raw[0] : raw;

  if (!token || token.length < 20) {
    return (
      <div className="space-y-6">
        <header className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">This invitation is incomplete</h1>
        </header>

        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Missing invitation token</AlertTitle>
          <AlertDescription>
            Invitations expire after 7 days. Ask a workspace administrator to resend yours.
          </AlertDescription>
        </Alert>

        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Join the workspace</h1>
        <p className="text-sm text-muted-foreground">
          Confirm your name and choose a password to activate your account.
        </p>
      </header>

      <AcceptInviteForm token={token} />
    </div>
  );
}
