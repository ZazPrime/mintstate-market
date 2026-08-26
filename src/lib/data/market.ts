import 'server-only';

import { createPublicSupabase } from '@/lib/supabase/server';
import type {
  BenchmarkPoint,
  CardAnalyticsRow,
  IndexPoint,
  PopulationPoint,
  PricePoint,
  SparklinePoint,
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
    .order('observed_date', { ascending: true });
  if (error) throw new Error(`benchmark series: ${error.message}`);
  return (data ?? []).map((row) => ({
    observed_date: row.observed_date as string,
    close_value: num(row.close_value) ?? 0,
  }));
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
