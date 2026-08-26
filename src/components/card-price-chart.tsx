'use client';

import { useMemo } from 'react';

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

/**
 * Clearing-price history for whichever window the page selected — the series
 * is whatever the server handed down, so the axis rescales with the window.
 */
export function CardPriceChart({ history }: { history: PricePoint[] }) {
  const data = useMemo(() => {
    const byDate = new Map<
      string,
      { date: string; raw: number | null; psa10: number | null; volume: number }
    >();

    for (const point of history) {
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
  }, [history]);

  // Wide windows get month/year ticks; short ones keep month/day.
  const spanDays = useMemo(() => {
    if (data.length < 2) return 0;
    const first = new Date(data[0].date).getTime();
    const last = new Date(data[data.length - 1].date).getTime();
    return Math.round((last - first) / 86_400_000);
  }, [data]);

  const tickFormatter = (value: string) =>
    spanDays > 400 ? value.slice(0, 7) : spanDays > 120 ? value.slice(5, 7) + '/' + value.slice(8) : value.slice(5);

  if (data.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No sales recorded in this window.
      </p>
    );
  }

  return (
    <div className="space-y-3">
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
              tickFormatter={tickFormatter}
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
