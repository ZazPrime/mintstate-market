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
import { getEras, getMovers } from '@/lib/data/market';
import { formatPercent } from '@/lib/format';
import type { TrackedGrade, WindowKey } from '@/lib/supabase/types';

export const revalidate = 900;

export const metadata = { title: 'Movers & Shakers' };

const WINDOWS: WindowKey[] = ['30d', '90d', '365d', 'all'];
const GRADES: TrackedGrade[] = ['RAW', 'PSA10'];

export default async function MoversPage({
  searchParams,
}: {
  searchParams: { window?: string; grade?: string; era?: string };
}) {
  const window = (WINDOWS.find((w) => w === searchParams.window) ?? '30d') as WindowKey;
  const grade = (GRADES.find((g) => g === searchParams.grade) ?? 'RAW') as TrackedGrade;
  const era = searchParams.era ?? 'all';
  const params = { window, grade, era };

  const [risers, fallers, eras] = await Promise.all([
    getMovers({ window, grade, era, direction: 'risers', limit: 25 }),
    getMovers({ window, grade, era, direction: 'fallers', limit: 25 }),
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Movers &amp; Shakers</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Ranked price moves over the selected window, measured from the first to the last median
          clearing price observed in that window. Cards with fewer than five sales in the window are
          excluded so a single stale listing cannot top the board.
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
          value={formatPercent(risers[0]?.change_pct ?? null)}
          sublabel={risers[0]?.card_name ?? 'No data'}
          tone="positive"
        />
        <StatCard
          label="Top drop"
          value={formatPercent(fallers[0]?.change_pct ?? null)}
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
              emptyMessage="No cards met the liquidity floor in this window."
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
              emptyMessage="No cards met the liquidity floor in this window."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
