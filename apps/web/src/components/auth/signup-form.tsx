'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { signupSchema, type AuthSessionResponse, type SignupInput } from '@talentflow/types';
import { slugify } from '@talentflow/ui';

import { PasswordInput } from '@/components/auth/password-input';
import { PasswordStrength } from '@/components/auth/password-strength';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { env } from '@/lib/env';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';

interface SlugCheck {
  slug: string;
  available: boolean;
  suggestion?: string;
}

/**
 * `acceptedTerms` is a `z.literal(true)` on the wire, but a checkbox has to be
 * able to hold `false`, so the form type widens just that one field.
 */
type SignupFormValues = Omit<SignupInput, 'acceptedTerms' | 'workspaceSlug'> & {
  acceptedTerms: boolean;
  workspaceSlug: string;
};

export function SignupForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const slugEdited = useRef(false);

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      companyName: '',
      workspaceSlug: '',
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      acceptedTerms: false,
    },
  });

  const companyName = form.watch('companyName');
  const slug = form.watch('workspaceSlug');
  const password = form.watch('password');

  // Derive the workspace URL until the user edits it, then leave it alone.
  useEffect(() => {
    if (slugEdited.current) return;
    form.setValue('workspaceSlug', slugify(companyName));
  }, [companyName, form]);

  // The browser knows the visitor's zone; the API would otherwise default every
  // new workspace to UTC. Set after mount so SSR and the client agree.
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) form.setValue('timezone', zone);
  }, [form]);

  const slugCheck = useQuery({
    queryKey: ['auth', 'check-slug', slug] as const,
    queryFn: () => api.get<SlugCheck>('/auth/check-slug', { query: { slug }, skipAuthRetry: true }),
    enabled: slug.length >= 2,
    staleTime: 30_000,
    retry: false,
  });

  const slugTaken = slugCheck.data?.available === false;

  const onSubmit = form.handleSubmit(async (values) => {
    if (slugTaken) {
      form.setError('workspaceSlug', { type: 'server', message: 'That workspace URL is already taken' });
      return;
    }

    try {
      const session = await api.post<AuthSessionResponse>(
        '/auth/signup',
        {
          ...values,
          workspaceSlug: values.workspaceSlug || undefined,
          referralSource: 'web-signup',
        },
        { skipAuthRetry: true },
      );
      queryClient.setQueryData(queryKeys.session, session);
      toast.success(`Workspace “${session.tenant?.name ?? values.companyName}” is ready`);
      router.replace('/dashboard');
    } catch (error) {
      form.setError('root', { type: 'server', message: applyApiError(error, form.setError) });
    }
  });

  const rootError = form.formState.errors.root?.message;
  const submitting = form.formState.isSubmitting;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {rootError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{rootError}</AlertDescription>
        </Alert>
      ) : null}

      <fieldset disabled={submitting} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="companyName">Company name</Label>
          <Input
            id="companyName"
            autoComplete="organization"
            placeholder="Acme Staffing"
            aria-invalid={Boolean(form.formState.errors.companyName)}
            {...form.register('companyName')}
          />
          {form.formState.errors.companyName ? (
            <p className="text-xs text-destructive">{form.formState.errors.companyName.message}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="workspaceSlug">Workspace URL</Label>
          <div className="flex items-stretch">
            <Input
              id="workspaceSlug"
              className="rounded-r-none border-r-0"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={slugTaken || Boolean(form.formState.errors.workspaceSlug)}
              aria-describedby="workspaceSlug-hint"
              {...form.register('workspaceSlug', { onChange: () => (slugEdited.current = true) })}
            />
            <span className="inline-flex items-center whitespace-nowrap rounded-r-md border border-input bg-muted px-3 text-xs text-muted-foreground">
              .{env.rootDomain}
            </span>
          </div>

          <p id="workspaceSlug-hint" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {slug.length < 2 ? (
              'Used for your workspace link. Lowercase letters, numbers and hyphens.'
            ) : slugCheck.isFetching ? (
              <>
                <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Checking availability…
              </>
            ) : slugTaken ? (
              <>
                <X className="size-3 text-destructive" aria-hidden="true" />
                <span className="text-destructive">
                  Already taken{slugCheck.data?.suggestion ? ` — try ${slugCheck.data.suggestion}` : ''}
                </span>
              </>
            ) : slugCheck.data?.available ? (
              <>
                <Check className="size-3 text-success" aria-hidden="true" /> Available
              </>
            ) : (
              'Used for your workspace link.'
            )}
          </p>

          {form.formState.errors.workspaceSlug ? (
            <p className="text-xs text-destructive">{form.formState.errors.workspaceSlug.message}</p>
          ) : null}
        </div>

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

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
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
          <div className="flex items-start gap-2">
            <Checkbox
              id="acceptedTerms"
              className="mt-0.5"
              checked={form.watch('acceptedTerms')}
              onCheckedChange={(checked) => form.setValue('acceptedTerms', checked === true, { shouldValidate: true })}
              aria-invalid={Boolean(form.formState.errors.acceptedTerms)}
            />
            <Label htmlFor="acceptedTerms" className="text-sm font-normal leading-snug text-muted-foreground">
              I agree to the terms of service and privacy policy.
            </Label>
          </div>
          {form.formState.errors.acceptedTerms ? (
            <p className="text-xs text-destructive">{form.formState.errors.acceptedTerms.message}</p>
          ) : null}
        </div>

        <Button type="submit" className="w-full" loading={submitting}>
          Create workspace
        </Button>
      </fieldset>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
