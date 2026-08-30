import { Fragment } from 'react';

import { formatCurrency } from '@/lib/format';
import type { SetMonthlyCell } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const MONTH_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** Diverging ramp. Colour repeats the number in the cell, it never adds information. */
function tone(change: number | null): string {
  if (change === null) return 'bg-slate-900/40 text-slate-600';
  if (change >= 20) return 'bg-emerald-500/80 text-emerald-50';
  if (change >= 10) return 'bg-emerald-500/55 text-emerald-50';
  if (change >= 4) return 'bg-emerald-500/35 text-emerald-100';
  if (change > 0) return 'bg-emerald-500/15 text-emerald-200';
  if (change === 0) return 'bg-slate-600/25 text-slate-200';
  if (change > -4) return 'bg-rose-500/15 text-rose-200';
  if (change > -10) return 'bg-rose-500/35 text-rose-100';
  if (change > -20) return 'bg-rose-500/55 text-rose-50';
  return 'bg-rose-500/80 text-rose-50';
}

function monthLabel(month: string): string {
  return MONTH_LABEL.format(new Date(`${month.slice(0, 10)}T00:00:00Z`));
}

function isCurrentMonth(month: string): boolean {
  return month.slice(0, 7) === new Date().toISOString().slice(0, 7);
}

/** Unicode minus, so a falling month lines up with the digits above it. */
function formatChange(change: number): string {
  return `${change > 0 ? '+' : change < 0 ? '\u2212' : ''}${Math.abs(change).toFixed(1)}%`;
}

interface SetRow {
  setId: string;
  setName: string;
  era: string;
  releaseDate: string | null;
  cells: Map<string, SetMonthlyCell>;
}

function groupByEra(cells: SetMonthlyCell[]): Array<{ era: string; sets: SetRow[] }> {
  const bySet = new Map<string, SetRow>();
  for (const cell of cells) {
    let row = bySet.get(cell.set_id);
    if (!row) {
      row = {
        setId: cell.set_id,
        setName: cell.set_name,
        era: cell.era,
        releaseDate: cell.release_date,
        cells: new Map(),
      };
      bySet.set(cell.set_id, row);
    }
    row.cells.set(cell.month.slice(0, 10), cell);
  }

  const byEra = new Map<string, SetRow[]>();
  for (const row of bySet.values()) {
    const bucket = byEra.get(row.era);
    if (bucket) bucket.push(row);
    else byEra.set(row.era, [row]);
  }

  return Array.from(byEra.entries())
    .map(([era, sets]) => ({
      era,
      sets: sets.sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? '')),
    }))
    .sort((a, b) =>
      (b.sets.at(-1)?.releaseDate ?? '').localeCompare(a.sets.at(-1)?.releaseDate ?? ''),
    );
}

export function monthColumns(cells: SetMonthlyCell[]): string[] {
  return Array.from(new Set(cells.map((cell) => cell.month.slice(0, 10)))).sort();
}

export function MonthlyPerformanceTable({ cells }: { cells: SetMonthlyCell[] }) {
  const months = monthColumns(cells);
  const groups = groupByEra(cells);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Set
            </th>
            {months.map((month) => (
              <th
                key={month}
                className="whitespace-nowrap px-2 pb-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {isCurrentMonth(month) ? (
                  <span className="block text-[9px] text-primary">MTD</span>
                ) : null}
                <span className="block">
                  {MONTH_SHORT.format(new Date(`${month}T00:00:00Z`))}
                </span>
                <span className="block text-[10px] font-normal opacity-70">
                  {month.slice(0, 4)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.era}>
              <tr>
                <td
                  colSpan={months.length + 1}
                  className="sticky left-0 bg-secondary/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {group.era}
                </td>
              </tr>
              {group.sets.map((row) => (
                <tr key={row.setId} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-card px-3 py-1 text-left text-xs font-normal group-hover:bg-secondary/40"
                  >
                    {row.setName}
                  </th>
                  {months.map((month) => {
                    const cell = row.cells.get(month);
                    const change = cell?.change_pct ?? null;
                    return (
                      <td key={month} className="p-[2px]">
                        <div
                          title={
                            cell
                              ? `${row.setName} · ${monthLabel(month)} · ${cell.basket_size} tracked · avg ${formatCurrency(cell.avg_price)}`
                              : undefined
                          }
                          className={cn(
                            'rounded px-2 py-1 text-center text-[11px] tabular-nums',
                            tone(change),
                          )}
                        >
                          {change === null ? '—' : formatChange(change)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
