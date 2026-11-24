import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  KanbanSquare,
  Lock,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'ATS & Recruitment CRM for staffing agencies',
  description:
    'TalentFlow keeps requisitions, candidates, submissions, clients and placements in one workspace — with per-tenant isolation, granular roles and reporting that recruiters actually use.',
};

const CAPABILITIES = [
  {
    icon: KanbanSquare,
    title: 'Pipeline that mirrors your desk',
    body: 'Sourced, screening, submitted, client review, interview, offer, placed — configurable stages with drag-and-drop, per job.',
  },
  {
    icon: Search,
    title: 'Find the candidate again',
    body: 'Boolean and full-text search across skills, titles, locations and tags, with saved views you can share with the team.',
  },
  {
    icon: ClipboardList,
    title: 'Submissions clients say yes to',
    body: 'Branded submission packets, contact details hidden by default, and every reply threaded back onto the record.',
  },
  {
    icon: CalendarClock,
    title: 'Interviews and offers, tracked',
    body: 'Schedule across timezones, collect structured feedback, then convert an accepted offer into a placement with margin intact.',
  },
  {
    icon: BarChart3,
    title: 'Reporting without the spreadsheet',
    body: 'Time-to-fill, pipeline conversion, source effectiveness and revenue per recruiter and per client.',
  },
  {
    icon: Sparkles,
    title: 'Assistive, not automatic',
    body: 'Resume parsing, candidate summaries and job-match scoring that a recruiter reviews before anything is saved.',
  },
] as const;

const ROLES = [
  'Tenant Admin',
  'Recruiter Manager',
  'Recruiter',
  'Account Manager',
  'Viewer',
] as const;

export default function LandingPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_50%_-10%,hsl(var(--primary)/0.14),transparent)]"
        />
        <div className="container relative flex flex-col items-center gap-6 py-24 text-center md:py-32">
          <Badge variant="default" className="gap-1.5">
            <Sparkles className="size-3" aria-hidden="true" />
            Built for multi-tenant staffing
          </Badge>

          <h1 className="max-w-4xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
            The recruiting desk, <span className="text-primary">end to end</span>
          </h1>

          <p className="max-w-2xl text-pretty text-lg text-muted-foreground">
            TalentFlow is the applicant tracking system and recruitment CRM that runs requisitions,
            candidates, submissions, clients and placements in a single workspace — so your recruiters
            stop reconciling tools and start filling roles.
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">
                Start a free trial
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            No credit card required. Your workspace is provisioned the moment you sign up.
          </p>
        </div>
      </section>

      <section id="features" className="container scroll-mt-20 py-20">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight">Everything the desk touches</h2>
          <p className="mt-3 text-muted-foreground">
            Each capability below is a first-class module backed by its own data model — not a
            spreadsheet with a nicer header.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((capability) => (
            <Card key={capability.title} className="h-full">
              <CardHeader className="gap-3">
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <capability.icon className="size-5" aria-hidden="true" />
                </span>
                <CardTitle className="text-base">{capability.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{capability.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section id="security" className="border-y border-border bg-muted/40 scroll-mt-20">
        <div className="container grid gap-12 py-20 lg:grid-cols-2 lg:items-center">
          <div className="space-y-6">
            <Badge variant="secondary" className="gap-1.5">
              <Lock className="size-3" aria-hidden="true" />
              Isolation by default
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight">
              Your data never mixes with another agency&rsquo;s
            </h2>
            <p className="text-muted-foreground">
              Every workspace is resolved from the authenticated session and enforced three times over:
              at the request boundary, in the data-access layer, and once more in PostgreSQL itself with
              row-level security. A missing tenant context fails closed rather than returning everything.
            </p>

            <ul className="space-y-3">
              {[
                'Row-level security policies on every tenant-owned table',
                'Argon2id password hashing with rotating refresh tokens in httpOnly cookies',
                'Granular permissions, editable per workspace, on every endpoint',
                'Full audit trail of who changed what, and when',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4 text-primary" aria-hidden="true" />
                Roles out of the box
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Start from a proven template, then edit it. Permissions are stored per workspace, so two
                agencies running the same plan can still run different desks.
              </p>
              <ul className="space-y-2">
                {ROLES.map((role) => (
                  <li
                    key={role}
                    className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{role}</span>
                    <span className="text-xs text-muted-foreground">Template</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="container py-20">
        <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-card">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">
            Spin up a workspace and see it with real data
          </h2>
          <p className="max-w-xl text-muted-foreground">
            Sign up creates your workspace, its role templates and your first administrator account in
            one step.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">
                Create your workspace
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">See pricing</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
