import { MoversTable } from '@/components/movers-table';
import {
  FilterTabs,
  GRADE_OPTIONS,
  WINDOW_LABEL,
  WINDOW_OPTIONS,
  type FilterOption,
} from '@/components/filter-tabs';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getEras, getMovers, type MoverRank } from '@/lib/data/market';
import { formatCurrency, formatPercent } from '@/lib/format';
import type { TrackedGrade, WindowKey } from '@/lib/supabase/types';

export const revalidate = 900;

export const metadata = { title: 'Movers & Shakers' };

const WINDOWS: WindowKey[] = ['30d', '90d', '365d', 'all'];
const GRADES: TrackedGrade[] = ['RAW', 'PSA10'];
/** Bulk dominates a pure percent ranking, so the board starts at $25. */
const FLOORS = [0, 25, 100, 500];
const DEFAULT_FLOOR = 25;
const RANKS: MoverRank[] = ['pct', 'abs'];

const FLOOR_OPTIONS: FilterOption[] = [
  { value: '0', label: 'Any price' },
  { value: '25', label: '$25+' },
  { value: '100', label: '$100+' },
  { value: '500', label: '$500+' },
];

const RANK_OPTIONS: FilterOption[] = [
  { value: 'pct', label: '% move' },
  { value: 'abs', label: '$ move' },
];

export default async function MoversPage({
  searchParams,
}: {
  searchParams: {
    window?: string;
    grade?: string;
    era?: string;
    floor?: string;
    rank?: string;
  };
}) {
  const window = (WINDOWS.find((w) => w === searchParams.window) ?? '30d') as WindowKey;
  const grade = (GRADES.find((g) => g === searchParams.grade) ?? 'RAW') as TrackedGrade;
  const era = searchParams.era ?? 'all';
  const minPrice = FLOORS.find((f) => String(f) === searchParams.floor) ?? DEFAULT_FLOOR;
  const rank = (RANKS.find((r) => r === searchParams.rank) ?? 'pct') as MoverRank;
  const params = { window, grade, era, floor: String(minPrice), rank };

  const [risers, fallers, eras] = await Promise.all([
    getMovers({ window, grade, era, minPrice, rank, direction: 'risers', limit: 25 }),
    getMovers({ window, grade, era, minPrice, rank, direction: 'fallers', limit: 25 }),
    getEras(),
  ]);

  const eraOptions: FilterOption[] = [
    { value: 'all', label: 'All eras' },
    ...eras.map((value) => ({ value, label: value })),
  ];

  const universe = [...risers, ...fallers];
  const advancing = universe.filter((row) => (row.change_pct ?? 0) > 0).length;
  const totalSales = universe.reduce((sum, row) => sum + (row.sales_total ?? 0), 0);
  const windowLabel = WINDOW_LABEL[window];
  const emptyMessage =
    minPrice === 0
      ? 'No cards met the liquidity floor in this window.'
      : `No cards above ${formatCurrency(minPrice)} met the liquidity floor in this window.`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Movers &amp; Shakers</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Ranked price moves over the selected window, measured from the first to the last median
          clearing price observed in that window. Cards with fewer than five sales are excluded so a
          single stale listing cannot top the board, and a{' '}
          {minPrice === 0 ? 'price floor' : `${formatCurrency(minPrice)} price floor`} keeps bulk
          commons from outranking real chase cards on percentage alone.
          {minPrice === 0
            ? ' The floor is off, so sub-dollar cards can top the board on a few cents of movement.'
            : ''}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FilterTabs
          basePath="/movers"
          param="window"
          options={WINDOW_OPTIONS}
          active={window}
          params={params}
          label="Window"
        />
        <FilterTabs
          basePath="/movers"
          param="grade"
          options={GRADE_OPTIONS}
          active={grade}
          params={params}
          label="Slab"
        />
        <FilterTabs
          basePath="/movers"
          param="floor"
          options={FLOOR_OPTIONS}
          active={String(minPrice)}
          params={params}
          label="Floor"
          size="sm"
        />
        <FilterTabs
          basePath="/movers"
          param="rank"
          options={RANK_OPTIONS}
          active={rank}
          params={params}
          label="Rank by"
          size="sm"
        />
        <FilterTabs
          basePath="/movers"
          param="era"
          options={eraOptions}
          active={era}
          params={params}
          label="Era"
          size="sm"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Top gain"
          value={
            rank === 'abs'
              ? formatCurrency(risers[0]?.change_abs ?? null)
              : formatPercent(risers[0]?.change_pct ?? null)
          }
          sublabel={risers[0]?.card_name ?? 'No data'}
          tone="positive"
        />
        <StatCard
          label="Top drop"
          value={
            rank === 'abs'
              ? formatCurrency(fallers[0]?.change_abs ?? null)
              : formatPercent(fallers[0]?.change_pct ?? null)
          }
          sublabel={fallers[0]?.card_name ?? 'No data'}
          tone="negative"
        />
        <StatCard
          label="Advancing"
          value={`${advancing}/${universe.length}`}
          sublabel={`Of the extremes over ${windowLabel}`}
        />
        <StatCard
          label="Sales in window"
          value={totalSales.toLocaleString('en-US')}
          sublabel={`${grade === 'RAW' ? 'Raw' : 'PSA 10'} sold listings`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-emerald-400">
              Top risers · {windowLabel}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <MoversTable
              rows={risers}
              windowLabel={windowLabel}
              emptyMessage={emptyMessage}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-rose-400">
              Top fallers · {windowLabel}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <MoversTable
              rows={fallers}
              windowLabel={windowLabel}
              emptyMessage={emptyMessage}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
