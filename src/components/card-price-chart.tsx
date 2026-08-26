'use client';

import { useMemo, useState } from 'react';

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AXIS_TICK, GRID_STROKE, TOOLTIP_STYLE } from '@/components/chart-theme';
import { formatCurrency, formatDate } from '@/lib/format';
import type { PricePoint } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

const RANGES = [30, 90, 180];

export function CardPriceChart({ history }: { history: PricePoint[] }) {
  const [days, setDays] = useState(90);

  const data = useMemo(() => {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const byDate = new Map<
      string,
      { date: string; raw: number | null; psa10: number | null; volume: number }
    >();

    for (const point of history) {
      if (point.observed_date < cutoff) continue;
      const entry = byDate.get(point.observed_date) ?? {
        date: point.observed_date,
        raw: null,
        psa10: null,
        volume: 0,
      };
      if (point.grade === 'RAW') entry.raw = point.median_price;
      if (point.grade === 'PSA10') entry.psa10 = point.median_price;
      entry.volume += point.sale_count;
      byDate.set(point.observed_date, entry);
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [history, days]);

  if (data.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No sales recorded in this window.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-1">
        {RANGES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setDays(option)}
            className={cn(
              'rounded px-2 py-1 text-xs transition-colors',
              days === option
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option}D
          </button>
        ))}
      </div>

      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              tickFormatter={(value: string) => value.slice(5)}
            />
            <YAxis
              yAxisId="price"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(value: number) => `$${value}`}
            />
            <YAxis yAxisId="volume" orientation="right" hide />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(label) => formatDate(String(label))}
              formatter={(value, name) => [
                name === 'volume' ? Number(value) : formatCurrency(Number(value)),
                name === 'raw' ? 'Raw' : name === 'psa10' ? 'PSA 10' : 'Sales',
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value) => (value === 'raw' ? 'Raw' : value === 'psa10' ? 'PSA 10' : 'Sales')}
            />
            <Bar
              yAxisId="volume"
              dataKey="volume"
              fill="hsl(var(--muted))"
              barSize={6}
              isAnimationActive={false}
            />
            <Area
              yAxisId="price"
              type="monotone"
              dataKey="psa10"
              stroke="hsl(var(--chart-2))"
              fill="hsl(var(--chart-2))"
              fillOpacity={0.08}
              strokeWidth={2}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="raw"
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
