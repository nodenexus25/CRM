'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, MailCheck, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { resendVerificationSchema, type ResendVerificationRequest } from '@talentflow/types';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingState } from '@/components/ui/spinner';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';

type VerifyState = 'verifying' | 'verified' | 'failed' | 'missing';

/**
 * Confirms an emailed token, then falls back to a re-send form.
 *
 * The token is consumed on mount exactly once — the API invalidates it on first
 * use, so a re-render must not fire a second request.
 */
export function VerifyEmailPanel({ token }: { token: string | null }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<VerifyState>(token ? 'verifying' : 'missing');
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    void (async () => {
      try {
        await api.post('/auth/verify-email', { token }, { skipAuthRetry: true });
        if (cancelled) return;
        setState('verified');
        await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      } catch (error) {
        if (cancelled) return;
        setState('failed');
        setFailure(ApiError.from(error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, queryClient]);

  if (state === 'verifying') {
    return <LoadingState label="Confirming your email address…" />;
  }

  if (state === 'verified') {
    return (
      <div className="space-y-5">
        <Alert variant="success">
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>Email confirmed</AlertTitle>
          <AlertDescription>Your address is verified. You have full access to the workspace.</AlertDescription>
        </Alert>
        <Button asChild className="w-full">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Alert variant={state === 'failed' ? 'destructive' : 'info'}>
        {state === 'failed' ? <ShieldAlert aria-hidden="true" /> : <MailCheck aria-hidden="true" />}
        <AlertTitle>{state === 'failed' ? 'That link did not work' : 'Check your inbox'}</AlertTitle>
        <AlertDescription>
          {failure ??
            'Open the verification link we emailed you. Links expire after 24 hours — request a new one below if it has gone stale.'}
        </AlertDescription>
      </Alert>

      <ResendVerificationForm />
    </div>
  );
}

function ResendVerificationForm() {
  const form = useForm<ResendVerificationRequest>({
    resolver: zodResolver(resendVerificationSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.post('/auth/resend-verification', values, { skipAuthRetry: true });
      toast.success('A fresh verification link is on its way.');
    } catch (error) {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    }
  });

  const error = form.formState.errors.root?.message;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="resend-email">Work email</Label>
        <Input
          id="resend-email"
          type="email"
          autoComplete="email"
          placeholder="you@agency.com"
          aria-invalid={Boolean(form.formState.errors.email)}
          {...form.register('email')}
        />
        {form.formState.errors.email ? (
          <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
        ) : null}
      </div>

      <Button type="submit" variant="outline" className="w-full" loading={form.formState.isSubmitting}>
        Resend verification email
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
