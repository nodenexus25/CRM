'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  ScanLine,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import {
  RESUME_ACCEPT_SECTION_LABELS,
  RESUME_PARSE_STATUS_LABELS,
  SKILL_PROFICIENCY_LABELS,
  type AcceptResumeResponse,
  type ResumeAcceptOverrides,
  type ResumeAcceptSections,
  type ResumeDetail,
  type ResumeParseStatus,
  type ResumeParsedData,
  type ResumeParserChoice,
} from '@talentflow/types';
import { formatBytes, formatDurationMs } from '@talentflow/ui';

import { useResumePolling } from '@/components/resumes/use-resume-polling';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { queryKeys } from '@/lib/query-keys';

// ---------------------------------------------------------------------------
// Local configuration
// ---------------------------------------------------------------------------

const SECTION_KEYS = [
  'profile',
  'skills',
  'experiences',
  'educations',
  'certifications',
  'languages',
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

const ALL_SECTIONS: ResumeAcceptSections = {
  profile: true,
  skills: true,
  experiences: true,
  educations: true,
  certifications: true,
  languages: true,
};

const STATUS_VARIANT: Record<ResumeParseStatus, BadgeProps['variant']> = {
  PENDING: 'muted',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'destructive',
  NEEDS_OCR: 'warning',
};

const PARSER_CHOICES: { value: ResumeParserChoice; label: string }[] = [
  { value: 'auto', label: 'Auto (recommended)' },
  { value: 'llm', label: 'LLM' },
  { value: 'regex', label: 'Regex (offline)' },
];

/** The editable profile fields surfaced by the review dialog. */
interface ProfileDraft {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  headline: string;
  currentTitle: string;
  currentCompany: string;
  locationCity: string;
  locationState: string;
  locationCountry: string;
  totalExperienceMonths: string;
  summary: string;
}

const EMPTY_PROFILE: ProfileDraft = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  headline: '',
  currentTitle: '',
  currentCompany: '',
  locationCity: '',
  locationState: '',
  locationCountry: '',
  totalExperienceMonths: '',
  summary: '',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pre-fills the reviewer's draft from the parsed payload, newest role first. */
function profileFromParsed(parsed: ResumeParsedData | null): ProfileDraft {
  if (!parsed) return { ...EMPTY_PROFILE };
  const current = parsed.experiences.find((entry) => entry.isCurrent) ?? parsed.experiences[0];
  return {
    firstName: parsed.firstName ?? '',
    lastName: parsed.lastName ?? '',
    email: parsed.email ?? '',
    phone: parsed.phone ?? '',
    headline: parsed.headline ?? '',
    currentTitle: current?.title ?? '',
    currentCompany: current?.company ?? '',
    locationCity: parsed.locationCity ?? '',
    locationState: parsed.locationState ?? '',
    locationCountry: parsed.locationCountry ?? '',
    totalExperienceMonths:
      parsed.totalExperienceMonths !== null ? String(parsed.totalExperienceMonths) : '',
    summary: parsed.summary ?? '',
  };
}

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Empty strings become `null`, which the API treats as an explicit clear. */
function buildOverrides(profile: ProfileDraft): ResumeAcceptOverrides {
  const months = profile.totalExperienceMonths.trim();
  const parsedMonths = months.length > 0 && !Number.isNaN(Number(months)) ? Number(months) : null;
  return {
    firstName: trimmedOrNull(profile.firstName),
    lastName: trimmedOrNull(profile.lastName),
    email: trimmedOrNull(profile.email),
    phone: trimmedOrNull(profile.phone),
    headline: trimmedOrNull(profile.headline),
    currentTitle: trimmedOrNull(profile.currentTitle),
    currentCompany: trimmedOrNull(profile.currentCompany),
    locationCity: trimmedOrNull(profile.locationCity),
    locationState: trimmedOrNull(profile.locationState),
    locationCountry: trimmedOrNull(profile.locationCountry),
    totalExperienceMonths: parsedMonths,
    summary: trimmedOrNull(profile.summary),
  };
}

function countProfileFields(parsed: ResumeParsedData | null): number {
  if (!parsed) return 0;
  const fields: (string | number | null)[] = [
    parsed.firstName,
    parsed.lastName,
    parsed.email,
    parsed.phone,
    parsed.headline,
    parsed.summary,
    parsed.locationCity,
    parsed.locationState,
    parsed.locationCountry,
    parsed.linkedinUrl,
    parsed.githubUrl,
    parsed.websiteUrl,
    parsed.totalExperienceMonths,
  ];
  return fields.filter((value) => value !== null && String(value).trim().length > 0).length;
}

function parserLabel(parserUsed: string | null): string {
  if (!parserUsed) return 'Unknown';
  return parserUsed.toLowerCase() === 'llm'
    ? 'LLM'
    : parserUsed.charAt(0).toUpperCase() + parserUsed.slice(1);
}

/** The API stores confidence as a 0–1 fraction; the UI shows a percentage. */
function confidencePercent(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value <= 1 ? value * 100 : value);
}

/** Pulls the colliding candidate out of a 409 body's `details`. */
function extractDuplicateCandidateId(details: unknown): string | null {
  if (details === null || typeof details !== 'object') return null;
  const record = details as { candidateId?: unknown };
  return typeof record.candidateId === 'string' ? record.candidateId : null;
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function ReviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function SectionShell({
  id,
  label,
  count,
  checked,
  onCheckedChange,
  children,
}: {
  id: string;
  label: string;
  count: number;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={checked}
            onCheckedChange={(value) => onCheckedChange(value === true)}
          />
          <label htmlFor={id} className="cursor-pointer text-sm font-medium">
            {label}
          </label>
        </div>
        <Badge variant={count > 0 ? 'secondary' : 'muted'}>{count}</Badge>
      </div>
      {children ? <div className="px-4 py-3">{children}</div> : null}
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

interface ResumeReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resumeId: string;
  /** Attach to an existing candidate rather than creating one from the parse. */
  candidateId?: string;
  /** Fired after a successful accept with the target candidate. */
  onAccepted: (candidateId: string, created: boolean) => void;
}

/**
 * Review-and-accept workspace for a parsed résumé.
 *
 * Left unchecked, every extracted section is folded into the candidate; the
 * reviewer can deselect a section or correct the profile before saving. The
 * dialog polls while the parse is still in flight, surfaces `FAILED` and
 * `NEEDS_OCR` outcomes, and handles the duplicate-candidate 409 by offering a
 * deliberate "create anyway".
 */
export function ResumeReviewDialog({
  open,
  onOpenChange,
  resumeId,
  candidateId,
  onAccepted,
}: ResumeReviewDialogProps) {
  const uid = useId();
  const queryClient = useQueryClient();
  const initializedRef = useRef<string | null>(null);

  const [sections, setSections] = useState<ResumeAcceptSections>({ ...ALL_SECTIONS });
  const [profile, setProfile] = useState<ProfileDraft>({ ...EMPTY_PROFILE });
  const [parserChoice, setParserChoice] = useState<ResumeParserChoice>('auto');
  const [duplicateCandidateId, setDuplicateCandidateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const polling = useResumePolling(open ? resumeId : null, { enabled: open });
  const resume = polling.data;
  const parsed = resume?.parsedData ?? null;
  const ready = resume?.parseStatus === 'COMPLETED';

  // Reset per-open state before the init effect below repopulates the draft.
  useEffect(() => {
    if (!open) return;
    initializedRef.current = null;
    setSections({ ...ALL_SECTIONS });
    setProfile({ ...EMPTY_PROFILE });
    setParserChoice('auto');
    setDuplicateCandidateId(null);
    setError(null);
  }, [open]);

  // Re-seed the profile whenever the parse identity changes (fresh upload or a
  // completed re-parse), but never while the reviewer is editing a settled one.
  const initKey = resume ? `${resume.id}:${resume.parsedAt ?? 'pending'}` : null;
  useEffect(() => {
    if (!initKey) return;
    if (initializedRef.current === initKey) return;
    initializedRef.current = initKey;
    setProfile(profileFromParsed(parsed));
  }, [initKey, parsed]);

  const accept = useMutation({
    mutationFn: (allowDuplicate: boolean) =>
      api.post<AcceptResumeResponse>(`/resumes/${resumeId}/accept`, {
        ...(candidateId ? { candidateId } : {}),
        sections,
        overrides: sections.profile ? buildOverrides(profile) : {},
        makePrimary: true,
        allowDuplicate,
      }),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.resumes.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.candidates.all });
      setDuplicateCandidateId(null);
      setError(null);
      toast.success(
        response.created
          ? `${response.candidate.fullName} created from résumé`
          : `Résumé applied to ${response.candidate.fullName}`,
      );
      onOpenChange(false);
      onAccepted(response.candidateId, response.created);
    },
    onError: (caught: unknown) => {
      if (caught instanceof ApiError && caught.isConflict) {
        const existingId = extractDuplicateCandidateId(caught.details);
        if (existingId) {
          setDuplicateCandidateId(existingId);
          setError(null);
          return;
        }
      }
      setDuplicateCandidateId(null);
      const message = describeError(caught, 'The résumé could not be accepted.');
      setError(message);
      toast.error(message);
    },
  });

  const reparse = useMutation({
    mutationFn: (parser: ResumeParserChoice) =>
      api.post<ResumeDetail>(`/resumes/${resumeId}/reparse`, { parser }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.resumes.all });
      toast.success('Re-parsing résumé…');
    },
    onError: (caught: unknown) => {
      toast.error(describeError(caught, 'Could not start a re-parse.'));
    },
  });

  function setField(key: keyof ProfileDraft, value: string) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  function toggleSection(key: SectionKey, value: boolean) {
    setSections((prev) => ({ ...prev, [key]: value }));
  }

  const counts: Record<SectionKey, number> = {
    profile: countProfileFields(parsed),
    skills: parsed?.skills.length ?? 0,
    experiences: parsed?.experiences.length ?? 0,
    educations: parsed?.educations.length ?? 0,
    certifications: parsed?.certifications.length ?? 0,
    languages: parsed?.languages.length ?? 0,
  };

  const enabledSections = SECTION_KEYS.filter((key) => sections[key] && counts[key] > 0);
  const busy = accept.isPending;
  const normalizedSkills = resume?.normalizedSkills ?? parsed?.normalizedSkills ?? [];
  const confidence = confidencePercent(resume?.parserConfidence ?? null);

  function renderReparseControls() {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={parserChoice}
          onValueChange={(value) => setParserChoice(value as ResumeParserChoice)}
        >
          <SelectTrigger className="h-8 w-44" aria-label="Parser">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PARSER_CHOICES.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={reparse.isPending}
          disabled={reparse.isPending}
          onClick={() => reparse.mutate(parserChoice)}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Re-parse
        </Button>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            Review parsed résumé
          </DialogTitle>
          <DialogDescription>
            {resume
              ? `${resume.fileName} · ${formatBytes(resume.sizeBytes)} — choose what to keep, correct anything the parser got wrong, then accept.`
              : 'Choose what to keep, correct anything the parser got wrong, then accept.'}
          </DialogDescription>
        </DialogHeader>

        {/* Body ------------------------------------------------------------ */}
        {polling.isPending && !resume ? (
          <ReviewSkeleton />
        ) : polling.isError && !resume ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Could not load this résumé</AlertTitle>
            <AlertDescription>
              <p>{describeError(polling.error, 'Please try again in a moment.')}</p>
              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={() => void polling.refetch()}>
                  Retry
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : !resume ? null : !ready ? (
          <div className="space-y-4">
            {resume.parseStatus === 'FAILED' ? (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>{RESUME_PARSE_STATUS_LABELS.FAILED}</AlertTitle>
                <AlertDescription>
                  <p>
                    {resume.parseError ??
                      'The résumé could not be parsed. The file may be corrupt or unsupported.'}
                  </p>
                </AlertDescription>
              </Alert>
            ) : resume.parseStatus === 'NEEDS_OCR' ? (
              <Alert variant="warning">
                <ScanLine aria-hidden="true" />
                <AlertTitle>{RESUME_PARSE_STATUS_LABELS.NEEDS_OCR}</AlertTitle>
                <AlertDescription>
                  <p>
                    {resume.parseError ??
                      'This file has no selectable text layer, so nothing could be extracted.'}
                  </p>
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <Spinner />
                <span>
                  {resume.parseStatus === 'PROCESSING' ? 'Parsing résumé…' : 'Queued for parsing…'}
                </span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              You can try another parser, or accept is disabled until the résumé parses cleanly.
            </p>
            {renderReparseControls()}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Provenance */}
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <Badge variant={STATUS_VARIANT[resume.parseStatus]}>
                  {RESUME_PARSE_STATUS_LABELS[resume.parseStatus]}
                </Badge>
                <span className="text-muted-foreground">
                  Parser: <span className="font-medium text-foreground">{parserLabel(resume.parserUsed)}</span>
                </span>
                {confidence !== null ? (
                  <span className="text-muted-foreground">
                    Confidence: <span className="font-medium text-foreground">{confidence}%</span>
                  </span>
                ) : null}
                {resume.parseDurationMs !== null ? (
                  <span className="text-muted-foreground">
                    Took <span className="font-medium text-foreground">{formatDurationMs(resume.parseDurationMs)}</span>
                  </span>
                ) : null}
              </div>
              <div className="mt-3">{renderReparseControls()}</div>
            </div>

            {/* Duplicate / error surfaces */}
            {duplicateCandidateId ? (
              <Alert variant="warning">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>Possible duplicate candidate</AlertTitle>
                <AlertDescription>
                  <p>
                    A candidate with the same email, phone or LinkedIn already exists. Review the
                    match before creating a second record.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/candidates/${duplicateCandidateId}`} target="_blank">
                        <ExternalLink className="size-4" aria-hidden="true" />
                        Open existing candidate
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      loading={busy}
                      onClick={() => accept.mutate(true)}
                    >
                      <UserPlus className="size-4" aria-hidden="true" />
                      Create anyway
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>Could not accept this résumé</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {/* Profile */}
            <SectionShell
              id={`${uid}-profile`}
              label={RESUME_ACCEPT_SECTION_LABELS.profile}
              count={counts.profile}
              checked={sections.profile}
              onCheckedChange={(value) => toggleSection('profile', value)}
            >
              {parsed ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${uid}-firstName`}>First name</Label>
                    <Input
                      id={`${uid}-firstName`}
                      value={profile.firstName}
                      disabled={!sections.profile}
                      onChange={(event) => setField('firstName', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${uid}-lastName`}>Last name</Label>
                    <Input
                      id={`${uid}-lastName`}
                      value={profile.lastName}
                      disabled={!sections.profile}
                      onChange={(event) => setField('lastName', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${uid}-email`}>Email</Label>
                    <Input
                      id={`${uid}-email`}
                      type="email"
                      value={profile.email}
                      disabled={!sections.profile}
                      onChange={(event) => setField('email', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${uid}-phone`}>Phone</Label>
                    <Input
                      id={`${uid}-phone`}
                      type="tel"
                      value={profile.phone}
                      disabled={!sections.profile}
                      onChange={(event) => setField('phone', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${uid}-currentTitle`}>Current title</Label>
                    <Input
                      id={`${uid}-currentTitle`}
                      value={profile.currentTitle}
                      disabled={!sections.profile}
                      onChange={(event) => setField('currentTitle', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${uid}-currentCompany`}>Current company</Label>
                    <Input
                      id={`${uid}-currentCompany`}
                      value={profile.currentCompany}
                      disabled={!sections.profile}
                      onChange={(event) => setField('currentCompany', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`${uid}-headline`}>Headline</Label>
                    <Input
                      id={`${uid}-headline`}
                      value={profile.headline}
                      disabled={!sections.profile}
                      onChange={(event) => setField('headline', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${uid}-locationCity`}>City</Label>
                    <Input
                      id={`${uid}-locationCity`}
                      value={profile.locationCity}
                      disabled={!sections.profile}
                      onChange={(event) => setField('locationCity', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${uid}-locationState`}>State / region</Label>
                    <Input
                      id={`${uid}-locationState`}
                      value={profile.locationState}
                      disabled={!sections.profile}
                      onChange={(event) => setField('locationState', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${uid}-locationCountry`}>Country</Label>
                    <Input
                      id={`${uid}-locationCountry`}
                      value={profile.locationCountry}
                      disabled={!sections.profile}
                      onChange={(event) => setField('locationCountry', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${uid}-experience`}>Total experience (months)</Label>
                    <Input
                      id={`${uid}-experience`}
                      type="number"
                      min={0}
                      max={840}
                      inputMode="numeric"
                      value={profile.totalExperienceMonths}
                      disabled={!sections.profile}
                      onChange={(event) => setField('totalExperienceMonths', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`${uid}-summary`}>Summary</Label>
                    <Textarea
                      id={`${uid}-summary`}
                      rows={3}
                      value={profile.summary}
                      disabled={!sections.profile}
                      onChange={(event) => setField('summary', event.target.value)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Rows left blank clear the matching field on the candidate; unchecking Profile
                    keeps whatever is already there.
                  </p>
                </div>
              ) : (
                <EmptyLine>No contact details were extracted.</EmptyLine>
              )}
            </SectionShell>

            {/* Skills */}
            <SectionShell
              id={`${uid}-skills`}
              label={RESUME_ACCEPT_SECTION_LABELS.skills}
              count={counts.skills}
              checked={sections.skills}
              onCheckedChange={(value) => toggleSection('skills', value)}
            >
              {normalizedSkills.length > 0 ? (
                <div
                  className={
                    sections.skills ? 'flex flex-wrap gap-1.5' : 'flex flex-wrap gap-1.5 opacity-50'
                  }
                >
                  {normalizedSkills.map((skill, index) => {
                    const matched = skill.skillId !== null || skill.category !== null;
                    return (
                      <Badge
                        key={`${skill.name}-${index}`}
                        variant={matched ? 'secondary' : 'outline'}
                        className={matched ? undefined : 'border-dashed'}
                        title={
                          matched
                            ? `Matched to “${skill.matchedName}”`
                            : `New skill — will be created as “${skill.matchedName}”`
                        }
                      >
                        {skill.matchedName}
                        {skill.years !== null ? (
                          <span className="text-muted-foreground">· {skill.years}y</span>
                        ) : null}
                        {matched ? null : <span className="text-muted-foreground">new</span>}
                      </Badge>
                    );
                  })}
                </div>
              ) : (
                <EmptyLine>No skills were extracted.</EmptyLine>
              )}
            </SectionShell>

            {/* Experiences */}
            <SectionShell
              id={`${uid}-experiences`}
              label={RESUME_ACCEPT_SECTION_LABELS.experiences}
              count={counts.experiences}
              checked={sections.experiences}
              onCheckedChange={(value) => toggleSection('experiences', value)}
            >
              {parsed && parsed.experiences.length > 0 ? (
                <ul
                  className={
                    sections.experiences
                      ? 'space-y-1 text-sm'
                      : 'space-y-1 text-sm opacity-50'
                  }
                >
                  {parsed.experiences.slice(0, 3).map((experience, index) => (
                    <li key={index} className="flex items-baseline justify-between gap-3">
                      <span className="truncate">
                        <span className="font-medium">{experience.title ?? 'Untitled role'}</span>
                        {experience.company ? (
                          <span className="text-muted-foreground"> · {experience.company}</span>
                        ) : null}
                      </span>
                      {experience.isCurrent ? (
                        <span className="shrink-0 text-xs text-muted-foreground">Current</span>
                      ) : null}
                    </li>
                  ))}
                  {parsed.experiences.length > 3 ? (
                    <li className="text-xs text-muted-foreground">
                      +{parsed.experiences.length - 3} more
                    </li>
                  ) : null}
                </ul>
              ) : (
                <EmptyLine>No work history was extracted.</EmptyLine>
              )}
            </SectionShell>

            {/* Educations */}
            <SectionShell
              id={`${uid}-educations`}
              label={RESUME_ACCEPT_SECTION_LABELS.educations}
              count={counts.educations}
              checked={sections.educations}
              onCheckedChange={(value) => toggleSection('educations', value)}
            >
              {parsed && parsed.educations.length > 0 ? (
                <ul
                  className={
                    sections.educations ? 'space-y-1 text-sm' : 'space-y-1 text-sm opacity-50'
                  }
                >
                  {parsed.educations.slice(0, 3).map((education, index) => (
                    <li key={index} className="truncate">
                      <span className="font-medium">{education.degree ?? 'Qualification'}</span>
                      {education.institution ? (
                        <span className="text-muted-foreground"> · {education.institution}</span>
                      ) : null}
                    </li>
                  ))}
                  {parsed.educations.length > 3 ? (
                    <li className="text-xs text-muted-foreground">
                      +{parsed.educations.length - 3} more
                    </li>
                  ) : null}
                </ul>
              ) : (
                <EmptyLine>No education was extracted.</EmptyLine>
              )}
            </SectionShell>

            {/* Certifications */}
            <SectionShell
              id={`${uid}-certifications`}
              label={RESUME_ACCEPT_SECTION_LABELS.certifications}
              count={counts.certifications}
              checked={sections.certifications}
              onCheckedChange={(value) => toggleSection('certifications', value)}
            >
              {parsed && parsed.certifications.length > 0 ? (
                <ul
                  className={
                    sections.certifications ? 'space-y-1 text-sm' : 'space-y-1 text-sm opacity-50'
                  }
                >
                  {parsed.certifications.slice(0, 3).map((certification, index) => (
                    <li key={index} className="truncate">
                      <span className="font-medium">{certification.name}</span>
                      {certification.issuer ? (
                        <span className="text-muted-foreground"> · {certification.issuer}</span>
                      ) : null}
                    </li>
                  ))}
                  {parsed.certifications.length > 3 ? (
                    <li className="text-xs text-muted-foreground">
                      +{parsed.certifications.length - 3} more
                    </li>
                  ) : null}
                </ul>
              ) : (
                <EmptyLine>No certifications were extracted.</EmptyLine>
              )}
            </SectionShell>

            {/* Languages */}
            <SectionShell
              id={`${uid}-languages`}
              label={RESUME_ACCEPT_SECTION_LABELS.languages}
              count={counts.languages}
              checked={sections.languages}
              onCheckedChange={(value) => toggleSection('languages', value)}
            >
              {parsed && parsed.languages.length > 0 ? (
                <div
                  className={
                    sections.languages ? 'flex flex-wrap gap-1.5' : 'flex flex-wrap gap-1.5 opacity-50'
                  }
                >
                  {parsed.languages.map((language, index) => (
                    <Badge key={index} variant="muted">
                      {language.name}
                      <span className="text-muted-foreground">
                        {SKILL_PROFICIENCY_LABELS[language.proficiency]}
                      </span>
                    </Badge>
                  ))}
                </div>
              ) : (
                <EmptyLine>No languages were extracted.</EmptyLine>
              )}
            </SectionShell>
          </div>
        )}

        <DialogFooter>
          {ready ? (
            <p className="mr-auto hidden text-xs text-muted-foreground sm:block">
              {enabledSections.length > 0
                ? `Applying ${enabledSections
                    .map((key) => `${RESUME_ACCEPT_SECTION_LABELS[key]} (${counts[key]})`)
                    .join(' · ')}`
                : 'Nothing selected to apply'}
            </p>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!ready || enabledSections.length === 0 || reparse.isPending}
            onClick={() => accept.mutate(false)}
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {candidateId ? 'Apply to candidate' : 'Accept résumé'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
