import Link from 'next/link';

import { FairValueTable } from '@/components/fair-value-table';
import { Card, CardContent } from '@/components/ui/card';
import { getFairValueBoard, type ValuationFilter } from '@/lib/data/market';
import { cn } from '@/lib/utils';

export const revalidate = 900;

export const metadata = { title: 'Fair Value Engine' };

const FILTERS: Array<{ value: ValuationFilter; label: string }> = [
  { value: 'undervalued', label: 'Trading below fair value' },
  { value: 'overvalued', label: 'Trading above fair value' },
  { value: 'all', label: 'All tracked cards' },
];

export default async function FairValuePage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  const filter = (FILTERS.find((f) => f.value === searchParams.filter)?.value ??
    'undervalued') as ValuationFilter;
  const rows = await getFairValueBoard({ filter, limit: 200 });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fair Value Engine</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Fair value is a recency-weighted blend of the trailing 7, 30 and 90 day median clearing
          prices (50/35/15), so a single outlier sale cannot move the anchor. Premium is the gap
          between the latest clearing price and that anchor — negative means the card is trading at
          a discount.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <Link
            key={option.value}
            href={`/fair-value?filter=${option.value}`}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors',
              filter === option.value
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No analytics rows yet. Run the ingestion pipeline
            (<code className="text-xs">npm run ingest:prices &amp;&amp; npm run analytics:refresh</code>)
            to populate this table.
          </CardContent>
        </Card>
      ) : (
        <FairValueTable rows={rows} />
      )}
    </div>
  );
}
