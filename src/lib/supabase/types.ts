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

export type WindowKey = '30d' | '90d' | '365d' | 'all';
export type TrackedGrade = Extract<CardGrade, 'RAW' | 'PSA10'>;
export type PersistenceTier = 'Core' | 'Mainstay' | 'Emerging' | 'Recurring';
export type Trajectory = 'Accelerating' | 'Steady' | 'Cooling' | 'Dormant';

export interface MoverRow {
  card_id: string;
  grade: TrackedGrade;
  window_key: WindowKey;
  as_of_date: string;
  start_price: number | null;
  end_price: number | null;
  change_pct: number | null;
  change_abs: number | null;
  low_price: number | null;
  high_price: number | null;
  median_price: number | null;
  sales_total: number | null;
  velocity: number | null;
  coverage: number | null;
  volatility: number | null;
  observation_days: number | null;
  sparkline: SparklinePoint[];
  card_name: string;
  card_number: string;
  rarity: string | null;
  images: { small?: string; large?: string };
  set_id: string;
  set_name: string;
  release_date: string | null;
  era: string;
}

export interface DemandCell {
  card_id: string;
  grade: TrackedGrade;
  velocity_30d: number | null;
  velocity_90d: number | null;
  velocity_365d: number | null;
  coverage_365d: number | null;
  coverage_90d: number | null;
  sales_365d: number | null;
  sales_30d: number | null;
  change_30d: number | null;
  change_90d: number | null;
  change_365d: number | null;
  change_all: number | null;
  end_price: number | null;
  pace_ratio: number | null;
  persistence_tier: PersistenceTier;
  trajectory: Trajectory;
  card_name: string;
  card_number: string;
  rarity: string | null;
  images: { small?: string; large?: string };
  set_id: string;
  set_name: string;
  era: string;
}

export type SealedProductType =
  | 'booster_box'
  | 'elite_trainer_box'
  | 'booster_bundle'
  | 'collection_case'
  | 'blister';

export interface SealedGapRow {
  product_id: string;
  as_of_date: string;
  market_price: number | null;
  ev_per_pack: number | null;
  pull_ev: number | null;
  fair_value: number | null;
  gap_pct: number | null;
  priced_card_share: number | null;
  chase_card_count: number | null;
  confidence: 'high' | 'medium' | 'low' | null;
  sparkline: SparklinePoint[];
  product_name: string;
  product_type: SealedProductType;
  packs_per_product: number;
  msrp: number | null;
  image_url: string | null;
  set_id: string;
  set_name: string;
  release_date: string | null;
  era: string;
}

export interface ValuationDrivers {
  card_id: string;
  card_name: string;
  character: string;
  era: string;
  rarity: string | null;
  set_id: string;
  set_name: string;
  market_price_raw: number | null;
  market_price_psa10: number | null;
  gem_rate: number | null;
  pop_total: number | null;
  sales_30d: number | null;
  pull_cost: number | null;
  pack_price: number | null;
  packs_per_hit: number | null;
  peer_median_price: number | null;
  peer_count: number | null;
  character_multiplier: number | null;
  character_median_price: number | null;
  character_card_count: number | null;
  gem_adjusted_value: number | null;
  psa10_multiple: number | null;
  trade_pace_score: number | null;
  composite_score: number | null;
}

export interface CardIntelligenceRow {
  card_id: string;
  card_name: string;
  set_name: string;
  market_price_raw: number | null;
  fair_value_raw: number | null;
  momentum_30d: number | null;
  volatility_90d: number | null;
  demand_score: number | null;
  scarcity_score: number | null;
  liquidity_score: number | null;
  composite_score: number | null;
  investment_grade: InvestmentGrade | null;
  gem_rate: number | null;
  pop_total: number | null;
  low_6m: number | null;
  high_6m: number | null;
  range_position: number | null;
  last3_comp_avg: number | null;
  last_sold_date: string | null;
  sales_30d: number;
  sales_7d: number;
  sales_prev_7d: number;
  active_days_30d: number;
  active_listings: number | null;
  listings_prior_7d: number | null;
  psa9_price: number | null;
  psa10_price: number | null;
  grade_ladder_step: number | null;
}

export interface GradeDistributionRow {
  card_id: string;
  snapshot_date: string;
  total_graded: number;
  gem_rate: number | null;
  psa10: number;
  psa9: number;
  psa8: number;
  psa7: number;
  psa6_and_below: number;
}

export interface PackEvRow {
  set_id: string;
  set_name: string;
  release_date: string | null;
  era: string;
  ev_per_pack: number | null;
  priced_card_share: number | null;
  chase_cards: number | null;
  gem_rate: number | null;
  pack_price: number | null;
  ev_net: number | null;
  per_pack_gap: number | null;
  roi_pct: number | null;
  top3_chase_share: number | null;
}

export type MonthlySeriesKey = 'RAW' | 'PSA10' | 'SEALED';
/** Chase-basket size; 0 tracks every priced member of the set. */
export type MonthlyBasket = 0 | 5 | 10 | 20;

export interface SetMonthlyCell {
  set_id: string;
  series_key: MonthlySeriesKey;
  basket: MonthlyBasket;
  month: string;
  index_value: number | null;
  change_pct: number | null;
  basket_size: number;
  avg_price: number | null;
  set_name: string;
  series: string | null;
  release_date: string | null;
  era: string;
}
