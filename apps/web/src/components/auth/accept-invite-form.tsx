'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { acceptInviteSchema, type AcceptInviteInput, type AuthSessionResponse } from '@talentflow/types';

import { PasswordInput } from '@/components/auth/password-input';
import { PasswordStrength } from '@/components/auth/password-strength';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const form = useForm<AcceptInviteInput>({
    resolver: zodResolver(acceptInviteSchema),
    defaultValues: { token, firstName: '', lastName: '', password: '', confirmPassword: '' },
  });

  const password = form.watch('password');

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const session = await api.post<AuthSessionResponse>('/auth/accept-invite', values, { skipAuthRetry: true });
      queryClient.setQueryData(queryKeys.session, session);
      toast.success(`Welcome to ${session.tenant?.name ?? 'the workspace'}`);
      router.replace('/dashboard');
    } catch (error) {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    }
  });

  const error = form.formState.errors.root?.message;
  const submitting = form.formState.isSubmitting;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <input type="hidden" {...form.register('token')} />

      <fieldset disabled={submitting} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              autoComplete="given-name"
              aria-invalid={Boolean(form.formState.errors.firstName)}
              {...form.register('firstName')}
            />
            {form.formState.errors.firstName ? (
              <p className="text-xs text-destructive">{form.formState.errors.firstName.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              autoComplete="family-name"
              aria-invalid={Boolean(form.formState.errors.lastName)}
              {...form.register('lastName')}
            />
            {form.formState.errors.lastName ? (
              <p className="text-xs text-destructive">{form.formState.errors.lastName.message}</p>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Choose a password</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            aria-invalid={Boolean(form.formState.errors.password)}
            {...form.register('password')}
          />
          <PasswordStrength value={password} />
          {form.formState.errors.password ? (
            <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            aria-invalid={Boolean(form.formState.errors.confirmPassword)}
            {...form.register('confirmPassword')}
          />
          {form.formState.errors.confirmPassword ? (
            <p className="text-xs text-destructive">{form.formState.errors.confirmPassword.message}</p>
          ) : null}
        </div>

        <Button type="submit" className="w-full" loading={submitting}>
          Join workspace
        </Button>
      </fieldset>

      <p className="text-center text-sm text-muted-foreground">
        Wrong account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in instead
        </Link>
      </p>
    </form>
  );
}
