import { FilterTabs, type FilterOption } from '@/components/filter-tabs';
import { PackEvTable } from '@/components/pack-ev-table';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent } from '@/components/ui/card';
import { getPackEvBoard, type PackEvSort } from '@/lib/data/market';
import { formatCurrency, formatPercent } from '@/lib/format';

export const revalidate = 900;

export const metadata = { title: 'Pack & Sealed EV Board' };

const SORT_OPTIONS: FilterOption[] = [
  { value: 'roi', label: 'Best ROI' },
  { value: 'ev', label: 'Highest EV' },
  { value: 'pack_price', label: 'Pack price' },
];

const SORTS: PackEvSort[] = ['roi', 'ev', 'pack_price'];

export default async function SealedEvPage({
  searchParams,
}: {
  searchParams: { sort?: string };
}) {
  const sort = SORTS.find((option) => option === searchParams.sort) ?? 'roi';
  const rows = await getPackEvBoard(sort);

  const best = rows.reduce<number | null>(
    (max, row) => (row.roi_pct !== null && (max === null || row.roi_pct > max) ? row.roi_pct : max),
    null,
  );
  const cheapest = rows.reduce<number | null>(
    (min, row) =>
      row.pack_price !== null && (min === null || row.pack_price < min) ? row.pack_price : min,
    null,
  );
  const profitable = rows.filter((row) => (row.per_pack_gap ?? 0) > 0).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pack &amp; Sealed EV Board</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Pack price is the cheapest per-pack cost across a set&apos;s sealed formats. EV net is the
          expected singles value of one pack after liquidation friction, built from live card prices
          and published pull rates. Per-pack gap and ROI compare the two, and Top 3 chase shows how
          much of the EV is concentrated in the set&apos;s three biggest hits — a high share means
          the average pack is worth far less than the EV suggests.
        </p>
      </div>

      <FilterTabs
        basePath="/sealed-ev"
        param="sort"
        options={SORT_OPTIONS}
        active={sort}
        params={{ sort }}
        label="Rank by"
        size="sm"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Sets tracked"
          value={rows.length.toLocaleString('en-US')}
          sublabel={`${profitable} with a positive per-pack gap`}
        />
        <StatCard
          label="Best ROI"
          value={formatPercent(best)}
          sublabel="EV net vs. pack price"
          tone={(best ?? 0) >= 0 ? 'positive' : 'negative'}
        />
        <StatCard
          label="Cheapest pack"
          value={formatCurrency(cheapest)}
          sublabel="Lowest per-pack cost tracked"
        />
      </div>

      <Card>
        <CardContent className="px-0 py-2">
          <PackEvTable rows={rows} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        EV counts base printings only — parallel and pattern variants are not priced separately, so
        chase-heavy sets read poorer than they trade. Gem rate needs PSA population data, which the
        pricing feed does not include.
      </p>
    </div>
  );
}
