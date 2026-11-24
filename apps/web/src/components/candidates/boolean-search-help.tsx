'use client';

import { HelpCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const EXAMPLES = [
  'java AND (spring OR microservices) NOT junior',
  '"product manager" AND fintech',
  'react AND node AND remote',
  '"data engineer" AND (spark OR airflow)',
] as const;

/**
 * Explains the boolean syntax the candidate search box accepts. The parser
 * behind it supports `AND`/`OR`/`NOT`, quoted phrases and parentheses — the
 * same syntax a recruiter expects from a job board.
 */
export function BooleanSearchHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Search syntax help"
          className="text-muted-foreground"
        >
          <HelpCircle className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Search syntax</p>
          <p className="text-xs text-muted-foreground">
            Combine keywords with operators to build precise queries across names, skills, titles
            and companies.
          </p>
        </div>

        <dl className="space-y-2 text-xs">
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-medium text-foreground">AND</dt>
            <dd className="text-muted-foreground">Both terms must appear.</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-medium text-foreground">OR</dt>
            <dd className="text-muted-foreground">Either term may appear.</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-medium text-foreground">NOT</dt>
            <dd className="text-muted-foreground">Excludes the following term or group.</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-medium text-foreground">&quot;quotes&quot;</dt>
            <dd className="text-muted-foreground">Matches an exact phrase, word for word.</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-medium text-foreground">( )</dt>
            <dd className="text-muted-foreground">Groups terms to control precedence.</dd>
          </div>
        </dl>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">Examples</p>
          <ul className="space-y-1">
            {EXAMPLES.map((example) => (
              <li
                key={example}
                className="rounded-md bg-muted px-2 py-1 font-mono text-2xs text-muted-foreground"
              >
                {example}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-2xs text-muted-foreground">
          Lower-case keywords are matched case-insensitively; adjacency behaves like an implicit
          AND.
        </p>
      </PopoverContent>
    </Popover>
  );
}
