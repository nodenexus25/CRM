import { Rocket } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shell/page-header';

interface PhasePlaceholderProps {
  title: string;
  description: string;
  /** Roadmap phase that delivers this screen. */
  phase: number;
  /** One-line description of what the phase adds. */
  summary: string;
  /** Concrete capabilities the screen will gain. */
  points: readonly string[];
  actions?: ReactNode;
}

/**
 * Route shell for a screen whose data model and API land in a later phase.
 *
 * These routes exist in Phase 1 so the navigation, command palette and
 * breadcrumbs never point at a 404 — they are honest about being planned
 * rather than showing invented numbers.
 */
export function PhasePlaceholder({
  title,
  description,
  phase,
  summary,
  points,
  actions,
}: PhasePlaceholderProps) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={[{ label: 'Workspace' }, { label: title }]}
        actions={actions}
      />

      <EmptyState
        icon={Rocket}
        title={`Planned for Phase ${phase}`}
        description={summary}
        action={
          <Badge variant="secondary" className="gap-1">
            Phase {phase}
          </Badge>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>What this screen will do</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {points.map((point) => (
              <li key={point} className="flex gap-2">
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
