import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCompact, formatCurrency } from '@/lib/format';
import type { ValuationDrivers } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

function Driver({
  label,
  value,
  detail,
  hint,
  tone,
  meter,
}: {
  label: string;
  value: string;
  detail: string;
  hint: string;
  tone?: 'positive' | 'negative';
  meter?: number;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-xl font-semibold tabular',
          tone === 'positive' && 'text-emerald-400',
          tone === 'negative' && 'text-rose-400',
        )}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{detail}</p>
      {meter !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.min(100, Math.max(0, meter))}%` }}
          />
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * Character equity view: decomposes the PSA 10 price into the four drivers we
 * can actually measure — cost to pull the card, what the character premium adds
 * over same-era/same-rarity peers, gem-rate economics and trade pace.
 */
export function ValuationBreakdown({ drivers }: { drivers: ValuationDrivers }) {
  const multiplier = drivers.character_multiplier;
  const gemRate = drivers.gem_rate;
  const pullCost = drivers.pull_cost;
  const psa10 = drivers.market_price_psa10;
  const pullEdge = pullCost !== null && psa10 !== null ? psa10 - pullCost : null;

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Character equity &amp; valuation drivers
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {drivers.character} · {drivers.era}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Driver
            label="Pull cost"
            value={formatCurrency(pullCost)}
            detail={
              drivers.packs_per_hit === null
                ? 'No pull-rate mapped for this rarity'
                : `${drivers.packs_per_hit.toFixed(0)} packs × ${formatCurrency(drivers.pack_price)}/pack`
            }
            hint={
              pullEdge === null
                ? 'Cost of opening packs until this card appears.'
                : `PSA 10 clears ${formatCurrency(pullEdge)} ${pullEdge >= 0 ? 'above' : 'below'} the cost of pulling it.`
            }
            tone={pullEdge === null ? undefined : pullEdge >= 0 ? 'positive' : 'negative'}
          />
          <Driver
            label="Character demand"
            value={multiplier === null ? '—' : `${multiplier.toFixed(2)}×`}
            detail={`vs. ${formatCurrency(drivers.peer_median_price)} peer median (${formatCompact(drivers.peer_count)} cards)`}
            hint={`How ${drivers.character} prices compare with same-era, same-rarity cards.`}
            tone={multiplier === null ? undefined : multiplier >= 1 ? 'positive' : 'negative'}
            meter={multiplier === null ? undefined : Math.min(100, multiplier * 50)}
          />
          <Driver
            label="Gem rate economics"
            value={gemRate === null ? '—' : `${(gemRate * 100).toFixed(1)}%`}
            detail={
              gemRate === null
                ? 'No population snapshot for a gem-adjusted value'
                : `Gem-adjusted value ${formatCurrency(drivers.gem_adjusted_value)}`
            }
            hint={`${formatCompact(drivers.pop_total)} graded; each raw submission is worth the PSA 10 price times the gem rate.`}
            meter={gemRate === null ? undefined : gemRate * 100}
          />
          <Driver
            label="Trade pace"
            value={
              drivers.trade_pace_score === null ? '—' : `${drivers.trade_pace_score.toFixed(0)}/100`
            }
            detail={`${formatCompact(drivers.sales_30d)} sales in 30 days`}
            hint="Percentile of 30-day sales velocity against other cards from the same era."
            meter={drivers.trade_pace_score ?? undefined}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          PSA 10 trades at{' '}
          {drivers.psa10_multiple === null ? '—' : `${drivers.psa10_multiple.toFixed(1)}×`} the raw
          price. Character median across {formatCompact(drivers.character_card_count)} printings is{' '}
          {formatCurrency(drivers.character_median_price)}.
        </p>
      </CardContent>
    </Card>
  );
}
