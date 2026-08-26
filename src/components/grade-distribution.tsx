import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  GRADING_FEE,
  gradeBuckets,
  gradeLadderStep,
  gradingEdge,
} from '@/lib/analytics/card-intelligence';
import { formatCompact, formatCurrency, formatPercent } from '@/lib/format';
import type { CardIntelligenceRow, GradeDistributionRow } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

/**
 * PSA population histogram, the 9-to-10 pricing step and the expected value of
 * submitting a raw copy for grading.
 */
export function GradeDistribution({
  intel,
  distribution,
}: {
  intel: CardIntelligenceRow;
  distribution: GradeDistributionRow | null;
}) {
  const buckets = gradeBuckets(distribution);
  const ladder = intel.grade_ladder_step ?? gradeLadderStep(intel.psa9_price, intel.psa10_price);
  const edge = gradingEdge({
    raw: intel.market_price_raw,
    psa10: intel.psa10_price,
    gemRate: intel.gem_rate,
  });

  return (
    <Card className="border-border/70">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-2">
        <CardTitle className="text-base">Grading analytics</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            Gem rate{' '}
            {distribution?.gem_rate == null
              ? '—'
              : `${(distribution.gem_rate * 100).toFixed(1)}%`}
          </Badge>
          <Badge variant="outline">
            Total graded {formatCompact(distribution?.total_graded ?? null)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {buckets.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
            No PSA population snapshot for this card yet — run the population worker
            (<code className="text-xs">npm run ingest:population</code>) to fill the grade matrix.
          </p>
        ) : (
          <div className="space-y-2">
            {buckets.map((bucket) => (
              <div key={bucket.label} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">{bucket.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      bucket.label === 'PSA 10' ? 'bg-emerald-400' : 'bg-sky-500/70',
                    )}
                    style={{ width: `${bucket.share * 100}%` }}
                  />
                </div>
                <span className="tabular w-16 shrink-0 text-right text-xs">
                  {formatCompact(bucket.count)}
                </span>
                <span className="tabular w-12 shrink-0 text-right text-xs text-muted-foreground">
                  {(bucket.share * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-card/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">9-to-10 step</p>
            <p className="tabular mt-1 text-xl font-semibold">
              {ladder === null ? '—' : `${ladder.toFixed(2)}×`}
            </p>
            <p className="text-xs text-muted-foreground">
              PSA 10 {formatCurrency(intel.psa10_price)} vs. PSA 9{' '}
              {formatCurrency(intel.psa9_price)}
            </p>
          </div>

          <div className="rounded-lg border border-border/70 bg-card/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Grading edge</p>
            <p
              className={cn(
                'tabular mt-1 text-xl font-semibold',
                (edge?.net ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400',
              )}
            >
              {edge === null ? '—' : formatCurrency(edge.net)}
            </p>
            <p className="text-xs text-muted-foreground">
              {edge === null
                ? 'Needs a raw and a PSA 10 comp'
                : `(PSA 10 × ${(edge.gemRate * 100).toFixed(0)}% gem rate) − raw − $${GRADING_FEE} fee${
                    edge.assumedGemRate ? ' · assumed gem rate' : ''
                  }`}
            </p>
          </div>

          <div className="rounded-lg border border-border/70 bg-card/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Upside</p>
            <p
              className={cn(
                'tabular mt-1 text-xl font-semibold',
                (edge?.upsideRoi ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400',
              )}
            >
              {edge === null ? '—' : formatPercent(edge.upsideRoi)}
            </p>
            <p className="text-xs text-muted-foreground">
              Return if the submission comes back a PSA 10
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
