import { CheckCircle2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@talentflow/ui';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Simple per-seat pricing for TalentFlow. Start on a 14-day trial, upgrade when your desk is ready.',
};

interface Plan {
  code: 'STARTER' | 'GROWTH' | 'PRO' | 'ENTERPRISE';
  name: string;
  price: string;
  cadence: string;
  summary: string;
  included: readonly string[];
  highlighted?: boolean;
}

const PLANS: readonly Plan[] = [
  {
    code: 'STARTER',
    name: 'Starter',
    price: '$29',
    cadence: 'per user / month',
    summary: 'For a small desk getting off spreadsheets.',
    included: ['Up to 5 seats', 'Jobs, candidates and submissions', 'Client and contact records', 'Email support'],
  },
  {
    code: 'GROWTH',
    name: 'Growth',
    price: '$59',
    cadence: 'per user / month',
    summary: 'For growing agencies running a full pipeline.',
    included: [
      'Unlimited jobs and candidates',
      'Interviews, offers and placements',
      'Custom roles and permissions',
      'Dashboards and reports',
      'Priority support',
    ],
    highlighted: true,
  },
  {
    code: 'PRO',
    name: 'Pro',
    price: '$99',
    cadence: 'per user / month',
    summary: 'For multi-team agencies that need control.',
    included: [
      'Everything in Growth',
      'Audit log and saved views',
      'Custom pipeline stages and fields',
      'AI matching and resume parsing',
      'Onboarding assistance',
    ],
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    price: 'Custom',
    cadence: 'annual agreement',
    summary: 'For agencies with procurement and legal review.',
    included: [
      'Everything in Pro',
      'SSO and advanced security review',
      'Data residency and retention controls',
      'Dedicated success manager',
    ],
  },
] as const;

export default function PricingPage() {
  return (
    <div className="container py-20">
      <div className="mx-auto max-w-2xl text-center">
        <Badge variant="secondary">Pricing</Badge>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">Priced per seat, not per feature</h1>
        <p className="mt-4 text-muted-foreground">
          Every plan includes the full ATS and CRM data model, per-tenant isolation and unlimited
          clients. Start on a 14-day trial — no card required.
        </p>
      </div>

      <div className="mt-14 grid gap-6 lg:grid-cols-4">
        {PLANS.map((plan) => (
          <Card
            key={plan.code}
            className={cn('flex flex-col', plan.highlighted && 'border-primary/60 shadow-popover ring-1 ring-primary/30')}
          >
            <CardHeader className="gap-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">{plan.name}</CardTitle>
                {plan.highlighted ? <Badge>Most popular</Badge> : null}
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
                <span className="text-xs text-muted-foreground">{plan.cadence}</span>
              </div>
              <CardDescription>{plan.summary}</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-2.5">
                {plan.included.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button asChild className="w-full" variant={plan.highlighted ? 'default' : 'outline'}>
                <Link href={plan.code === 'ENTERPRISE' ? 'mailto:sales@talentflow.app' : '/signup'}>
                  {plan.code === 'ENTERPRISE' ? 'Talk to sales' : 'Start free trial'}
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <p className="mt-10 text-center text-xs text-muted-foreground">
        Plans are provisioned in the workspace and enforced by seat, job, storage and AI-credit limits.
      </p>
    </div>
  );
}
