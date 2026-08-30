import { Sparkline } from '@/components/sparkline';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatPercent } from '@/lib/format';
import type { SealedGapRow } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

const CONFIDENCE_TONE: Record<string, string> = {
  high: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  medium: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
  low: 'bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-500/30',
};

export const PRODUCT_LABEL: Record<string, string> = {
  booster_box: 'Booster box',
  elite_trainer_box: 'Elite trainer box',
  booster_bundle: 'Booster bundle',
  collection_case: 'Collection case',
  blister: 'Blister',
};

export function SealedGapTable({ rows }: { rows: SealedGapRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        No sealed valuations yet. Seed sealed products (<code className="text-xs">npm run
        seed:sealed</code>) and refresh analytics.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Product</TableHead>
          <TableHead className="text-right">Market</TableHead>
          <TableHead className="text-right" title="Expected singles value per pack">
            EV / pack
          </TableHead>
          <TableHead className="text-right" title="Expected pull value of the whole product">
            Pull EV
          </TableHead>
          <TableHead className="text-right" title="Pull EV after liquidation friction">
            Fair value
          </TableHead>
          <TableHead className="text-right" title="Market price vs. fair value">
            Gap
          </TableHead>
          <TableHead className="text-right">Confidence</TableHead>
          <TableHead className="w-[130px] text-right">Trend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const gap = row.gap_pct ?? 0;
          return (
            <TableRow key={row.product_id}>
              <TableCell>
                <span className="text-sm font-medium">{row.product_name}</span>
                <span className="block text-xs text-muted-foreground">
                  {PRODUCT_LABEL[row.product_type] ?? row.product_type} · {row.packs_per_product}{' '}
                  packs · {row.era}
                </span>
              </TableCell>
              <TableCell className="text-right tabular">{formatCurrency(row.market_price)}</TableCell>
              <TableCell className="text-right tabular text-muted-foreground">
                {formatCurrency(row.ev_per_pack)}
              </TableCell>
              <TableCell className="text-right tabular">{formatCurrency(row.pull_ev)}</TableCell>
              <TableCell className="text-right tabular">{formatCurrency(row.fair_value)}</TableCell>
              <TableCell
                className={cn(
                  'text-right font-medium tabular',
                  gap <= 0 ? 'text-emerald-400' : 'text-rose-400',
                )}
              >
                {formatPercent(row.gap_pct)}
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {gap <= 0 ? 'discount' : 'premium'}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <Badge
                  variant="outline"
                  className={cn('border-transparent', CONFIDENCE_TONE[row.confidence ?? 'low'])}
                >
                  {row.confidence ?? 'low'}
                </Badge>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {Math.round((row.priced_card_share ?? 0) * 100)}% priced
                </span>
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <Sparkline data={row.sparkline} positive={gap <= 0} />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
