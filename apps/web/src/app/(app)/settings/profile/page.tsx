'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, KeyRound, MailWarning, Save, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  changePasswordSchema,
  nameSchema,
  phoneSchema,
  timezoneSchema,
  urlSchema,
  type UpdateProfileRequest,
  type UserDetail,
} from '@talentflow/types';
import { formatDate, getInitials } from '@talentflow/ui';

import { PageHeader } from '@/components/shell/page-header';
import { PasswordInput } from '@/components/auth/password-input';
import { PasswordStrength } from '@/components/auth/password-strength';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api-client';
import { applyApiError } from '@/lib/form-errors';
import { queryKeys } from '@/lib/query-keys';
import { useSession } from '@/providers/session-provider';

/**
 * Mirrors `updateProfileSchema`, but every field is present in the form so the
 * inputs stay controlled. Empty strings are converted to `null` on submit.
 */
const profileFormSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  title: z.string().trim().max(80),
  phone: z.union([z.literal(''), phoneSchema]),
  avatarUrl: z.union([z.literal(''), urlSchema]),
  timezone: timezoneSchema,
  locale: z.string().trim().max(10),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

type PasswordFormValues = { currentPassword: string; newPassword: string; confirmPassword: string };

const EMPTY_PASSWORD: PasswordFormValues = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

export default function ProfileSettingsPage() {
  const { user, tenant, has, refetch } = useSession();
  const queryClient = useQueryClient();

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    values: user
      ? {
          firstName: user.firstName,
          lastName: user.lastName,
          title: user.title ?? '',
          phone: user.phone ?? '',
          avatarUrl: user.avatarUrl ?? '',
          timezone: user.timezone,
          locale: user.locale,
        }
      : undefined,
    defaultValues: {
      firstName: '',
      lastName: '',
      title: '',
      phone: '',
      avatarUrl: '',
      timezone: 'UTC',
      locale: 'en-US',
    },
  });

  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: EMPTY_PASSWORD,
  });

  const saveProfile = useMutation({
    mutationFn: (values: ProfileFormValues) => {
      const body: UpdateProfileRequest = {
        firstName: values.firstName,
        lastName: values.lastName,
        title: values.title || null,
        phone: values.phone || null,
        avatarUrl: values.avatarUrl || null,
        timezone: values.timezone,
        locale: values.locale || 'en-US',
      };
      return api.patch<UserDetail>('/users/me', body);
    },
    onSuccess: async () => {
      await refetch();
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      toast.success('Profile updated');
      profileForm.reset(profileForm.getValues());
    },
    onError: (error) => {
      profileForm.setError('root', {
        type: 'server',
        message: applyApiError(error, profileForm.setError),
      });
    },
  });

  const changePassword = useMutation({
    mutationFn: (values: PasswordFormValues) =>
      api.post<{ changed: true }>('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        confirmPassword: values.confirmPassword,
      }),
    onSuccess: () => {
      toast.success('Password changed');
      passwordForm.reset(EMPTY_PASSWORD);
    },
    onError: (error) => {
      passwordForm.setError('root', {
        type: 'server',
        message: applyApiError(error, passwordForm.setError),
      });
    },
  });

  const resendVerification = useMutation({
    mutationFn: () => api.post<{ sent: true }>('/auth/resend-verification', { email: user?.email }),
    onSuccess: () => toast.success('Verification email sent — check your inbox'),
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : 'Could not send the verification email'),
  });

  if (!user) return null;

  const avatarUrl = profileForm.watch('avatarUrl');
  const newPassword = passwordForm.watch('newPassword');
  const profileError = profileForm.formState.errors.root?.message;
  const passwordError = passwordForm.formState.errors.root?.message;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        title="Profile"
        description="Your personal details and sign-in credentials. These are separate from the workspace settings."
      />

      <Card>
        <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center">
          <Avatar className="size-14">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
            <AvatarFallback>{getInitials(user.fullName)}</AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-base font-semibold">{user.fullName}</p>
            <p className="text-sm text-muted-foreground">
              {user.title ? `${user.title} · ` : ''}
              {user.email}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {user.roles.map((role) => (
                <Badge key={role.id} variant="muted">
                  {role.name}
                </Badge>
              ))}
              {user.isSuperAdmin ? <Badge variant="warning">Platform admin</Badge> : null}
              {user.emailVerified ? (
                <Badge variant="success" className="gap-1">
                  <BadgeCheck className="size-3" aria-hidden="true" />
                  Verified
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <MailWarning className="size-3" aria-hidden="true" />
                  Unverified
                </Badge>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-1">
            <div>
              <dt className="text-xs text-muted-foreground">Workspace</dt>
              <dd className="font-medium">{tenant?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Member since</dt>
              <dd className="font-medium">
                {formatDate(user.createdAt, 'DD MMM YYYY', user.timezone)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {!user.emailVerified ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <MailWarning className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Confirm your email address</p>
                <p className="text-xs text-muted-foreground">
                  We will send a single-use link to {user.email}.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              loading={resendVerification.isPending}
              onClick={() => resendVerification.mutate()}
            >
              Send verification link
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
            Personal details
          </CardTitle>
          <CardDescription>
            Shown to your team on jobs, submissions and activity feeds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={profileForm.handleSubmit((values) => saveProfile.mutate(values))}
            className="space-y-4"
          >
            <fieldset disabled={saveProfile.isPending} className="space-y-4">
              {profileError ? (
                <Alert variant="destructive">
                  <AlertDescription>{profileError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" htmlFor="pf-first" error={profileForm.formState.errors.firstName?.message}>
                  <Input id="pf-first" autoComplete="given-name" {...profileForm.register('firstName')} />
                </Field>
                <Field label="Last name" htmlFor="pf-last" error={profileForm.formState.errors.lastName?.message}>
                  <Input id="pf-last" autoComplete="family-name" {...profileForm.register('lastName')} />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Job title" htmlFor="pf-title" optional>
                  <Input id="pf-title" placeholder="Senior Recruiter" {...profileForm.register('title')} />
                </Field>
                <Field
                  label="Phone"
                  htmlFor="pf-phone"
                  optional
                  error={profileForm.formState.errors.phone?.message}
                >
                  <Input id="pf-phone" autoComplete="tel" {...profileForm.register('phone')} />
                </Field>
              </div>

              <Field
                label="Avatar URL"
                htmlFor="pf-avatar"
                optional
                error={profileForm.formState.errors.avatarUrl?.message}
              >
                <Input
                  id="pf-avatar"
                  placeholder="https://cdn.example.com/me.jpg"
                  {...profileForm.register('avatarUrl')}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Timezone"
                  htmlFor="pf-timezone"
                  error={profileForm.formState.errors.timezone?.message}
                >
                  <Input id="pf-timezone" {...profileForm.register('timezone')} />
                </Field>
                <Field label="Locale" htmlFor="pf-locale">
                  <Input id="pf-locale" placeholder="en-US" {...profileForm.register('locale')} />
                </Field>
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  loading={saveProfile.isPending}
                  disabled={!profileForm.formState.isDirty}
                >
                  <Save className="size-4" aria-hidden="true" />
                  Save profile
                </Button>
              </div>
            </fieldset>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
            Password
          </CardTitle>
          <CardDescription>
            Changing your password signs out every other device that is still holding a refresh token.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={passwordForm.handleSubmit((values) => changePassword.mutate(values))}
            className="space-y-4"
          >
            <fieldset disabled={changePassword.isPending} className="space-y-4">
              {passwordError ? (
                <Alert variant="destructive">
                  <AlertDescription>{passwordError}</AlertDescription>
                </Alert>
              ) : null}

              <Field
                label="Current password"
                htmlFor="pf-current"
                error={passwordForm.formState.errors.currentPassword?.message}
              >
                <PasswordInput
                  id="pf-current"
                  autoComplete="current-password"
                  {...passwordForm.register('currentPassword')}
                />
              </Field>

              <Field
                label="New password"
                htmlFor="pf-new"
                error={passwordForm.formState.errors.newPassword?.message}
              >
                <PasswordInput
                  id="pf-new"
                  autoComplete="new-password"
                  {...passwordForm.register('newPassword')}
                />
                {newPassword ? <PasswordStrength value={newPassword} /> : null}
              </Field>

              <Field
                label="Confirm new password"
                htmlFor="pf-confirm"
                error={passwordForm.formState.errors.confirmPassword?.message}
              >
                <PasswordInput
                  id="pf-confirm"
                  autoComplete="new-password"
                  {...passwordForm.register('confirmPassword')}
                />
              </Field>

              <Separator />

              <div className="flex justify-end">
                <Button type="submit" size="sm" loading={changePassword.isPending}>
                  Change password
                </Button>
              </div>
            </fieldset>
          </form>
        </CardContent>
      </Card>

      {has('user:read') ? (
        <p className="text-xs text-muted-foreground">
          Need to change what you can access? Roles and permissions are managed by an administrator
          from the Roles screen.
        </p>
      ) : null}
    </div>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}

function Field({ label, htmlFor, error, optional, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {optional ? <span className="text-2xs text-muted-foreground">Optional</span> : null}
      </div>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
