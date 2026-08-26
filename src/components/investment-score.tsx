'use client';

import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LETTER_LABEL,
  investmentScore,
  type InvestmentScore,
} from '@/lib/analytics/card-intelligence';
import { formatPercent } from '@/lib/format';
import { WINDOW_LABEL } from '@/components/filter-tabs';
import type { CardIntelligenceRow, WindowKey } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

const DRIVERS: Array<{ key: keyof Pick<InvestmentScore, 'demand' | 'scarcity' | 'stability'>; label: string; hint: string }> = [
  { key: 'demand', label: 'Demand', hint: 'Sales velocity and 30-day price direction' },
  { key: 'scarcity', label: 'Scarcity', hint: 'Graded population against comparable cards' },
  { key: 'stability', label: 'Stability', hint: 'Inverse of 90-day price dispersion' },
];

function scoreTone(score: number): string {
  if (score >= 72) return 'hsl(var(--chart-2))';
  if (score >= 42) return 'hsl(var(--chart-4))';
  return 'hsl(var(--chart-5))';
}

function QuickStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('tabular text-sm font-semibold', tone)}>{value}</p>
    </div>
  );
}

export function InvestmentScoreWidget({
  intel,
  window,
  gradingEdgeRoi,
}: {
  intel: CardIntelligenceRow;
  window: WindowKey;
  gradingEdgeRoi: number | null;
}) {
  const score = investmentScore(intel);
  const data = [{ name: 'score', value: score.score, fill: scoreTone(score.score) }];

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Investment score</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative h-[132px] w-[132px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                data={data}
                innerRadius="72%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar dataKey="value" cornerRadius={8} background isAnimationActive={false} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="tabular text-2xl font-semibold">{score.score}</span>
              <span className="text-[11px] text-muted-foreground">/ 100</span>
            </div>
          </div>

          <div>
            <p className="text-3xl font-semibold">{score.letter}</p>
            <p className="text-sm text-muted-foreground">{LETTER_LABEL[score.letter]}</p>
          </div>
        </div>

        <div className="space-y-2">
          {DRIVERS.map((driver) => {
            const value = score[driver.key];
            return (
              <div key={driver.key}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">{driver.label}</span>
                  <span className="tabular font-medium">{value.toFixed(1)}/10</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      value >= 7 ? 'bg-emerald-400' : value >= 4 ? 'bg-amber-400' : 'bg-rose-400',
                    )}
                    style={{ width: `${value * 10}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{driver.hint}</p>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <QuickStat
            label="30-day move"
            value={formatPercent(intel.momentum_30d)}
            tone={(intel.momentum_30d ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}
          />
          <QuickStat
            label="Grading edge"
            value={formatPercent(gradingEdgeRoi)}
            tone={(gradingEdgeRoi ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}
          />
          <QuickStat label="Window" value={WINDOW_LABEL[window]} />
        </div>
      </CardContent>
    </Card>
  );
}
