'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { forgotPasswordSchema, type ForgotPasswordRequest } from '@talentflow/types';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';

export function ForgotPasswordForm() {
  const form = useForm<ForgotPasswordRequest>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.post('/auth/forgot-password', values, { skipAuthRetry: true });
      // The endpoint answers identically for known and unknown addresses, so a
      // generic confirmation is the only honest response.
      toast.success('If that address has an account, a reset link is on its way.');
      form.reset({ email: values.email });
    } catch (error) {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    }
  });

  const error = form.formState.errors.root?.message;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
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

      <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
        Send reset link
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
