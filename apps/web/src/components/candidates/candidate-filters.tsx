'use client';

import { RotateCcw, SlidersHorizontal } from 'lucide-react';

import {
  AVAILABILITY_LABELS,
  CANDIDATE_SOURCE_LABELS,
  CANDIDATE_STATUS_LABELS,
  WORK_AUTHORIZATION_LABELS,
  availabilitySchema,
  candidateSourceSchema,
  candidateStatusSchema,
  experienceLevelSchema,
  workAuthorizationSchema,
  type CandidateStatus,
} from '@talentflow/types';
import { cn } from '@talentflow/ui';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';

/**
 * The advanced filter state for the candidates list. The page owns this object
 * and folds it into the list query; the panel is a controlled editor over it.
 */
export interface CandidateFilters {
  status: CandidateStatus[];
  source: string[];
  experienceLevel: string[];
  availability: string[];
  workAuthorization: string[];
  location: string;
  isHot: boolean;
  hasResume: boolean;
  isArchived: boolean;
  minExperienceMonths: string;
  maxExperienceMonths: string;
  skillIds: string[];
}

export const EMPTY_CANDIDATE_FILTERS: CandidateFilters = {
  status: [],
  source: [],
  experienceLevel: [],
  availability: [],
  workAuthorization: [],
  location: '',
  isHot: false,
  hasResume: false,
  isArchived: false,
  minExperienceMonths: '',
  maxExperienceMonths: '',
  skillIds: [],
};

/** No `*_LABELS` map is published for experience level, so keep one locally. */
export const EXPERIENCE_LEVEL_LABELS: Record<string, string> = {
  INTERN: 'Intern',
  JUNIOR: 'Junior',
  MID: 'Mid-level',
  SENIOR: 'Senior',
  LEAD: 'Lead',
  PRINCIPAL: 'Principal',
  EXECUTIVE: 'Executive',
};

/** How many filter facets are active — drives the trigger's count badge. */
export function countActiveFilters(filters: CandidateFilters): number {
  let count = 0;
  if (filters.status.length > 0) count += 1;
  if (filters.source.length > 0) count += 1;
  if (filters.experienceLevel.length > 0) count += 1;
  if (filters.availability.length > 0) count += 1;
  if (filters.workAuthorization.length > 0) count += 1;
  if (filters.location.trim()) count += 1;
  if (filters.isHot) count += 1;
  if (filters.hasResume) count += 1;
  if (filters.isArchived) count += 1;
  if (filters.minExperienceMonths.trim()) count += 1;
  if (filters.maxExperienceMonths.trim()) count += 1;
  if (filters.skillIds.length > 0) count += 1;
  return count;
}

interface CandidateFiltersProps {
  value: CandidateFilters;
  onChange: (next: CandidateFilters) => void;
  onReset: () => void;
}

export function CandidateFilters({ value, onChange, onReset }: CandidateFiltersProps) {
  const activeCount = countActiveFilters(value);

  function toggle<K extends keyof CandidateFilters & ('status' | 'source' | 'experienceLevel' | 'availability' | 'workAuthorization')>(
    key: K,
    option: string,
  ) {
    const current = value[key] as string[];
    const next = current.includes(option)
      ? current.filter((entry) => entry !== option)
      : [...current, option];
    onChange({ ...value, [key]: next });
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Filters
          {activeCount > 0 ? (
            <Badge variant="default" aria-label={`${activeCount} filters active`}>
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </SheetTrigger>

      <SheetContent className="flex flex-col gap-6">
        <SheetHeader>
          <SheetTitle>Filter candidates</SheetTitle>
          <SheetDescription>
            Narrow the talent pool by status, origin, experience and more.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6">
          <CheckboxGroup
            legend="Status"
            ariaLabel="Filter by status"
            options={candidateStatusSchema.options.map((option) => ({
              value: option,
              label: CANDIDATE_STATUS_LABELS[option],
            }))}
            selected={value.status}
            onToggle={(option) => toggle('status', option)}
          />

          <Separator />

          <CheckboxGroup
            legend="Source"
            ariaLabel="Filter by source"
            options={candidateSourceSchema.options.map((option) => ({
              value: option,
              label: CANDIDATE_SOURCE_LABELS[option],
            }))}
            selected={value.source}
            onToggle={(option) => toggle('source', option)}
          />

          <Separator />

          <CheckboxGroup
            legend="Experience level"
            ariaLabel="Filter by experience level"
            options={experienceLevelSchema.options.map((option) => ({
              value: option,
              label: EXPERIENCE_LEVEL_LABELS[option] ?? option,
            }))}
            selected={value.experienceLevel}
            onToggle={(option) => toggle('experienceLevel', option)}
          />

          <Separator />

          <CheckboxGroup
            legend="Availability"
            ariaLabel="Filter by availability"
            options={availabilitySchema.options.map((option) => ({
              value: option,
              label: AVAILABILITY_LABELS[option],
            }))}
            selected={value.availability}
            onToggle={(option) => toggle('availability', option)}
          />

          <Separator />

          <CheckboxGroup
            legend="Work authorization"
            ariaLabel="Filter by work authorization"
            options={workAuthorizationSchema.options.map((option) => ({
              value: option,
              label: WORK_AUTHORIZATION_LABELS[option],
            }))}
            selected={value.workAuthorization}
            onToggle={(option) => toggle('workAuthorization', option)}
          />

          <Separator />

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-foreground">Location & experience</legend>

            <div className="space-y-1.5">
              <Label htmlFor="candidate-filter-location">Location</Label>
              <Input
                id="candidate-filter-location"
                value={value.location}
                onChange={(event) => onChange({ ...value, location: event.target.value })}
                placeholder="City, state or country"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="candidate-filter-min-exp">Min experience (months)</Label>
                <Input
                  id="candidate-filter-min-exp"
                  type="number"
                  min={0}
                  max={840}
                  value={value.minExperienceMonths}
                  onChange={(event) => onChange({ ...value, minExperienceMonths: event.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="candidate-filter-max-exp">Max experience (months)</Label>
                <Input
                  id="candidate-filter-max-exp"
                  type="number"
                  min={0}
                  max={840}
                  value={value.maxExperienceMonths}
                  onChange={(event) => onChange({ ...value, maxExperienceMonths: event.target.value })}
                  placeholder="840"
                />
              </div>
            </div>
          </fieldset>

          <Separator />

          <fieldset className="space-y-4">
            <legend className="text-sm font-medium text-foreground">Flags</legend>

            <SwitchRow
              id="candidate-filter-hot"
              label="Hot candidates only"
              description="Records marked as a priority to contact."
              checked={value.isHot}
              onCheckedChange={(checked) => onChange({ ...value, isHot: checked })}
            />

            <SwitchRow
              id="candidate-filter-resume"
              label="With a résumé"
              description="Only candidates that have at least one résumé on file."
              checked={value.hasResume}
              onCheckedChange={(checked) => onChange({ ...value, hasResume: checked })}
            />

            <SwitchRow
              id="candidate-filter-archived"
              label="Archived only"
              description="Show the archive instead of the active talent pool."
              checked={value.isArchived}
              onCheckedChange={(checked) => onChange({ ...value, isArchived: checked })}
            />
          </fieldset>
        </div>

        <SheetFooter className="border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
            className="sm:mr-auto"
            onClick={onReset}
            disabled={activeCount === 0}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Reset
          </Button>
          <SheetClose asChild>
            <Button type="button">Done</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

interface CheckboxGroupProps {
  legend: string;
  ariaLabel: string;
  options: readonly { value: string; label: string }[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}

function CheckboxGroup({ legend, ariaLabel, options, selected, onToggle }: CheckboxGroupProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      <div aria-label={ariaLabel} role="group" className="grid grid-cols-2 gap-2">
        {options.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
                checked ? 'border-primary/40 bg-primary/5 text-foreground' : 'border-border text-muted-foreground',
              )}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => onToggle(option.value)}
                aria-label={option.label}
              />
              <span className="truncate">{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

interface SwitchRowProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function SwitchRow({ id, label, description, checked, onCheckedChange }: SwitchRowProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}
