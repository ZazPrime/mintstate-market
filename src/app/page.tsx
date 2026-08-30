import Link from 'next/link';

import { GradeBadge } from '@/components/grade-badge';
import { MarketIndexChart } from '@/components/market-index-chart';
import { Sparkline } from '@/components/sparkline';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getArbitrageBoard,
  getBenchmarkSeries,
  getFairValueBoard,
  getIndexSeries,
  getMarketSummary,
} from '@/lib/data/market';
import { formatCurrency, formatDate, formatPercent } from '@/lib/format';
import type { CardAnalyticsRow } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function MoverRow({ row, metric }: { row: CardAnalyticsRow; metric: 'premium' | 'arbitrage' }) {
  const value = metric === 'premium' ? row.raw_premium_pct : row.grading_arbitrage_net;
  return (
    <Link
      href={`/cards/${row.card_id}`}
      className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-secondary/60"
    >
      <GradeBadge grade={row.investment_grade} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{row.card_name}</span>
        <span className="block truncate text-xs text-muted-foreground">{row.set_name}</span>
      </span>
      <Sparkline data={row.sparkline} width={72} height={26} />
      <span
        className={cn(
          'w-20 shrink-0 text-right tabular text-sm font-medium',
          (metric === 'premium' ? -(value ?? 0) : (value ?? 0)) >= 0
            ? 'text-emerald-400'
            : 'text-rose-400',
        )}
      >
        {metric === 'premium' ? formatPercent(value) : formatCurrency(value)}
      </span>
    </Link>
  );
}

export default async function HomePage() {
  const [summary, undervalued, arbitrage, index, benchmark] = await Promise.all([
    getMarketSummary(),
    getFairValueBoard({ filter: 'undervalued', limit: 8 }),
    getArbitrageBoard(8),
    getIndexSeries(),
    getBenchmarkSeries('SPX'),
  ]);

  const empty = summary.trackedCards === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Market overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {summary.asOf
            ? `Analytics refreshed ${formatDate(summary.asOf)}.`
            : 'Awaiting the first analytics refresh.'}
        </p>
      </div>

      {empty ? (
        <Card>
          <CardContent className="space-y-2 p-10 text-center text-sm text-muted-foreground">
            <p>No analytics data yet.</p>
            <p>
              Seed metadata with <code className="text-xs">npm run seed:metadata</code>, ingest
              prices with <code className="text-xs">npm run ingest:market</code>, then run{' '}
              <code className="text-xs">npm run analytics:refresh</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Tracked cards"
              value={summary.trackedCards.toLocaleString()}
              sublabel={`${summary.undervalued} below fair value`}
            />
            <StatCard
              label="Median premium"
              value={formatPercent(summary.medianPremium)}
              tone={(summary.medianPremium ?? 0) <= 0 ? 'positive' : 'negative'}
              sublabel="Market vs. fair value across the board"
            />
            <StatCard
              label="Best grading edge"
              value={formatCurrency(summary.topArbitrage)}
              tone="positive"
              sublabel="Expected net per submission"
            />
            <StatCard
              label="MSM 100"
              value={summary.indexLevel === null ? '—' : summary.indexLevel.toFixed(1)}
              tone={(summary.indexChange30d ?? 0) >= 0 ? 'positive' : 'negative'}
              sublabel={`${formatPercent(summary.indexChange30d)} over 30 days`}
            />
          </div>

          <Card className="border-border/70">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">MintState 100 vs. S&amp;P 500</CardTitle>
              <Link href="/market-index" className="text-xs text-primary hover:underline">
                Full index →
              </Link>
            </CardHeader>
            <CardContent>
              <MarketIndexChart index={index} benchmark={benchmark} />
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="border-border/70">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">Deepest discounts to fair value</CardTitle>
                <Link href="/fair-value" className="text-xs text-primary hover:underline">
                  Fair value engine →
                </Link>
              </CardHeader>
              <CardContent className="space-y-0.5">
                {undervalued.map((row) => (
                  <MoverRow key={row.card_id} row={row} metric="premium" />
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">Top grading arbitrage</CardTitle>
                <Link href="/arbitrage" className="text-xs text-primary hover:underline">
                  Calculator →
                </Link>
              </CardHeader>
              <CardContent className="space-y-0.5">
                {arbitrage.map((row) => (
                  <MoverRow key={row.card_id} row={row} metric="arbitrage" />
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
