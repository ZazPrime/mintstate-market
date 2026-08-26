import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatPercent } from '@/lib/format';
import type { PackEvRow } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

export function PackEvTable({ rows }: { rows: PackEvRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        No sealed pack prices ingested yet. Run <code className="text-xs">npm run ingest:sealed</code>{' '}
        and refresh analytics.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-10">#</TableHead>
          <TableHead>Set</TableHead>
          <TableHead className="text-right">Pack price</TableHead>
          <TableHead className="text-right" title="Expected singles value per pack after liquidation friction">
            EV net
          </TableHead>
          <TableHead className="text-right">Per pack gap</TableHead>
          <TableHead className="text-right" title="Share of pack EV held by the three biggest chase cards">
            Top 3 chase
          </TableHead>
          <TableHead className="text-right">ROI</TableHead>
          <TableHead className="text-right">Gem rate</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, position) => {
          const roi = row.roi_pct ?? 0;
          return (
            <TableRow key={row.set_id}>
              <TableCell className="tabular text-xs text-muted-foreground">
                {position + 1}
              </TableCell>
              <TableCell>
                <span className="text-sm font-medium">{row.set_name}</span>
                <span className="block text-xs text-muted-foreground">
                  {row.chase_cards ?? 0} chase cards · {row.era}
                </span>
              </TableCell>
              <TableCell className="text-right tabular">{formatCurrency(row.pack_price)}</TableCell>
              <TableCell className="text-right tabular">{formatCurrency(row.ev_net)}</TableCell>
              <TableCell
                className={cn(
                  'text-right tabular',
                  (row.per_pack_gap ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400',
                )}
              >
                {formatCurrency(row.per_pack_gap)}
              </TableCell>
              <TableCell className="text-right tabular text-muted-foreground">
                {row.top3_chase_share === null
                  ? '—'
                  : `${(row.top3_chase_share * 100).toFixed(0)}%`}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right font-medium tabular',
                  roi >= 0 ? 'text-emerald-400' : 'text-rose-400',
                )}
              >
                {formatPercent(row.roi_pct)}
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {roi >= 0 ? 'gain' : 'loss'}
                </span>
              </TableCell>
              <TableCell className="text-right tabular text-muted-foreground">
                {row.gem_rate === null ? '—' : `${(row.gem_rate * 100).toFixed(1)}%`}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
