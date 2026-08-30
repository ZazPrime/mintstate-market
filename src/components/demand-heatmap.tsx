import Link from 'next/link';

import { formatCompact, formatCurrency, formatPercent } from '@/lib/format';
import type { DemandCell, PersistenceTier, Trajectory, WindowKey } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

export const TIERS: PersistenceTier[] = ['Core', 'Mainstay', 'Emerging', 'Recurring'];
export const TRAJECTORIES: Trajectory[] = ['Accelerating', 'Steady', 'Cooling', 'Dormant'];

const TIER_BLURB: Record<PersistenceTier, string> = {
  Core: 'Trades nearly every day across a full year of history',
  Mainstay: 'Consistent long-run liquidity with occasional quiet stretches',
  Emerging: 'Short history but already trading heavily',
  Recurring: 'Trades in bursts — thin, episodic liquidity',
};

/** Tailwind density ramp keyed off the change over the selected window. */
function changeTone(change: number | null): string {
  if (change === null) return 'bg-slate-800/60 text-slate-400 ring-slate-700/50';
  if (change >= 0.25) return 'bg-emerald-500/70 text-emerald-50 ring-emerald-400/40';
  if (change >= 0.1) return 'bg-emerald-500/45 text-emerald-50 ring-emerald-400/30';
  if (change >= 0.02) return 'bg-emerald-500/25 text-emerald-100 ring-emerald-400/20';
  if (change > -0.02) return 'bg-slate-600/30 text-slate-200 ring-slate-500/20';
  if (change > -0.1) return 'bg-rose-500/25 text-rose-100 ring-rose-400/20';
  if (change > -0.25) return 'bg-rose-500/45 text-rose-50 ring-rose-400/30';
  return 'bg-rose-500/70 text-rose-50 ring-rose-400/40';
}

function densityTone(share: number): string {
  if (share <= 0) return 'bg-slate-800/50 text-slate-500';
  if (share < 0.05) return 'bg-indigo-500/15 text-indigo-200';
  if (share < 0.12) return 'bg-indigo-500/30 text-indigo-100';
  if (share < 0.25) return 'bg-indigo-500/50 text-indigo-50';
  return 'bg-indigo-500/75 text-white';
}

export function windowChange(cell: DemandCell, window: WindowKey): number | null {
  switch (window) {
    case '30d':
      return cell.change_30d;
    case '90d':
      return cell.change_90d;
    case '365d':
      return cell.change_365d;
    default:
      return cell.change_all;
  }
}

export function windowVelocity(cell: DemandCell, window: WindowKey): number | null {
  switch (window) {
    case '30d':
      return cell.velocity_30d;
    case '90d':
      return cell.velocity_90d;
    default:
      return cell.velocity_365d;
  }
}

/** Tier × trajectory counts, shaded by share of the tracked universe. */
export function DemandMatrix({ cells }: { cells: DemandCell[] }) {
  const total = cells.length || 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="w-40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              Persistence
            </th>
            {TRAJECTORIES.map((trajectory) => (
              <th
                key={trajectory}
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                {trajectory}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TIERS.map((tier) => (
            <tr key={tier}>
              <th className="text-left align-middle" title={TIER_BLURB[tier]}>
                <span className="text-sm font-medium">{tier}</span>
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {cells.filter((cell) => cell.persistence_tier === tier).length} cards
                </span>
              </th>
              {TRAJECTORIES.map((trajectory) => {
                const count = cells.filter(
                  (cell) => cell.persistence_tier === tier && cell.trajectory === trajectory,
                ).length;
                return (
                  <td key={trajectory} className="p-0">
                    <div
                      className={cn(
                        'flex h-14 flex-col items-center justify-center rounded-md tabular',
                        densityTone(count / total),
                      )}
                    >
                      <span className="text-base font-semibold">{count}</span>
                      <span className="text-[10px] opacity-80">
                        {((count / total) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Card-level density grid grouped by persistence tier. */
export function DemandGrid({ cells, window }: { cells: DemandCell[]; window: WindowKey }) {
  return (
    <div className="space-y-6">
      {TIERS.map((tier) => {
        const tierCells = cells.filter((cell) => cell.persistence_tier === tier);
        if (tierCells.length === 0) return null;
        return (
          <div key={tier} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">{tier}</h3>
              <p className="text-xs text-muted-foreground">{TIER_BLURB[tier]}</p>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {tierCells.map((cell) => {
                const change = windowChange(cell, window);
                const velocity = windowVelocity(cell, window);
                return (
                  <Link
                    key={`${cell.card_id}-${cell.grade}`}
                    href={`/cards/${cell.card_id}`}
                    title={`${cell.card_name} · ${cell.set_name} · ${cell.trajectory}`}
                    className={cn(
                      'rounded-md p-2 ring-1 ring-inset transition-transform hover:scale-[1.03]',
                      changeTone(change),
                    )}
                  >
                    <span className="block truncate text-xs font-medium">{cell.card_name}</span>
                    <span className="block truncate text-[10px] opacity-75">{cell.set_name}</span>
                    <span className="mt-1 flex items-baseline justify-between text-[11px] tabular">
                      <span className="font-semibold">{formatPercent(change, 0)}</span>
                      <span className="opacity-80">{formatCurrency(cell.end_price, cell.end_price !== null && cell.end_price < 10 ? 2 : 0)}</span>
                    </span>
                    <span className="flex items-baseline justify-between text-[10px] opacity-75">
                      <span>{cell.trajectory}</span>
                      <span>{velocity === null ? '—' : `${velocity.toFixed(1)}/d`}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
      {cells.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {formatCompact(cells.length)} tracked cards · colour encodes the price change over the
          selected window, velocity is sales per day.
        </p>
      )}
    </div>
  );
}
