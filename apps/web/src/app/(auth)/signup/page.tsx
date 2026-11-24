import type { Metadata } from 'next';

import { SignupForm } from '@/components/auth/signup-form';

export const metadata: Metadata = {
  title: 'Create your workspace',
  description: 'Start a TalentFlow workspace — your company, your roles, your pipeline.',
};

export default function SignupPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
        <p className="text-sm text-muted-foreground">
          We provision your company, its role templates and your administrator account in one step.
        </p>
      </header>

      <SignupForm />
    </div>
  );
}
