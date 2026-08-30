import { Card, CardContent } from '@/components/ui/card';
import { rangePosition } from '@/lib/analytics/card-intelligence';
import { formatCompact, formatCurrency, formatDate } from '@/lib/format';
import type { CardIntelligenceRow } from '@/lib/supabase/types';

/** 6-month price band, last sold comps and monthly sold volume. */
export function CardIntelligenceBar({ intel }: { intel: CardIntelligenceRow }) {
  const position =
    intel.range_position ?? rangePosition(intel.market_price_raw, intel.low_6m, intel.high_6m);
  const hasBand = intel.low_6m !== null && intel.high_6m !== null && position !== null;

  return (
    <Card className="border-border/70">
      <CardContent className="grid gap-5 p-4 lg:grid-cols-[2fr,1fr,1fr]">
        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              6-month range
            </p>
            <p className="text-xs text-muted-foreground">
              {hasBand ? `${Math.round((position ?? 0) * 100)}% of range` : 'Not enough history'}
            </p>
          </div>

          <div className="relative mt-4 h-1.5 rounded-full bg-secondary">
            {hasBand && (
              <>
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-500/40 to-emerald-500/60"
                  style={{ width: `${(position ?? 0) * 100}%` }}
                />
                <div
                  className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-emerald-400"
                  style={{ left: `${(position ?? 0) * 100}%` }}
                />
              </>
            )}
          </div>

          <div className="mt-2 flex items-baseline justify-between text-xs">
            <span className="tabular text-muted-foreground">{formatCurrency(intel.low_6m)}</span>
            <span className="tabular text-sm font-semibold">
              {formatCurrency(intel.market_price_raw)}
            </span>
            <span className="tabular text-muted-foreground">{formatCurrency(intel.high_6m)}</span>
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Last 3 sold comps
          </p>
          <p className="mt-1 text-xl font-semibold tabular">
            {formatCurrency(intel.last3_comp_avg)}
          </p>
          <p className="text-xs text-muted-foreground">
            {intel.last_sold_date ? `Latest ${formatDate(intel.last_sold_date)}` : 'No sold comps'}
          </p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Sold / month</p>
          <p className="mt-1 text-xl font-semibold tabular">{formatCompact(intel.sales_30d)}</p>
          <p className="text-xs text-muted-foreground">
            {intel.active_days_30d} of the last 30 days traded
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
