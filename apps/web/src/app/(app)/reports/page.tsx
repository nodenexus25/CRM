import type { Metadata } from 'next';

import { PhasePlaceholder } from '@/components/shell/phase-placeholder';

export const metadata: Metadata = { title: 'Reports' };

export default function ReportsPage() {
  return (
    <PhasePlaceholder
      title="Reports"
      description="Pipeline, activity, client and recruiter performance analytics."
      phase={4}
      summary="Reports arrive with the dashboards phase, once there is job, submission and placement data to chart."
      points={[
        'Recruiter scorecards: submissions, interviews, placements and time-to-fill.',
        'Pipeline funnel by job, client and stage, with conversion between stages.',
        'Client and account-manager revenue reporting filtered by the visibility scope you hold.',
        'Scheduled exports — CSV and XLSX — delivered by email on a recurring cadence.',
      ]}
    />
  );
}
