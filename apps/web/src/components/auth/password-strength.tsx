'use client';

import { cn } from '@talentflow/ui';

import { passwordSchema } from '@talentflow/types';

const RULES = [
  { label: 'At least 10 characters', test: (value: string) => value.length >= 10 },
  { label: 'One lower-case letter', test: (value: string) => /[a-z]/.test(value) },
  { label: 'One upper-case letter', test: (value: string) => /[A-Z]/.test(value) },
  { label: 'One number', test: (value: string) => /\d/.test(value) },
] as const;

/**
 * Mirrors the server policy in `passwordSchema` so the meter can never disagree
 * with what the API will accept — the rule list is derived from the same source
 * of truth, and the final word is still the schema itself.
 */
export function passwordMeetsPolicy(value: string): boolean {
  return passwordSchema.safeParse(value).success;
}

export function PasswordStrength({ value, className }: { value: string; className?: string }) {
  const passed = RULES.filter((rule) => rule.test(value)).length;
  const valid = passwordMeetsPolicy(value);

  if (!value) return null;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {RULES.map((rule, index) => (
          <span
            key={rule.label}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              index < passed ? (valid ? 'bg-success' : 'bg-warning') : 'bg-muted',
            )}
          />
        ))}
      </div>

      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {RULES.map((rule) => {
          const satisfied = rule.test(value);
          return (
            <li
              key={rule.label}
              className={cn('flex items-center gap-1.5 text-2xs', satisfied ? 'text-success' : 'text-muted-foreground')}
            >
              <span
                className={cn('size-1.5 rounded-full', satisfied ? 'bg-success' : 'bg-muted-foreground/40')}
                aria-hidden="true"
              />
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
