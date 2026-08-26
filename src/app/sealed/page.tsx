import { FilterTabs, type FilterOption } from '@/components/filter-tabs';
import { SealedGapTable } from '@/components/sealed-gap-table';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent } from '@/components/ui/card';
import { getSealedGaps, type SealedQuery } from '@/lib/data/market';
import { formatCurrency, formatPercent } from '@/lib/format';

export const revalidate = 900;

export const metadata = { title: 'Sealed Value Gap' };

const PRODUCT_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All products' },
  { value: 'booster_box', label: 'Booster boxes' },
  { value: 'elite_trainer_box', label: 'ETBs' },
  { value: 'booster_bundle', label: 'Bundles' },
  { value: 'collection_case', label: 'Cases' },
];

const SORT_OPTIONS: FilterOption[] = [
  { value: 'discount', label: 'Biggest discount' },
  { value: 'premium', label: 'Biggest premium' },
  { value: 'value', label: 'Highest pull EV' },
];

type SortKey = NonNullable<SealedQuery['sort']>;
const SORTS: SortKey[] = ['discount', 'premium', 'value'];

export default async function SealedPage({
  searchParams,
}: {
  searchParams: { type?: string; sort?: string };
}) {
  const productType = PRODUCT_OPTIONS.some((o) => o.value === searchParams.type)
    ? (searchParams.type as string)
    : 'all';
  const sort = (SORTS.find((s) => s === searchParams.sort) ?? 'discount') as SortKey;

  const rows = await getSealedGaps({ productType, sort, limit: 120 });
  const discounted = rows.filter((row) => (row.gap_pct ?? 0) < 0);
  const deepest = rows.reduce<number | null>(
    (min, row) => (row.gap_pct !== null && (min === null || row.gap_pct < min) ? row.gap_pct : min),
    null,
  );
  const trackedValue = rows.reduce((sum, row) => sum + (row.market_price ?? 0), 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sealed Value Gap</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Pull EV is the expected singles value of a product: for every chase rarity we take the
          current market price of that set&apos;s cards and divide by the published packs-per-hit
          rate, then multiply by the pack count. Fair value discounts that EV for liquidation
          friction (fees, shipping, time to sell). A negative gap means the sealed product is
          trading below the cards inside it. Confidence reflects how much of the set is priced.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FilterTabs
          basePath="/sealed"
          param="type"
          options={PRODUCT_OPTIONS}
          active={productType}
          params={{ type: productType, sort }}
          label="Product"
          size="sm"
        />
        <FilterTabs
          basePath="/sealed"
          param="sort"
          options={SORT_OPTIONS}
          active={sort}
          params={{ type: productType, sort }}
          label="Rank by"
          size="sm"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Products tracked"
          value={rows.length.toLocaleString('en-US')}
          sublabel={`${discounted.length} trading below fair value`}
        />
        <StatCard
          label={deepest !== null && deepest >= 0 ? 'Smallest premium' : 'Deepest discount'}
          value={formatPercent(deepest)}
          sublabel="Market vs. fair value"
          tone={deepest !== null && deepest >= 0 ? 'negative' : 'positive'}
        />
        <StatCard
          label="Market value tracked"
          value={formatCurrency(trackedValue, 0)}
          sublabel="Sum of latest sealed clearing prices"
        />
      </div>

      <Card>
        <CardContent className="px-0 py-2">
          <SealedGapTable rows={rows} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Sealed market prices come from the PokemonPriceTracker feed; pull EV is computed from the
        ingested card prices and rarity pull rates.
      </p>
    </div>
  );
}
