export function formatCurrency(value: number | null | undefined, maximumFractionDigits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Colour ramp for the S+ → F investment grade badges. */
export function gradeTone(grade: string | null | undefined): string {
  switch (grade) {
    case 'S+':
    case 'S':
      return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30';
    case 'A+':
    case 'A':
      return 'bg-teal-500/15 text-teal-300 ring-1 ring-inset ring-teal-500/30';
    case 'B+':
    case 'B':
      return 'bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30';
    case 'C+':
    case 'C':
      return 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30';
    case 'D':
      return 'bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-500/30';
    default:
      return 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30';
  }
}

/** Green when trading below fair value, red when above. */
export function premiumTone(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'text-muted-foreground';
  if (value <= -0.05) return 'text-emerald-400';
  if (value < 0) return 'text-emerald-300/80';
  if (value >= 0.05) return 'text-rose-400';
  return 'text-rose-300/80';
}
