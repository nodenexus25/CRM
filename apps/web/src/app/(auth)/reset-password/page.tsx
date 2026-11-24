import { AlertCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Set a new password' };

type SearchParams = Record<string, string | string[] | undefined>;

function readToken(searchParams: SearchParams): string | null {
  const raw = searchParams.token;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length >= 20 ? value : null;
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const token = readToken(await searchParams);

  if (!token) {
    return (
      <div className="space-y-6">
        <header className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">This link is incomplete</h1>
        </header>

        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Missing reset token</AlertTitle>
          <AlertDescription>
            Password reset links are single-use and expire after an hour. Request a new one to continue.
          </AlertDescription>
        </Alert>

        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="text-sm text-muted-foreground">
          Choose a password you do not use anywhere else. You&rsquo;ll be signed out everywhere on save.
        </p>
      </header>

      <ResetPasswordForm token={token} />
    </div>
  );
}
