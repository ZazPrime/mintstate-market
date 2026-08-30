'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { AXIS_TICK, GRID_STROKE, TOOLTIP_STYLE } from '@/components/chart-theme';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supplyDemand, type VolumeBar } from '@/lib/analytics/card-intelligence';
import { formatCompact, formatDate, formatPercent } from '@/lib/format';
import type { CardIntelligenceRow } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

const PRESSURE_POSITION: Record<string, number> = { Soft: 12, Steady: 38, Warm: 64, Hot: 90 };
const TREND_POSITION: Record<string, number> = { Clearing: 15, Balanced: 50, Building: 85 };

function Gauge({
  label,
  left,
  right,
  position,
  value,
  gradient,
}: {
  label: string;
  left: string;
  right: string;
  position: number;
  value: string;
  gradient: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
      <div className={cn('relative mt-2 h-2 rounded-full', gradient)}>
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
          style={{ left: `${position}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

/** Listings vs. sold flow, sell-through and supply gauges, daily volume bars. */
export function SupplyDemandRadar({
  intel,
  volume,
}: {
  intel: CardIntelligenceRow;
  volume: VolumeBar[];
}) {
  const signal = supplyDemand(intel);

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Supply &amp; demand radar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/70 bg-card/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Active listings
            </p>
            <p className="tabular mt-1 text-xl font-semibold">
              {formatCompact(intel.active_listings)}
            </p>
            <p
              className={cn(
                'text-xs',
                (signal.listingsDelta ?? 0) <= 0 ? 'text-emerald-400' : 'text-rose-400',
              )}
            >
              {signal.listingsDelta === null ? 'No 7-day baseline' : `${formatPercent(signal.listingsDelta)} vs. 7d ago`}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Sold / week</p>
            <p className="tabular mt-1 text-xl font-semibold">{formatCompact(intel.sales_7d)}</p>
            <p
              className={cn(
                'text-xs',
                (signal.soldDelta ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400',
              )}
            >
              {signal.soldDelta === null ? 'No prior week' : `${formatPercent(signal.soldDelta)} vs. prior week`}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <Gauge
            label="Demand pressure"
            left="Soft"
            right="Hot"
            position={PRESSURE_POSITION[signal.pressure]}
            value={
              signal.sellThrough === null
                ? signal.pressure
                : `${signal.pressure} · ${(signal.sellThrough * 100).toFixed(0)}% sell-through`
            }
            gradient="bg-gradient-to-r from-slate-600 via-amber-500 to-emerald-400"
          />
          <Gauge
            label="Supply trend"
            left="Clearing"
            right="Building"
            position={TREND_POSITION[signal.trend]}
            value={signal.trend}
            gradient="bg-gradient-to-r from-emerald-400 via-slate-500 to-rose-400"
          />
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Daily sold volume · 30 days
          </p>
          <div className="mt-2 h-[150px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volume} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                  tickFormatter={(value: string) => value.slice(5)}
                />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: 'hsl(var(--secondary))', opacity: 0.4 }}
                  labelFormatter={(label) => formatDate(String(label))}
                  formatter={(value) => [Number(value).toLocaleString(), 'Sales']}
                />
                <Bar
                  dataKey="sales"
                  fill="hsl(var(--chart-2))"
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
