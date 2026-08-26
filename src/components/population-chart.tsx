'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AXIS_TICK, GRID_STROKE, TOOLTIP_STYLE } from '@/components/chart-theme';
import { formatDate } from '@/lib/format';
import type { PopulationPoint } from '@/lib/supabase/types';

export function PopulationChart({ points }: { points: PopulationPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No PSA population snapshots yet.
      </p>
    );
  }

  const data = points.map((point) => ({
    date: point.snapshot_date,
    total: point.total_graded,
    gemRate: point.gem_rate === null ? null : point.gem_rate * 100,
  }));

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
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
            yAxisId="pop"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <YAxis yAxisId="rate" orientation="right" hide domain={[0, 100]} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(label) => formatDate(String(label))}
            formatter={(value, name) => [
              name === 'gemRate'
                ? `${Number(value).toFixed(1)}%`
                : Number(value).toLocaleString(),
              name === 'gemRate' ? 'Gem rate' : 'Total graded',
            ]}
          />
          <Area
            yAxisId="pop"
            type="monotone"
            dataKey="total"
            stroke="hsl(var(--chart-5))"
            fill="hsl(var(--chart-5))"
            fillOpacity={0.12}
            strokeWidth={2}
            isAnimationActive={false}
          />
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="gemRate"
            stroke="hsl(var(--chart-3))"
            strokeWidth={1.5}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
