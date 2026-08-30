import { DemandGrid, DemandMatrix } from '@/components/demand-heatmap';
import {
  FilterTabs,
  GRADE_OPTIONS,
  WINDOW_LABEL,
  WINDOW_OPTIONS,
  type FilterOption,
} from '@/components/filter-tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDemandGrid, getEras } from '@/lib/data/market';
import type { TrackedGrade, WindowKey } from '@/lib/supabase/types';

export const revalidate = 900;

export const metadata = { title: 'Demand Heatmap' };

const WINDOWS: WindowKey[] = ['30d', '90d', '365d', 'all'];
const GRADES: TrackedGrade[] = ['RAW', 'PSA10'];

export default async function HeatmapPage({
  searchParams,
}: {
  searchParams: { window?: string; grade?: string; era?: string };
}) {
  const window = (WINDOWS.find((w) => w === searchParams.window) ?? '30d') as WindowKey;
  const grade = (GRADES.find((g) => g === searchParams.grade) ?? 'RAW') as TrackedGrade;
  const era = searchParams.era ?? 'all';
  const params = { window, grade, era };

  const [cells, eras] = await Promise.all([
    getDemandGrid({ window, grade, era, limit: 240 }),
    getEras(),
  ]);

  const eraOptions: FilterOption[] = [
    { value: 'all', label: 'All eras' },
    ...eras.map((value) => ({ value, label: value })),
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Demand Heatmap</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Persistence tiers describe how durable a card&apos;s liquidity is — what share of days it
          actually trades and for how long it has been doing so. Trajectory compares the last 30
          days of sales velocity against the trailing year, so an accelerating card is trading
          faster now than it historically has.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FilterTabs
          basePath="/heatmap"
          param="window"
          options={WINDOW_OPTIONS}
          active={window}
          params={params}
          label="Window"
        />
        <FilterTabs
          basePath="/heatmap"
          param="grade"
          options={GRADE_OPTIONS}
          active={grade}
          params={params}
          label="Slab"
        />
        <FilterTabs
          basePath="/heatmap"
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
          <CardTitle className="text-sm font-medium">Persistence × trajectory density</CardTitle>
        </CardHeader>
        <CardContent>
          <DemandMatrix cells={cells} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Card demand grid · {WINDOW_LABEL[window]}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cells.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No demand profiles yet. Run the ingestion pipeline and refresh analytics.
            </p>
          ) : (
            <DemandGrid cells={cells} window={window} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
