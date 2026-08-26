import type { GradeDistributionRow, PricePoint } from '@/lib/supabase/types';

/** Flat PSA submission cost assumed by the grading edge model. */
export const GRADING_FEE = 20;

/** Gem rate applied when a card has no PSA population snapshot yet. */
export const ASSUMED_GEM_RATE = 0.35;

export type InvestmentLetter = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface InvestmentScore {
  /** 0–100 headline score rendered by the radial wheel. */
  score: number;
  letter: InvestmentLetter;
  /** Sub-drivers on the 0–10 scale used by the progress bars. */
  demand: number;
  scarcity: number;
  stability: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 0–1 position of `price` inside its trailing high/low band. */
export function rangePosition(
  price: number | null,
  low: number | null,
  high: number | null,
): number | null {
  if (price === null || low === null || high === null || high <= low) return null;
  return clamp((price - low) / (high - low), 0, 1);
}

export function investmentLetter(score: number): InvestmentLetter {
  if (score >= 85) return 'A+';
  if (score >= 72) return 'A';
  if (score >= 58) return 'B';
  if (score >= 42) return 'C';
  if (score >= 25) return 'D';
  return 'F';
}

/** Human label for the letter grade, e.g. "C" reads as a fair hold. */
export const LETTER_LABEL: Record<InvestmentLetter, string> = {
  'A+': 'Core holding',
  A: 'Strong hold',
  B: 'Solid hold',
  C: 'Fair hold',
  D: 'Speculative',
  F: 'Avoid',
};

/**
 * Blends the cached demand and scarcity scores with a stability term derived
 * from 90-day volatility. Sub-drivers are reported on a 0–10 scale.
 */
export function investmentScore(row: {
  demand_score: number | null;
  scarcity_score: number | null;
  volatility_90d: number | null;
}): InvestmentScore {
  const demand100 = clamp(row.demand_score ?? 0, 0, 100);
  const scarcity100 = clamp(row.scarcity_score ?? 0, 0, 100);
  // A card whose 90-day dispersion is half its price scores zero stability.
  const stability100 = clamp(100 - (row.volatility_90d ?? 0.5) * 200, 0, 100);
  const score = Math.round(demand100 * 0.5 + scarcity100 * 0.2 + stability100 * 0.3);

  return {
    score,
    letter: investmentLetter(score),
    demand: Math.round(demand100) / 10,
    scarcity: Math.round(scarcity100) / 10,
    stability: Math.round(stability100) / 10,
  };
}

/** PSA 10 price divided by the PSA 9 price — the "9-to-10 step". */
export function gradeLadderStep(psa9: number | null, psa10: number | null): number | null {
  if (psa9 === null || psa10 === null || psa9 <= 0) return null;
  return psa10 / psa9;
}

export interface GradingEdge {
  /** Gem-weighted PSA 10 proceeds less the raw cost and the grading fee. */
  net: number;
  /** Net as a share of the total outlay. */
  roi: number;
  /** Upside if the submission actually returns a PSA 10. */
  upsideRoi: number;
  gemRate: number;
  assumedGemRate: boolean;
}

export function gradingEdge(input: {
  raw: number | null;
  psa10: number | null;
  gemRate: number | null;
  fee?: number;
}): GradingEdge | null {
  const { raw, psa10, gemRate, fee = GRADING_FEE } = input;
  if (raw === null || psa10 === null || raw <= 0) return null;

  const rate = gemRate ?? ASSUMED_GEM_RATE;
  const cost = raw + fee;
  return {
    net: psa10 * rate - cost,
    roi: (psa10 * rate - cost) / cost,
    upsideRoi: (psa10 - cost) / cost,
    gemRate: rate,
    assumedGemRate: gemRate === null,
  };
}

export type DemandPressure = 'Soft' | 'Steady' | 'Warm' | 'Hot';
export type SupplyTrend = 'Clearing' | 'Balanced' | 'Building';

export interface SupplyDemand {
  /** Weekly sales divided by active listings, capped at 1. */
  sellThrough: number | null;
  pressure: DemandPressure;
  listingsDelta: number | null;
  soldDelta: number | null;
  trend: SupplyTrend;
}

export function supplyDemand(row: {
  sales_7d: number;
  sales_prev_7d: number;
  active_listings: number | null;
  listings_prior_7d: number | null;
}): SupplyDemand {
  const listings = row.active_listings;
  const sellThrough =
    listings === null || listings <= 0 ? null : clamp(row.sales_7d / listings, 0, 1);

  const pressure: DemandPressure =
    sellThrough === null || sellThrough < 0.05
      ? 'Soft'
      : sellThrough < 0.15
        ? 'Steady'
        : sellThrough < 0.3
          ? 'Warm'
          : 'Hot';

  const listingsDelta =
    listings === null || row.listings_prior_7d === null || row.listings_prior_7d <= 0
      ? null
      : listings / row.listings_prior_7d - 1;
  const soldDelta = row.sales_prev_7d > 0 ? row.sales_7d / row.sales_prev_7d - 1 : null;

  const trend: SupplyTrend =
    listingsDelta === null
      ? 'Balanced'
      : listingsDelta > 0.05
        ? 'Building'
        : listingsDelta < -0.05
          ? 'Clearing'
          : 'Balanced';

  return { sellThrough, pressure, listingsDelta, soldDelta, trend };
}

export interface VolumeBar {
  date: string;
  sales: number;
}

/** Daily raw sales over the trailing `days`, zero-filled so gaps stay visible. */
export function dailyVolume(history: PricePoint[], days = 30): VolumeBar[] {
  const sales = new Map<string, number>();
  for (const point of history) {
    if (point.grade !== 'RAW') continue;
    sales.set(point.observed_date, (sales.get(point.observed_date) ?? 0) + point.sale_count);
  }

  const bars: VolumeBar[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    bars.push({ date, sales: sales.get(date) ?? 0 });
  }
  return bars;
}

export interface GradeBucket {
  label: string;
  count: number;
  share: number;
}

const BUCKETS: Array<{ label: string; key: keyof GradeDistributionRow }> = [
  { label: 'PSA 10', key: 'psa10' },
  { label: 'PSA 9', key: 'psa9' },
  { label: 'PSA 8', key: 'psa8' },
  { label: 'PSA 7', key: 'psa7' },
  { label: '6 & below', key: 'psa6_and_below' },
];

export function gradeBuckets(row: GradeDistributionRow | null): GradeBucket[] {
  if (!row || row.total_graded <= 0) return [];
  return BUCKETS.map(({ label, key }) => {
    const count = Number(row[key] ?? 0);
    return { label, count, share: count / row.total_graded };
  });
}
