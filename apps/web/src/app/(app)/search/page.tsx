import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SearchResults } from '@/components/search/search-results';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = { title: 'Search' };

/**
 * Wrapped in `Suspense` because `SearchResults` reads `useSearchParams`, which
 * Next requires to sit below a boundary during prerendering.
 */
export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-5xl space-y-6" aria-busy="true">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <SearchResults />
    </Suspense>
  );
}
