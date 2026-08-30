import Link from 'next/link';

import { cn } from '@/lib/utils';

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Link-based toggle group. Keeps every other search param intact so the
 * window, grade and era selectors on a page compose instead of resetting
 * each other.
 */
export function FilterTabs({
  basePath,
  param,
  options,
  active,
  params,
  label,
  size = 'md',
}: {
  basePath: string;
  param: string;
  options: FilterOption[];
  active: string;
  params: Record<string, string | undefined>;
  label?: string;
  size?: 'sm' | 'md';
}) {
  function hrefFor(value: string): string {
    const next = new URLSearchParams();
    for (const [key, current] of Object.entries(params)) {
      if (current && key !== param) next.set(key, current);
    }
    next.set(param, value);
    return `${basePath}?${next.toString()}`;
  }

  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      )}
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border/70 bg-card/50 p-1">
        {options.map((option) => (
          <Link
            key={option.value}
            href={hrefFor(option.value)}
            scroll={false}
            className={cn(
              'rounded-md transition-colors',
              size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              option.value === active
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export const WINDOW_OPTIONS: FilterOption[] = [
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '365d', label: '1Y' },
  { value: 'all', label: 'ALL' },
];

export const GRADE_OPTIONS: FilterOption[] = [
  { value: 'RAW', label: 'Raw' },
  { value: 'PSA10', label: 'PSA 10' },
];

export const WINDOW_LABEL: Record<string, string> = {
  '30d': '30 days',
  '90d': '90 days',
  '365d': '12 months',
  all: 'all time',
};
