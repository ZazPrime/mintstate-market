import 'server-only';

import { createPublicSupabase } from '@/lib/supabase/server';
import type {
  BenchmarkPoint,
  CardAnalyticsRow,
  CardIntelligenceRow,
  DemandCell,
  GradeDistributionRow,
  IndexPoint,
  MonthlyBasket,
  MonthlySeriesKey,
  MoverRow,
  PackEvRow,
  PopulationPoint,
  PricePoint,
  SealedGapRow,
  SetMonthlyCell,
  SparklinePoint,
  TrackedGrade,
  ValuationDrivers,
  WindowKey,
} from '@/lib/supabase/types';

/** PostgREST can hand back numerics as strings depending on column type. */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAnalytics(row: Record<string, unknown>): CardAnalyticsRow {
  const sparkline = Array.isArray(row.sparkline) ? (row.sparkline as SparklinePoint[]) : [];
  return {
    ...(row as unknown as CardAnalyticsRow),
    market_price_raw: num(row.market_price_raw),
    market_price_psa10: num(row.market_price_psa10),
    fair_value_raw: num(row.fair_value_raw),
    fair_value_psa10: num(row.fair_value_psa10),
    raw_premium_pct: num(row.raw_premium_pct),
    psa10_premium_pct: num(row.psa10_premium_pct),
    momentum_30d: num(row.momentum_30d),
    volatility_90d: num(row.volatility_90d),
    liquidity_score: num(row.liquidity_score),
    demand_score: num(row.demand_score),
    scarcity_score: num(row.scarcity_score),
    composite_score: num(row.composite_score),
    pop_total: num(row.pop_total),
    gem_rate: num(row.gem_rate),
    sales_30d: num(row.sales_30d),
    grading_arbitrage_net: num(row.grading_arbitrage_net),
    sparkline: sparkline.map((point) => ({ d: point.d, p: num(point.p) ?? 0 })),
  };
}

export type ValuationFilter = 'all' | 'undervalued' | 'overvalued';

export interface FairValueQuery {
  search?: string;
  filter?: ValuationFilter;
  minGrade?: string;
  limit?: number;
}

const STRONG_GRADES = ['S+', 'S', 'A+', 'A'];

export async function getFairValueBoard(query: FairValueQuery = {}): Promise<CardAnalyticsRow[]> {
  const { search, filter = 'all', minGrade, limit = 60 } = query;
  const supabase = createPublicSupabase();

  let request = supabase
    .from('card_analytics_latest')
    .select('*')
    .not('market_price_raw', 'is', null)
    .limit(limit);

  if (search) request = request.ilike('card_name', `%${search}%`);
  if (minGrade === 'strong') request = request.in('investment_grade', STRONG_GRADES);

  if (filter === 'undervalued') {
    request = request.lt('raw_premium_pct', 0).order('raw_premium_pct', { ascending: true });
  } else if (filter === 'overvalued') {
    request = request.gt('raw_premium_pct', 0).order('raw_premium_pct', { ascending: false });
  } else {
    request = request.order('composite_score', { ascending: false, nullsFirst: false });
  }

  const { data, error } = await request;
  if (error) throw new Error(`fair value board: ${error.message}`);
  return (data ?? []).map(normalizeAnalytics);
}

export async function getArbitrageBoard(limit = 60): Promise<CardAnalyticsRow[]> {
  const supabase = createPublicSupabase();
  const { data, error } = await supabase
    .from('card_analytics_latest')
    .select('*')
    .not('market_price_raw', 'is', null)
    .not('market_price_psa10', 'is', null)
    .order('grading_arbitrage_net', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`arbitrage board: ${error.message}`);
  return (data ?? []).map(normalizeAnalytics);
}

export async function getCardAnalytics(cardId: string): Promise<CardAnalyticsRow | null> {
  const supabase = createPublicSupabase();
  const { data, error } = await supabase
    .from('card_analytics_latest')
    .select('*')
    .eq('card_id', cardId)
    .maybeSingle();
  if (error) throw new Error(`card analytics: ${error.message}`);
  return data ? normalizeAnalytics(data) : null;
}

export async function getCardPriceHistory(cardId: string, days = 180): Promise<PricePoint[]> {
  const supabase = createPublicSupabase();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('price_history')
    .select('observed_date, median_price, low_price, high_price, sale_count, grade')
    .eq('card_id', cardId)
    .gte('observed_date', since)
    .order('observed_date', { ascending: true });
  if (error) throw new Error(`price history: ${error.message}`);
  return (data ?? []).map((row) => ({
    observed_date: row.observed_date as string,
    grade: row.grade as PricePoint['grade'],
    median_price: num(row.median_price),
    low_price: num(row.low_price),
    high_price: num(row.high_price),
    sale_count: num(row.sale_count) ?? 0,
  }));
}

export async function getCardPopulation(cardId: string): Promise<PopulationPoint[]> {
  const supabase = createPublicSupabase();
  const { data, error } = await supabase
    .from('population_reports')
    .select('snapshot_date, total_graded, gem_count, gem_rate')
    .eq('card_id', cardId)
    .eq('grader', 'PSA')
    .order('snapshot_date', { ascending: true });
  if (error) throw new Error(`population reports: ${error.message}`);
  return (data ?? []).map((row) => ({
    snapshot_date: row.snapshot_date as string,
    total_graded: num(row.total_graded) ?? 0,
    gem_count: num(row.gem_count) ?? 0,
    gem_rate: num(row.gem_rate),
  }));
}

export interface CardSearchResult {
  id: string;
  name: string;
  number: string;
  set_name: string;
  rarity: string | null;
  images: { small?: string };
}

export async function searchCards(term: string, limit = 12): Promise<CardSearchResult[]> {
  if (!term.trim()) return [];
  const supabase = createPublicSupabase();
  const { data, error } = await supabase
    .from('cards')
    .select('id, name, number, rarity, images, sets(name)')
    .ilike('name', `%${term}%`)
    .eq('language', 'en')
    .limit(limit);
  if (error) throw new Error(`card search: ${error.message}`);
  return (data ?? []).map((row) => {
    const set = row.sets as { name?: string } | { name?: string }[] | null;
    const setName = Array.isArray(set) ? set[0]?.name : set?.name;
    return {
      id: row.id as string,
      name: row.name as string,
      number: row.number as string,
      rarity: (row.rarity as string | null) ?? null,
      images: (row.images as { small?: string }) ?? {},
      set_name: setName ?? '',
    };
  });
}

export async function getIndexSeries(indexId = 'msm100'): Promise<IndexPoint[]> {
  const supabase = createPublicSupabase();
  const { data, error } = await supabase
    .from('market_index_history')
    .select('observed_date, index_value')
    .eq('index_id', indexId)
    .order('observed_date', { ascending: true });
  if (error) throw new Error(`index series: ${error.message}`);
  return (data ?? []).map((row) => ({
    observed_date: row.observed_date as string,
    index_value: num(row.index_value) ?? 0,
  }));
}

export async function getBenchmarkSeries(symbol = 'SPX'): Promise<BenchmarkPoint[]> {
  const supabase = createPublicSupabase();
  const { data, error } = await supabase
    .from('benchmark_history')
    .select('observed_date, close_value')
    .eq('symbol', symbol)
    // Newest first: PostgREST caps a response at 1000 rows, and an ascending
    // read would return the oldest closes and drop the dates the index covers.
    .order('observed_date', { ascending: false })
    .limit(1000);
  if (error) throw new Error(`benchmark series: ${error.message}`);
  return (data ?? []).reverse().map((row) => ({
    observed_date: row.observed_date as string,
    close_value: num(row.close_value) ?? 0,
  }));
}

/** Coerces the listed PostgREST numeric columns to numbers in place. */
function withNumbers<T>(row: Record<string, unknown>, keys: string[]): T {
  const output: Record<string, unknown> = { ...row };
  for (const key of keys) output[key] = num(row[key]);
  return output as T;
}

function normalizeSparkline(value: unknown): SparklinePoint[] {
  if (!Array.isArray(value)) return [];
  return (value as SparklinePoint[]).map((point) => ({ d: point.d, p: num(point.p) ?? 0 }));
}

const MOVER_NUMERIC = [
  'start_price', 'end_price', 'change_pct', 'low_price', 'high_price', 'median_price',
  'sales_total', 'velocity', 'coverage', 'volatility', 'observation_days',
];

export type MoverDirection = 'risers' | 'fallers';

export interface MoversQuery {
  window?: WindowKey;
  grade?: TrackedGrade;
  era?: string;
  direction?: MoverDirection;
  /** Ignore illiquid cards whose "move" is one stale sale. */
  minSales?: number;
  limit?: number;
}

export async function getMovers(query: MoversQuery = {}): Promise<MoverRow[]> {
  const {
    window = '30d',
    grade = 'RAW',
    era,
    direction = 'risers',
    minSales = 5,
    limit = 25,
  } = query;

  const supabase = createPublicSupabase();
  let request = supabase
    .from('card_movers')
    .select('*')
    .eq('window_key', window)
    .eq('grade', grade)
    .gte('sales_total', minSales)
    .not('change_pct', 'is', null)
    .limit(limit);

  if (era && era !== 'all') request = request.eq('era', era);
  request = request.order('change_pct', { ascending: direction === 'fallers' });

  const { data, error } = await request;
  if (error) throw new Error(`movers (${direction}): ${error.message}`);
  return (data ?? []).map((row) => ({
    ...withNumbers<MoverRow>(row, MOVER_NUMERIC),
    sparkline: normalizeSparkline(row.sparkline),
  }));
}

export async function getEras(): Promise<string[]> {
  const supabase = createPublicSupabase();
  const { data, error } = await supabase
    .from('card_movers')
    .select('era, release_date')
    .eq('window_key', '30d')
    .eq('grade', 'RAW');
  if (error) throw new Error(`eras: ${error.message}`);

  const seen = new Map<string, string>();
  for (const row of data ?? []) {
    const era = row.era as string;
    const release = (row.release_date as string | null) ?? '';
    const earliest = seen.get(era);
    if (earliest === undefined || release < earliest) seen.set(era, release);
  }
  return Array.from(seen.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([era]) => era);
}

const DEMAND_NUMERIC = [
  'velocity_30d', 'velocity_90d', 'velocity_365d', 'coverage_365d', 'coverage_90d',
  'sales_365d', 'sales_30d', 'change_30d', 'change_90d', 'change_365d', 'change_all',
  'end_price', 'pace_ratio',
];

export interface DemandQuery {
  grade?: TrackedGrade;
  era?: string;
  window?: WindowKey;
  limit?: number;
}

export async function getDemandGrid(query: DemandQuery = {}): Promise<DemandCell[]> {
  const { grade = 'RAW', era, window = '30d', limit = 240 } = query;
  const orderColumn =
    window === '30d' ? 'sales_30d' : window === '90d' ? 'velocity_90d' : 'sales_365d';

  const supabase = createPublicSupabase();
  let request = supabase
    .from('card_demand_profile')
    .select('*')
    .eq('grade', grade)
    .order(orderColumn, { ascending: false, nullsFirst: false })
    .limit(limit);
  if (era && era !== 'all') request = request.eq('era', era);

  const { data, error } = await request;
  if (error) throw new Error(`demand grid: ${error.message}`);
  return (data ?? []).map((row) => withNumbers<DemandCell>(row, DEMAND_NUMERIC));
}

const SEALED_NUMERIC = [
  'market_price', 'ev_per_pack', 'pull_ev', 'fair_value', 'gap_pct',
  'priced_card_share', 'chase_card_count', 'msrp', 'packs_per_product',
];

export interface SealedQuery {
  productType?: string;
  era?: string;
  sort?: 'discount' | 'premium' | 'value';
  limit?: number;
}

export async function getSealedGaps(query: SealedQuery = {}): Promise<SealedGapRow[]> {
  const { productType, era, sort = 'discount', limit = 120 } = query;
  const supabase = createPublicSupabase();

  let request = supabase
    .from('sealed_value_gap')
    .select('*')
    .not('gap_pct', 'is', null)
    .limit(limit);

  if (productType && productType !== 'all') request = request.eq('product_type', productType);
  if (era && era !== 'all') request = request.eq('era', era);

  if (sort === 'premium') request = request.order('gap_pct', { ascending: false });
  else if (sort === 'value') request = request.order('pull_ev', { ascending: false });
  else request = request.order('gap_pct', { ascending: true });

  const { data, error } = await request;
  if (error) throw new Error(`sealed value gap: ${error.message}`);
  return (data ?? []).map((row) => ({
    ...withNumbers<SealedGapRow>(row, SEALED_NUMERIC),
    sparkline: normalizeSparkline(row.sparkline),
  }));
}

const DRIVER_NUMERIC = [
  'market_price_raw', 'market_price_psa10', 'gem_rate', 'pop_total', 'sales_30d',
  'pull_cost', 'pack_price', 'packs_per_hit', 'peer_median_price', 'peer_count',
  'character_multiplier', 'character_median_price', 'character_card_count',
  'gem_adjusted_value', 'psa10_multiple', 'trade_pace_score', 'composite_score',
];

export async function getValuationDrivers(cardId: string): Promise<ValuationDrivers | null> {
  const supabase = createPublicSupabase();
  const { data, error } = await supabase
    .from('card_valuation_drivers')
    .select('*')
    .eq('card_id', cardId)
    .maybeSingle();
  if (error) throw new Error(`valuation drivers: ${error.message}`);
  return data ? withNumbers<ValuationDrivers>(data, DRIVER_NUMERIC) : null;
}

const INTELLIGENCE_NUMERIC = [
  'market_price_raw', 'fair_value_raw', 'momentum_30d', 'volatility_90d', 'demand_score',
  'scarcity_score', 'liquidity_score', 'composite_score', 'gem_rate', 'pop_total',
  'low_6m', 'high_6m', 'range_position', 'last3_comp_avg', 'sales_30d', 'sales_7d',
  'sales_prev_7d', 'active_days_30d', 'active_listings', 'listings_prior_7d',
  'psa9_price', 'psa10_price', 'grade_ladder_step',
];

export async function getCardIntelligence(cardId: string): Promise<CardIntelligenceRow | null> {
  const supabase = createPublicSupabase();
  const { data, error } = await supabase
    .from('card_intelligence')
    .select('*')
    .eq('card_id', cardId)
    .maybeSingle();
  if (error) throw new Error(`card intelligence: ${error.message}`);
  return data ? withNumbers<CardIntelligenceRow>(data, INTELLIGENCE_NUMERIC) : null;
}

const DISTRIBUTION_NUMERIC = [
  'total_graded', 'gem_rate', 'psa10', 'psa9', 'psa8', 'psa7', 'psa6_and_below',
];

export async function getGradeDistribution(cardId: string): Promise<GradeDistributionRow | null> {
  const supabase = createPublicSupabase();
  const { data, error } = await supabase
    .from('card_grade_distribution')
    .select('*')
    .eq('card_id', cardId)
    .maybeSingle();
  if (error) throw new Error(`grade distribution: ${error.message}`);
  return data ? withNumbers<GradeDistributionRow>(data, DISTRIBUTION_NUMERIC) : null;
}

const PACK_EV_NUMERIC = [
  'ev_per_pack', 'priced_card_share', 'chase_cards', 'gem_rate', 'pack_price',
  'ev_net', 'per_pack_gap', 'roi_pct', 'top3_chase_share',
];

export type PackEvSort = 'roi' | 'ev' | 'pack_price';

export async function getPackEvBoard(sort: PackEvSort = 'roi'): Promise<PackEvRow[]> {
  const supabase = createPublicSupabase();
  const column = sort === 'ev' ? 'ev_net' : sort === 'pack_price' ? 'pack_price' : 'roi_pct';
  const { data, error } = await supabase
    .from('set_pack_ev_board')
    .select('*')
    .order(column, { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw new Error(`pack ev board: ${error.message}`);
  return (data ?? []).map((row) => withNumbers<PackEvRow>(row, PACK_EV_NUMERIC));
}

export interface MarketSummary {
  trackedCards: number;
  undervalued: number;
  medianPremium: number | null;
  topArbitrage: number | null;
  indexLevel: number | null;
  indexChange30d: number | null;
  asOf: string | null;
}

export async function getMarketSummary(): Promise<MarketSummary> {
  const [board, index] = await Promise.all([
    getFairValueBoard({ limit: 500 }),
    getIndexSeries(),
  ]);

  const premiums = board
    .map((row) => row.raw_premium_pct)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  const latest = index.at(-1)?.index_value ?? null;
  const monthAgo = index.at(-31)?.index_value ?? index.at(0)?.index_value ?? null;

  return {
    trackedCards: board.length,
    undervalued: board.filter((row) => (row.raw_premium_pct ?? 0) < 0).length,
    medianPremium: premiums.length ? premiums[Math.floor(premiums.length / 2)] : null,
    topArbitrage: board.reduce<number | null>(
      (best, row) =>
        row.grading_arbitrage_net !== null && (best === null || row.grading_arbitrage_net > best)
          ? row.grading_arbitrage_net
          : best,
      null,
    ),
    indexLevel: latest,
    indexChange30d: latest && monthAgo ? latest / monthAgo - 1 : null,
    asOf: board[0]?.as_of_date ?? null,
  };
}

const MONTHLY_NUMERIC = ['index_value', 'change_pct', 'basket_size', 'avg_price'];

export interface MonthlyPerformanceQuery {
  series?: MonthlySeriesKey;
  basket?: MonthlyBasket;
  era?: string;
}

/** Set × month grid of chain-linked chase-index changes. */
export async function getMonthlyPerformance(
  query: MonthlyPerformanceQuery = {},
): Promise<SetMonthlyCell[]> {
  const { series = 'RAW', basket = 0, era } = query;

  const supabase = createPublicSupabase();
  let request = supabase
    .from('set_monthly_matrix')
    .select('*')
    .eq('series_key', series)
    .eq('basket', basket)
    .order('release_date', { ascending: false })
    .order('month', { ascending: true });

  if (era && era !== 'all') request = request.eq('era', era);

  const { data, error } = await request;
  if (error) throw new Error(`monthly performance: ${error.message}`);
  return (data ?? []).map((row) => withNumbers<SetMonthlyCell>(row, MONTHLY_NUMERIC));
}
