'use client';

import { useMutation } from '@tanstack/react-query';
import { Building2, Search, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { CandidateDuplicateResponse } from '@talentflow/types';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api-client';

const MATCH_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  PHONE: 'Phone',
  LINKEDIN: 'LinkedIn',
  FUZZY: 'Similar name',
};

interface DuplicateFormState {
  email: string;
  phone: string;
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  currentCompany: string;
}

const EMPTY_FORM: DuplicateFormState = {
  email: '',
  phone: '',
  linkedinUrl: '',
  firstName: '',
  lastName: '',
  currentCompany: '',
};

interface FindDuplicatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Pre-save duplicate check. The recruiter types whatever they know about the
 * person (email, phone, LinkedIn, a name and/or company) and the API returns
 * the groups of existing records that likely describe the same human, so the
 * second record never gets created.
 */
export function FindDuplicatesDialog({ open, onOpenChange }: FindDuplicatesDialogProps) {
  const [values, setValues] = useState<DuplicateFormState>(EMPTY_FORM);
  const [result, setResult] = useState<CandidateDuplicateResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(EMPTY_FORM);
    setResult(null);
  }, [open]);

  const check = useMutation({
    mutationFn: () =>
      api.post<CandidateDuplicateResponse>('/candidates/duplicates', {
        email: values.email.trim() || undefined,
        phone: values.phone.trim() || undefined,
        linkedinUrl: values.linkedinUrl.trim() || undefined,
        firstName: values.firstName.trim() || undefined,
        lastName: values.lastName.trim() || undefined,
        currentCompany: values.currentCompany.trim() || undefined,
      }),
    onSuccess: (data) => {
      setResult(data);
      if (data.groups.length === 0) toast.success('No likely duplicates found');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not run the duplicate check');
    },
  });

  const hasCriteria = Object.values(values).some((value) => value.trim().length > 0);
  const groups = result?.groups ?? [];

  function set<K extends keyof DuplicateFormState>(key: K, value: string) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="size-4 text-primary" aria-hidden="true" />
            Find duplicates
          </DialogTitle>
          <DialogDescription>
            Enter any details you have on the person. The pool is scanned for matching emails,
            phones, LinkedIn profiles and similar names so you can merge instead of re-adding.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="duplicate-email">Email</Label>
            <Input
              id="duplicate-email"
              type="email"
              value={values.email}
              onChange={(event) => set('email', event.target.value)}
              placeholder="name@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="duplicate-phone">Phone</Label>
            <Input
              id="duplicate-phone"
              type="tel"
              value={values.phone}
              onChange={(event) => set('phone', event.target.value)}
              placeholder="+1 555 0100"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="duplicate-linkedin">LinkedIn</Label>
            <Input
              id="duplicate-linkedin"
              type="url"
              value={values.linkedinUrl}
              onChange={(event) => set('linkedinUrl', event.target.value)}
              placeholder="https://linkedin.com/in/…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="duplicate-first-name">First name</Label>
            <Input
              id="duplicate-first-name"
              value={values.firstName}
              onChange={(event) => set('firstName', event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="duplicate-last-name">Last name</Label>
            <Input
              id="duplicate-last-name"
              value={values.lastName}
              onChange={(event) => set('lastName', event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="duplicate-company">Company</Label>
            <Input
              id="duplicate-company"
              value={values.currentCompany}
              onChange={(event) => set('currentCompany', event.target.value)}
            />
          </div>
        </div>

        <Button
          type="button"
          size="sm"
          className="self-start"
          loading={check.isPending}
          disabled={!hasCriteria}
          onClick={() => check.mutate()}
        >
          Run check
        </Button>

        {result ? (
          <>
            <Separator />
            {groups.length === 0 ? (
              <EmptyState
                icon={UserRound}
                title="No likely duplicates"
                description={`Scanned ${result.scanned} candidate${result.scanned === 1 ? '' : 's'} — nothing matched.`}
              />
            ) : (
              <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
                {groups.map((group, index) => (
                  <div key={`${group.matchType}-${index}`} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="warning">{MATCH_LABELS[group.matchType] ?? group.matchType}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {group.candidates.length} match{group.candidates.length === 1 ? '' : 'es'}
                        {group.matchType === 'FUZZY'
                          ? ` · ${Math.round(group.score * 100)}% similar`
                          : ''}
                      </span>
                    </div>

                    <ul className="space-y-1.5">
                      {group.candidates.map((match) => (
                        <li
                          key={match.id}
                          className="flex items-center gap-3 rounded-md border border-border p-2.5"
                        >
                          <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/candidates/${match.id}`}
                              className="block truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
                            >
                              {match.fullName}
                            </Link>
                            <p className="truncate text-xs text-muted-foreground">
                              {[match.email, match.phone].filter(Boolean).join(' · ') || 'No contact details'}
                            </p>
                          </div>
                          {match.currentCompany ? (
                            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                              <Building2 className="size-3.5" aria-hidden="true" />
                              {match.currentCompany}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
