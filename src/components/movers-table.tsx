import Link from 'next/link';

import { Sparkline } from '@/components/sparkline';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCompact, formatCurrency, formatPercent } from '@/lib/format';
import type { MoverRow } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

/**
 * Ranked risers/fallers for one window. The sparkline is the window's own
 * series, so switching 30D → ALL rescales the trend line with the table.
 */
export function MoversTable({
  rows,
  windowLabel,
  emptyMessage,
}: {
  rows: MoverRow[];
  windowLabel: string;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-8 text-right">#</TableHead>
          <TableHead>Card</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right" title={`Price change over ${windowLabel}`}>
            Change
          </TableHead>
          <TableHead
            className="text-right"
            title={`Dollars gained or lost per card over ${windowLabel}`}
          >
            $ Move
          </TableHead>
          <TableHead className="text-right" title={`Sold listings over ${windowLabel}`}>
            Sales
          </TableHead>
          <TableHead className="text-right" title="Sales per day in the window">
            Velocity
          </TableHead>
          <TableHead className="w-[130px] text-right">Trend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, rank) => (
          <TableRow key={`${row.card_id}-${row.grade}`}>
            <TableCell className="text-right text-xs text-muted-foreground tabular">
              {rank + 1}
            </TableCell>
            <TableCell>
              <Link href={`/cards/${row.card_id}`} className="block hover:text-primary">
                <span className="text-sm font-medium">{row.card_name}</span>
                <span className="block text-xs text-muted-foreground">
                  {row.set_name} · #{row.card_number} · {row.era}
                </span>
              </Link>
            </TableCell>
            <TableCell className="text-right tabular">{formatCurrency(row.end_price)}</TableCell>
            <TableCell
              className={cn(
                'text-right font-medium tabular',
                (row.change_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400',
              )}
            >
              {formatPercent(row.change_pct)}
            </TableCell>
            <TableCell
              className={cn(
                'text-right tabular',
                (row.change_abs ?? 0) >= 0 ? 'text-emerald-400/80' : 'text-rose-400/80',
              )}
            >
              {row.change_abs === null
                ? '—'
                : `${row.change_abs >= 0 ? '+' : '\u2212'}${formatCurrency(Math.abs(row.change_abs))}`}
            </TableCell>
            <TableCell className="text-right tabular text-muted-foreground">
              {formatCompact(row.sales_total)}
            </TableCell>
            <TableCell className="text-right tabular text-muted-foreground">
              {row.velocity === null ? '—' : `${row.velocity.toFixed(2)}/d`}
            </TableCell>
            <TableCell>
              <div className="flex justify-end">
                <Sparkline data={row.sparkline} positive={(row.change_pct ?? 0) >= 0} />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
