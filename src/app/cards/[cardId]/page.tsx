import Image from 'next/image';
import { notFound } from 'next/navigation';

import { CardIntelligenceBar } from '@/components/card-intelligence-bar';
import { CardPriceChart } from '@/components/card-price-chart';
import { FilterTabs, WINDOW_LABEL, WINDOW_OPTIONS } from '@/components/filter-tabs';
import { GradeBadge } from '@/components/grade-badge';
import { GradeDistribution } from '@/components/grade-distribution';
import { InvestmentScoreWidget } from '@/components/investment-score';
import { PopulationChart } from '@/components/population-chart';
import { StatCard } from '@/components/stat-card';
import { SupplyDemandRadar } from '@/components/supply-demand-radar';
import { ValuationBreakdown } from '@/components/valuation-breakdown';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { dailyVolume, gradingEdge } from '@/lib/analytics/card-intelligence';
import {
  getCardAnalytics,
  getCardIntelligence,
  getCardPopulation,
  getCardPriceHistory,
  getGradeDistribution,
  getValuationDrivers,
} from '@/lib/data/market';
import { formatCompact, formatCurrency, formatDate, formatPercent } from '@/lib/format';
import type { WindowKey } from '@/lib/supabase/types';

export const revalidate = 900;

const WINDOWS: WindowKey[] = ['30d', '90d', '365d', 'all'];

/** Days of history to load per selected window; ALL spans a decade of data. */
const WINDOW_DAYS: Record<WindowKey, number> = {
  '30d': 30,
  '90d': 90,
  '365d': 365,
  all: 3650,
};

export async function generateMetadata({ params }: { params: { cardId: string } }) {
  const analytics = await getCardAnalytics(params.cardId);
  return { title: analytics ? `${analytics.card_name} — Card Intelligence` : 'Card Intelligence' };
}

export default async function CardPage({
  params,
  searchParams,
}: {
  params: { cardId: string };
  searchParams: { window?: string };
}) {
  const window = (WINDOWS.find((w) => w === searchParams.window) ?? '90d') as WindowKey;

  const [analytics, history, recent, population, drivers, intel, distribution] = await Promise.all([
    getCardAnalytics(params.cardId),
    getCardPriceHistory(params.cardId, WINDOW_DAYS[window]),
    getCardPriceHistory(params.cardId, 30),
    getCardPopulation(params.cardId),
    getValuationDrivers(params.cardId),
    getCardIntelligence(params.cardId),
    getGradeDistribution(params.cardId),
  ]);

  if (!analytics) notFound();

  const image = analytics.images?.large ?? analytics.images?.small;
  const latestPop = population.at(-1);
  const edge = intel
    ? gradingEdge({
        raw: intel.market_price_raw,
        psa10: intel.psa10_price,
        gemRate: intel.gem_rate,
      })
    : null;
  const volume = dailyVolume(recent);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 lg:flex-row">
        {image && (
          <div className="relative h-[340px] w-[244px] shrink-0 overflow-hidden rounded-xl border border-border bg-card">
            <Image
              src={image}
              alt={analytics.card_name}
              fill
              sizes="244px"
              className="object-contain p-2"
              unoptimized
            />
          </div>
        )}

        <div className="flex-1 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{analytics.card_name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>
                  {analytics.set_name} · #{analytics.card_number}
                </span>
                {analytics.rarity && <Badge variant="outline">{analytics.rarity}</Badge>}
                <Badge variant="secondary">{analytics.language.toUpperCase()}</Badge>
                {analytics.release_date && <span>Released {formatDate(analytics.release_date)}</span>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Demand durability
                </p>
                <p className="text-xs text-muted-foreground">S+ to F</p>
              </div>
              <GradeBadge grade={analytics.investment_grade} size="lg" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Raw market"
              value={formatCurrency(analytics.market_price_raw)}
              sublabel={`Fair value ${formatCurrency(analytics.fair_value_raw)}`}
            />
            <StatCard
              label="Raw premium"
              value={formatPercent(analytics.raw_premium_pct)}
              tone={(analytics.raw_premium_pct ?? 0) <= 0 ? 'positive' : 'negative'}
              sublabel={(analytics.raw_premium_pct ?? 0) <= 0 ? 'Trading at a discount' : 'Trading rich'}
            />
            <StatCard
              label="PSA 10 market"
              value={formatCurrency(analytics.market_price_psa10)}
              sublabel={`Fair value ${formatCurrency(analytics.fair_value_psa10)}`}
            />
            <StatCard
              label="Grading edge"
              value={formatCurrency(analytics.grading_arbitrage_net)}
              tone={(analytics.grading_arbitrage_net ?? 0) >= 0 ? 'positive' : 'negative'}
              sublabel="Expected net of fees at observed gem rate"
            />
          </div>

        </div>
      </div>

      {intel && <CardIntelligenceBar intel={intel} />}

      {intel && (
        <div className="grid gap-5 xl:grid-cols-[1fr,2fr]">
          <InvestmentScoreWidget
            intel={intel}
            window={window}
            gradingEdgeRoi={edge?.roi ?? null}
          />
          <SupplyDemandRadar intel={intel} volume={volume} />
        </div>
      )}

      {intel && <GradeDistribution intel={intel} distribution={distribution} />}

      {drivers && <ValuationBreakdown drivers={drivers} />}

      <div className="grid gap-5 xl:grid-cols-[3fr,2fr]">
        <Card className="border-border/70">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-2">
            <CardTitle className="text-base">
              Clearing prices &amp; volume
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {WINDOW_LABEL[window]}
              </span>
            </CardTitle>
            <FilterTabs
              basePath={`/cards/${params.cardId}`}
              param="window"
              options={WINDOW_OPTIONS}
              active={window}
              params={{ window }}
              size="sm"
            />
          </CardHeader>
          <CardContent>
            <CardPriceChart history={history} />
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">PSA population</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
                <p className="tabular font-medium">{formatCompact(latestPop?.total_graded ?? null)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">PSA 10</p>
                <p className="tabular font-medium">{formatCompact(latestPop?.gem_count ?? null)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Gem rate</p>
                <p className="tabular font-medium">
                  {latestPop?.gem_rate == null ? '—' : `${(latestPop.gem_rate * 100).toFixed(1)}%`}
                </p>
              </div>
            </div>
            <PopulationChart points={population} />
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Analytics as of {analytics.as_of_date ? formatDate(analytics.as_of_date) : '—'} · 30-day
        momentum {formatPercent(analytics.momentum_30d)} · 90-day volatility{' '}
        {formatPercent(analytics.volatility_90d)} · {formatCompact(analytics.sales_30d)} sales in the
        last 30 days.
      </p>
    </div>
  );
}
