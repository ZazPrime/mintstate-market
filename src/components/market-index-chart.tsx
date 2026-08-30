'use client';

import { useMemo, useState } from 'react';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AXIS_TICK, GRID_STROKE, TOOLTIP_STYLE } from '@/components/chart-theme';
import { formatDate } from '@/lib/format';
import type { BenchmarkPoint, IndexPoint } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

/** `days: null` means "no cutoff". */
const RANGES: Array<{ label: string; days: number | null }> = [
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '1Y', days: 365 },
  { label: 'MAX', days: null },
];

/** Rebases both series to 100 at the first shared date so they are comparable. */
function buildSeries(index: IndexPoint[], benchmark: BenchmarkPoint[], days: number | null) {
  const cutoff =
    days === null ? '0000-01-01' : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const benchmarkByDate = new Map(benchmark.map((point) => [point.observed_date, point.close_value]));
  const filtered = index.filter((point) => point.observed_date >= cutoff);
  if (filtered.length === 0) return [];

  const indexBase = filtered[0].index_value;
  // The benchmark only trades on weekdays, so a card-market date carries the
  // most recent close at or before it rather than dropping out of the series.
  const benchmarkDates = benchmark.map((point) => point.observed_date).sort();
  const closeOn = (date: string): number | undefined => {
    const exact = benchmarkByDate.get(date);
    if (exact !== undefined) return exact;
    let previous: string | undefined;
    for (const candidate of benchmarkDates) {
      if (candidate > date) break;
      previous = candidate;
    }
    return previous ? benchmarkByDate.get(previous) : undefined;
  };

  const benchmarkBase = filtered
    .map((point) => closeOn(point.observed_date))
    .find((value): value is number => value !== undefined);

  return filtered.map((point) => {
    const benchmarkValue = closeOn(point.observed_date);
    return {
      date: point.observed_date,
      msm100: (point.index_value / indexBase) * 100,
      spx:
        benchmarkValue !== undefined && benchmarkBase
          ? (benchmarkValue / benchmarkBase) * 100
          : null,
    };
  });
}

export function MarketIndexChart({
  index,
  benchmark,
}: {
  index: IndexPoint[];
  benchmark: BenchmarkPoint[];
}) {
  const [range, setRange] = useState(RANGES[2]);
  const data = useMemo(() => buildSeries(index, benchmark, range.days), [index, benchmark, range]);

  const last = data.at(-1);
  const indexReturn = last ? last.msm100 / 100 - 1 : null;
  const benchmarkReturn = last?.spx ? last.spx / 100 - 1 : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-4 text-sm">
          <span className="text-muted-foreground">
            MSM 100:{' '}
            <span className={cn('tabular font-medium', (indexReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
              {indexReturn === null ? '—' : `${(indexReturn * 100).toFixed(2)}%`}
            </span>
          </span>
          <span className="text-muted-foreground">
            S&amp;P 500:{' '}
            <span className={cn('tabular font-medium', (benchmarkReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
              {benchmarkReturn === null ? '—' : `${(benchmarkReturn * 100).toFixed(2)}%`}
            </span>
          </span>
        </div>
        <div className="flex gap-1">
          {RANGES.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setRange(option)}
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors',
                range.label === option.label
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[360px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
              tickFormatter={(value: string) => value.slice(5)}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              domain={['auto', 'auto']}
              width={52}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(label) => formatDate(String(label))}
              formatter={(value, name) => [
                value === null || value === undefined ? '—' : Number(value).toFixed(2),
                name === 'msm100' ? 'MSM 100' : 'S&P 500',
              ]}
            />
            <Legend
              formatter={(value) => (value === 'msm100' ? 'MintState 100' : 'S&P 500')}
              wrapperStyle={{ fontSize: 12 }}
            />
            <Line
              type="monotone"
              dataKey="msm100"
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="spx"
              stroke="hsl(var(--chart-2))"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
