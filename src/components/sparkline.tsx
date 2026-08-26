'use client';

import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';

import type { SparklinePoint } from '@/lib/supabase/types';

/** 30-day trailing price sparkline rendered inside a data-table row. */
export function Sparkline({
  data,
  positive,
  width = 120,
  height = 32,
}: {
  data: SparklinePoint[];
  positive?: boolean;
  width?: number;
  height?: number;
}) {
  if (!data || data.length < 2) {
    return <div className="text-xs text-muted-foreground">no trend</div>;
  }

  const points = data.map((point) => ({ d: point.d, p: Number(point.p) }));
  const trendUp = positive ?? points[points.length - 1].p >= points[0].p;
  const stroke = trendUp ? 'hsl(160 84% 45%)' : 'hsl(0 72% 60%)';
  const gradientId = `spark-${trendUp ? 'up' : 'down'}`;

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area
            type="monotone"
            dataKey="p"
            stroke={stroke}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
