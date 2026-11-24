'use client';

import { BulkOperationsHistory } from '@/components/bulk-operations/bulk-operations-history';
import { PageHeader } from '@/components/shell/page-header';

export default function BulkOperationsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title="Bulk operations"
        description="Every bulk action run in this workspace — progress, results and generated exports. Operations keep running if you leave this page."
      />
      <BulkOperationsHistory />
    </div>
  );
}
