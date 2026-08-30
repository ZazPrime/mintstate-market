'use client';

import { useMemo, useState } from 'react';

import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { GradeBadge } from '@/components/grade-badge';
import { Sparkline } from '@/components/sparkline';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCompact, formatCurrency, formatPercent, premiumTone } from '@/lib/format';
import type { CardAnalyticsRow } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

type SortKey =
  | 'card_name'
  | 'market_price_raw'
  | 'fair_value_raw'
  | 'raw_premium_pct'
  | 'momentum_30d'
  | 'sales_30d'
  | 'pop_total'
  | 'gem_rate'
  | 'composite_score';

const COLUMNS: Array<{ key: SortKey; label: string; align?: 'right'; hint?: string }> = [
  { key: 'card_name', label: 'Card' },
  { key: 'market_price_raw', label: 'Market', align: 'right', hint: 'Latest raw clearing price' },
  { key: 'fair_value_raw', label: 'Fair value', align: 'right', hint: 'Recency-weighted trailing median' },
  { key: 'raw_premium_pct', label: 'Premium', align: 'right', hint: 'Market vs. fair value' },
  { key: 'momentum_30d', label: '30d', align: 'right', hint: '30-day change in median price' },
  { key: 'sales_30d', label: 'Sales', align: 'right', hint: 'Sold listings in the last 30 days' },
  { key: 'pop_total', label: 'PSA pop', align: 'right' },
  { key: 'gem_rate', label: 'Gem', align: 'right', hint: 'Share of PSA submissions grading 10' },
  { key: 'composite_score', label: 'Grade', align: 'right' },
];

export function FairValueTable({ rows }: { rows: CardAnalyticsRow[] }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: 'raw_premium_pct',
    desc: false,
  });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? rows.filter(
          (row) =>
            row.card_name.toLowerCase().includes(term) ||
            row.set_name.toLowerCase().includes(term),
        )
      : rows;

    return [...filtered].sort((a, b) => {
      const left = a[sort.key];
      const right = b[sort.key];
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      const comparison =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      return sort.desc ? -comparison : comparison;
    });
  }, [rows, search, sort]);

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key ? { key, desc: !current.desc } : { key, desc: true },
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter by card or set…"
          className="h-9 w-full max-w-xs text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {visible.length} of {rows.length} cards · click a column to sort
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border scrollbar-thin">
        <Table className="text-sm">
          <TableHeader className="sticky top-0 bg-card">
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((column) => (
                <TableHead
                  key={column.key}
                  title={column.hint}
                  onClick={() => toggleSort(column.key)}
                  className={cn(
                    'h-9 cursor-pointer select-none whitespace-nowrap text-xs font-medium uppercase tracking-wide',
                    column.align === 'right' && 'text-right',
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {column.label}
                    {sort.key === column.key ? (
                      sort.desc ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ArrowUp className="h-3 w-3" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-30" />
                    )}
                  </span>
                </TableHead>
              ))}
              <TableHead className="h-9 text-xs font-medium uppercase tracking-wide">
                30d trend
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.card_id} className="border-border/60">
                <TableCell className="max-w-[22rem] py-1.5">
                  <Link href={`/cards/${row.card_id}`} className="group flex flex-col">
                    <span className="truncate font-medium group-hover:text-primary">
                      {row.card_name}
                      <span className="ml-1.5 text-xs text-muted-foreground">#{row.card_number}</span>
                    </span>
                    <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      {row.set_name}
                      {row.rarity && (
                        <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
                          {row.rarity}
                        </Badge>
                      )}
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="py-1.5 text-right tabular">
                  {formatCurrency(row.market_price_raw)}
                </TableCell>
                <TableCell className="py-1.5 text-right tabular text-muted-foreground">
                  {formatCurrency(row.fair_value_raw)}
                </TableCell>
                <TableCell
                  className={cn('py-1.5 text-right tabular font-medium', premiumTone(row.raw_premium_pct))}
                >
                  {formatPercent(row.raw_premium_pct)}
                </TableCell>
                <TableCell className={cn('py-1.5 text-right tabular', premiumTone(-(row.momentum_30d ?? 0)))}>
                  {formatPercent(row.momentum_30d)}
                </TableCell>
                <TableCell className="py-1.5 text-right tabular text-muted-foreground">
                  {formatCompact(row.sales_30d)}
                </TableCell>
                <TableCell className="py-1.5 text-right tabular text-muted-foreground">
                  {formatCompact(row.pop_total)}
                </TableCell>
                <TableCell className="py-1.5 text-right tabular text-muted-foreground">
                  {row.gem_rate === null ? '—' : `${(row.gem_rate * 100).toFixed(0)}%`}
                </TableCell>
                <TableCell className="py-1.5 text-right">
                  <GradeBadge grade={row.investment_grade} />
                </TableCell>
                <TableCell className="py-1.5">
                  <Sparkline data={row.sparkline} />
                </TableCell>
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMNS.length + 1} className="py-10 text-center text-muted-foreground">
                  No cards match this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
