import Image from 'next/image';
import { notFound } from 'next/navigation';

import { CardPriceChart } from '@/components/card-price-chart';
import { GradeBadge } from '@/components/grade-badge';
import { PopulationChart } from '@/components/population-chart';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getCardAnalytics,
  getCardPopulation,
  getCardPriceHistory,
} from '@/lib/data/market';
import { formatCompact, formatCurrency, formatDate, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

export const revalidate = 900;

const SCORES: Array<{ key: 'demand_score' | 'liquidity_score' | 'scarcity_score'; label: string; hint: string }> = [
  { key: 'demand_score', label: 'Demand', hint: 'Sales velocity and price appreciation' },
  { key: 'liquidity_score', label: 'Liquidity', hint: 'Depth and consistency of the sold-listing flow' },
  { key: 'scarcity_score', label: 'Scarcity', hint: 'Graded population relative to comparable cards' },
];

export async function generateMetadata({ params }: { params: { cardId: string } }) {
  const analytics = await getCardAnalytics(params.cardId);
  return { title: analytics ? `${analytics.card_name} — Card Intelligence` : 'Card Intelligence' };
}

export default async function CardPage({ params }: { params: { cardId: string } }) {
  const [analytics, history, population] = await Promise.all([
    getCardAnalytics(params.cardId),
    getCardPriceHistory(params.cardId, 180),
    getCardPopulation(params.cardId),
  ]);

  if (!analytics) notFound();

  const image = analytics.images?.large ?? analytics.images?.small;
  const latestPop = population.at(-1);

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
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {analytics.set_name} · #{analytics.card_number}
                {analytics.rarity && <Badge variant="outline">{analytics.rarity}</Badge>}
                <Badge variant="secondary">{analytics.language.toUpperCase()}</Badge>
                {analytics.release_date && <span>Released {formatDate(analytics.release_date)}</span>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Demand durability
                </p>
                <p className="text-xs text-muted-foreground">
                  Composite {analytics.composite_score?.toFixed(0) ?? '—'}/100
                </p>
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

          <div className="grid gap-3 sm:grid-cols-3">
            {SCORES.map((score) => {
              const value = analytics[score.key] ?? 0;
              return (
                <div key={score.key} className="rounded-lg border border-border/70 bg-card/60 p-3">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {score.label}
                    </p>
                    <p className="tabular text-sm font-medium">{value.toFixed(0)}</p>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        value >= 66 ? 'bg-emerald-400' : value >= 33 ? 'bg-amber-400' : 'bg-rose-400',
                      )}
                      style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{score.hint}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[3fr,2fr]">
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Clearing prices &amp; volume</CardTitle>
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
