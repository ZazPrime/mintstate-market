import { FilterTabs, type FilterOption } from '@/components/filter-tabs';
import { MonthlyPerformanceTable, monthColumns } from '@/components/monthly-performance';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getEras, getMonthlyPerformance } from '@/lib/data/market';
import type { MonthlyBasket, MonthlySeriesKey } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Monthly Performance Heatmap' };

const SERIES: MonthlySeriesKey[] = ['RAW', 'PSA10', 'SEALED'];
const BASKETS: MonthlyBasket[] = [0, 5, 10, 20];

const SERIES_OPTIONS: FilterOption[] = [
  { value: 'RAW', label: 'Raw' },
  { value: 'PSA10', label: 'PSA 10' },
  { value: 'SEALED', label: 'Sealed' },
];

const BASKET_OPTIONS: FilterOption[] = [
  { value: '0', label: 'All cards' },
  { value: '5', label: 'Top 5' },
  { value: '10', label: 'Top 10' },
  { value: '20', label: 'Top 20' },
];

const SERIES_BLURB: Record<MonthlySeriesKey, string> = {
  RAW: 'raw near-mint singles',
  PSA10: 'PSA 10 sold comps',
  SEALED: 'sealed product prices',
};

export default async function MarketHeatmapPage({
  searchParams,
}: {
  searchParams: { series?: string; basket?: string; era?: string };
}) {
  const series = SERIES.find((value) => value === searchParams.series) ?? 'RAW';
  const basket =
    BASKETS.find((value) => String(value) === searchParams.basket) ?? (0 as MonthlyBasket);
  const era = searchParams.era ?? 'all';
  const params = { series, basket: String(basket), era };

  const [cells, eras] = await Promise.all([
    getMonthlyPerformance({ series, basket, era }),
    getEras(),
  ]);

  const months = monthColumns(cells);
  const sets = new Set(cells.map((cell) => cell.set_id)).size;

  const eraOptions: FilterOption[] = [
    { value: 'all', label: 'All eras' },
    ...eras.map((value) => ({ value, label: value })),
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monthly performance</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Every tracked set&apos;s chase-card index and sealed price, month over month, showing
          which sets ran and which cooled. Descriptive of the past, not a forecast.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <Stat label="Sets" value={sets} />
        <Stat label="Months" value={months.length} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FilterTabs
          basePath="/market-heatmap"
          param="series"
          options={SERIES_OPTIONS}
          active={series}
          params={params}
          label="Series"
        />
        <FilterTabs
          basePath="/market-heatmap"
          param="basket"
          options={BASKET_OPTIONS}
          active={String(basket)}
          params={params}
          label="Basket"
          size="sm"
        />
        <FilterTabs
          basePath="/market-heatmap"
          param="era"
          options={eraOptions}
          active={era}
          params={params}
          label="Era"
          size="sm"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Monthly performance · each set&apos;s index
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Month-over-month change in each set&apos;s index on {SERIES_BLURB[series]}, by set and
            month. Colour repeats the number in each cell and carries nothing on its own. A month
            is only compared against members priced in both months, so a card entering or leaving
            coverage never reads as a move.
          </p>
        </CardHeader>
        <CardContent>
          {cells.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No monthly history for this series yet. Run the ingestion sweep and refresh
              analytics.
            </p>
          ) : (
            <MonthlyPerformanceTable cells={cells} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
