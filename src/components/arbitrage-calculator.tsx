'use client';

import { useMemo, useState } from 'react';

import Link from 'next/link';

import { GradeBadge } from '@/components/grade-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatPercent } from '@/lib/format';
import type { CardAnalyticsRow } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

/** Published turnaround tiers; declared value caps are enforced by PSA. */
const SERVICE_TIERS = [
  { id: 'value-bulk', label: 'Value Bulk (20+ cards)', fee: 18.99, maxValue: 499 },
  { id: 'value', label: 'Value', fee: 24.99, maxValue: 499 },
  { id: 'value-plus', label: 'Value Plus', fee: 39.99, maxValue: 999 },
  { id: 'regular', label: 'Regular', fee: 74.99, maxValue: 1499 },
  { id: 'express', label: 'Express', fee: 149.0, maxValue: 2499 },
];

export interface ArbitrageInputs {
  tierId: string;
  shipping: number;
  salesFeePct: number;
  gemRateOverride: number | null;
}

function expectedValue(
  row: CardAnalyticsRow,
  inputs: ArbitrageInputs,
  tierFee: number,
): { cost: number; proceeds: number; net: number; roi: number | null; gemRate: number } {
  const raw = row.market_price_raw ?? 0;
  const psa10 = row.market_price_psa10 ?? 0;
  const gemRate = inputs.gemRateOverride ?? row.gem_rate ?? 0.35;

  // Non-gem outcomes are assumed to clear around the PSA 9 discount to a 10,
  // which historically sits near 35% of the PSA 10 price for modern cards.
  const psa9Estimate = psa10 * 0.35;
  const grossPerSubmission = psa10 * gemRate + psa9Estimate * (1 - gemRate);
  const proceeds = grossPerSubmission * (1 - inputs.salesFeePct);
  const cost = raw + tierFee + inputs.shipping;

  return {
    cost,
    proceeds,
    net: proceeds - cost,
    roi: cost > 0 ? (proceeds - cost) / cost : null,
    gemRate,
  };
}

export function ArbitrageCalculator({ rows }: { rows: CardAnalyticsRow[] }) {
  const [inputs, setInputs] = useState<ArbitrageInputs>({
    tierId: 'value',
    shipping: 12,
    salesFeePct: 0.1325,
    gemRateOverride: null,
  });

  const tier = SERVICE_TIERS.find((t) => t.id === inputs.tierId) ?? SERVICE_TIERS[1];

  const computed = useMemo(
    () =>
      rows
        .map((row) => ({ row, result: expectedValue(row, inputs, tier.fee) }))
        .sort((a, b) => b.result.net - a.result.net),
    [rows, inputs, tier.fee],
  );

  const overCap = computed.filter(({ row }) => (row.market_price_psa10 ?? 0) > tier.maxValue).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[320px,1fr]">
      <Card className="h-fit border-border/70">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Assumptions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Grading service
            </Label>
            <Select
              value={inputs.tierId}
              onValueChange={(value) => setInputs((prev) => ({ ...prev, tierId: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_TIERS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label} — {formatCurrency(option.fee)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Declared value cap {formatCurrency(tier.maxValue)}
              {overCap > 0 && ` · ${overCap} card(s) below exceed it`}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="shipping" className="text-xs uppercase tracking-wide text-muted-foreground">
              Shipping &amp; insurance (per card)
            </Label>
            <Input
              id="shipping"
              type="number"
              min={0}
              step={0.5}
              value={inputs.shipping}
              onChange={(event) =>
                setInputs((prev) => ({ ...prev, shipping: Number(event.target.value) || 0 }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Marketplace fee · {(inputs.salesFeePct * 100).toFixed(2)}%
            </Label>
            <Slider
              value={[inputs.salesFeePct * 100]}
              min={0}
              max={20}
              step={0.25}
              onValueChange={([value]) =>
                setInputs((prev) => ({ ...prev, salesFeePct: value / 100 }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Gem rate ·{' '}
              {inputs.gemRateOverride === null
                ? 'per-card actual'
                : `${(inputs.gemRateOverride * 100).toFixed(0)}% override`}
            </Label>
            <Slider
              value={[(inputs.gemRateOverride ?? 0) * 100]}
              min={0}
              max={100}
              step={1}
              onValueChange={([value]) =>
                setInputs((prev) => ({ ...prev, gemRateOverride: value / 100 }))
              }
            />
            <button
              type="button"
              onClick={() => setInputs((prev) => ({ ...prev, gemRateOverride: null }))}
              className="text-xs text-primary hover:underline"
            >
              Use each card&apos;s observed PSA gem rate
            </button>
          </div>

          <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            Expected proceeds weight the PSA 10 clearing price by the gem rate and assume non-gem
            returns clear at ~35% of the PSA 10 price, net of marketplace fees.
          </p>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border border-border scrollbar-thin">
        <Table className="text-sm">
          <TableHeader className="bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-9 text-xs uppercase tracking-wide">Card</TableHead>
              <TableHead className="h-9 text-right text-xs uppercase tracking-wide">Raw</TableHead>
              <TableHead className="h-9 text-right text-xs uppercase tracking-wide">PSA 10</TableHead>
              <TableHead className="h-9 text-right text-xs uppercase tracking-wide">Gem rate</TableHead>
              <TableHead className="h-9 text-right text-xs uppercase tracking-wide">All-in cost</TableHead>
              <TableHead className="h-9 text-right text-xs uppercase tracking-wide">Exp. proceeds</TableHead>
              <TableHead className="h-9 text-right text-xs uppercase tracking-wide">Net edge</TableHead>
              <TableHead className="h-9 text-right text-xs uppercase tracking-wide">ROI</TableHead>
              <TableHead className="h-9 text-right text-xs uppercase tracking-wide">Grade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {computed.map(({ row, result }) => (
              <TableRow key={row.card_id} className="border-border/60">
                <TableCell className="max-w-[20rem] py-1.5">
                  <Link href={`/cards/${row.card_id}`} className="group flex flex-col">
                    <span className="truncate font-medium group-hover:text-primary">
                      {row.card_name}
                      <span className="ml-1.5 text-xs text-muted-foreground">#{row.card_number}</span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{row.set_name}</span>
                  </Link>
                </TableCell>
                <TableCell className="py-1.5 text-right tabular">
                  {formatCurrency(row.market_price_raw)}
                </TableCell>
                <TableCell className="py-1.5 text-right tabular">
                  {formatCurrency(row.market_price_psa10)}
                </TableCell>
                <TableCell className="py-1.5 text-right tabular text-muted-foreground">
                  {(result.gemRate * 100).toFixed(0)}%
                </TableCell>
                <TableCell className="py-1.5 text-right tabular text-muted-foreground">
                  {formatCurrency(result.cost)}
                </TableCell>
                <TableCell className="py-1.5 text-right tabular text-muted-foreground">
                  {formatCurrency(result.proceeds)}
                </TableCell>
                <TableCell
                  className={cn(
                    'py-1.5 text-right tabular font-medium',
                    result.net >= 0 ? 'text-emerald-400' : 'text-rose-400',
                  )}
                >
                  {formatCurrency(result.net)}
                </TableCell>
                <TableCell
                  className={cn(
                    'py-1.5 text-right tabular',
                    (result.roi ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400',
                  )}
                >
                  {formatPercent(result.roi)}
                </TableCell>
                <TableCell className="py-1.5 text-right">
                  <GradeBadge grade={row.investment_grade} />
                </TableCell>
              </TableRow>
            ))}
            {computed.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  No cards with both raw and PSA 10 pricing yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
