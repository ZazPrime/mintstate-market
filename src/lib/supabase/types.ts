export type CardGrade = 'RAW' | 'PSA9' | 'PSA10' | 'BGS95' | 'CGC10';
export type CardLanguage = 'en' | 'ja';
export type InvestmentGrade = 'S+' | 'S' | 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';

export interface SparklinePoint {
  d: string;
  p: number | string;
}

export interface CardAnalyticsRow {
  card_id: string;
  as_of_date: string;
  market_price_raw: number | null;
  market_price_psa10: number | null;
  fair_value_raw: number | null;
  fair_value_psa10: number | null;
  raw_premium_pct: number | null;
  psa10_premium_pct: number | null;
  momentum_30d: number | null;
  volatility_90d: number | null;
  liquidity_score: number | null;
  demand_score: number | null;
  scarcity_score: number | null;
  composite_score: number | null;
  investment_grade: InvestmentGrade | null;
  pop_total: number | null;
  gem_rate: number | null;
  sales_30d: number | null;
  grading_arbitrage_net: number | null;
  sparkline: SparklinePoint[];
  updated_at: string;
  card_name: string;
  card_number: string;
  rarity: string | null;
  language: CardLanguage;
  images: { small?: string; large?: string };
  slug: string;
  set_id: string;
  set_name: string;
  release_date: string | null;
}

export interface PricePoint {
  observed_date: string;
  median_price: number | null;
  low_price: number | null;
  high_price: number | null;
  sale_count: number;
  grade: CardGrade;
}

export interface PopulationPoint {
  snapshot_date: string;
  total_graded: number;
  gem_count: number;
  gem_rate: number | null;
}

export interface IndexPoint {
  observed_date: string;
  index_value: number;
}

export interface BenchmarkPoint {
  observed_date: string;
  close_value: number;
}
