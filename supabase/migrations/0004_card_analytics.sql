-- Daily analytics rollup: caches fair value, investment grade and sparklines so
-- the frontend never has to aggregate price_history at request time.

-- Trailing price windows per card/grade. Refreshed by refresh_card_analytics().
drop materialized view if exists public.card_price_rollup cascade;
create materialized view public.card_price_rollup as
with windows as (
  select
    ph.card_id,
    ph.grade,
    ph.observed_date,
    ph.median_price,
    ph.sale_count,
    max(ph.observed_date) over (partition by ph.card_id, ph.grade) as last_observed_date
  from public.price_history ph
  where ph.observed_date >= current_date - interval '120 days'
    and ph.median_price is not null
)
select
  card_id,
  grade,
  max(last_observed_date) as last_observed_date,
  percentile_cont(0.5) within group (order by median_price)
    filter (where observed_date >= current_date - interval '7 days')  as median_7d,
  percentile_cont(0.5) within group (order by median_price)
    filter (where observed_date >= current_date - interval '30 days') as median_30d,
  percentile_cont(0.5) within group (order by median_price)
    filter (where observed_date >= current_date - interval '90 days') as median_90d,
  avg(median_price) filter (where observed_date >= current_date - interval '30 days') as avg_30d,
  stddev_samp(median_price) filter (where observed_date >= current_date - interval '90 days') as stddev_90d,
  sum(sale_count) filter (where observed_date >= current_date - interval '30 days') as sales_30d,
  sum(sale_count) filter (where observed_date >= current_date - interval '90 days') as sales_90d,
  count(distinct observed_date) filter (where observed_date >= current_date - interval '30 days') as active_days_30d,
  (array_agg(median_price order by observed_date desc))[1] as latest_price,
  (array_agg(median_price order by observed_date))[1] as oldest_price_120d,
  percentile_cont(0.5) within group (order by median_price)
    filter (where observed_date between current_date - interval '60 days'
                                    and current_date - interval '30 days') as median_prev_30d
from windows
group by card_id, grade;

create unique index if not exists card_price_rollup_pk
  on public.card_price_rollup (card_id, grade);

-- Cached per-card analytics, one row per card per day.
create table if not exists public.card_analytics (
  card_id text not null references public.cards (id) on delete cascade,
  as_of_date date not null default current_date,
  market_price_raw numeric(12, 2),
  market_price_psa10 numeric(12, 2),
  fair_value_raw numeric(12, 2),
  fair_value_psa10 numeric(12, 2),
  -- Positive => trading above fair value, negative => below (a "discount").
  raw_premium_pct numeric(8, 4),
  psa10_premium_pct numeric(8, 4),
  momentum_30d numeric(8, 4),
  volatility_90d numeric(8, 4),
  liquidity_score numeric(5, 2),
  demand_score numeric(5, 2),
  scarcity_score numeric(5, 2),
  composite_score numeric(5, 2),
  investment_grade text check (
    investment_grade in ('S+','S','A+','A','B+','B','C+','C','D','F')
  ),
  pop_total integer,
  gem_rate numeric(6, 4),
  sales_30d integer,
  -- Grading arbitrage: PSA 10 clearing price net of raw cost, fees and gem odds.
  grading_arbitrage_net numeric(12, 2),
  -- Trailing 30-day series: [{"d":"2026-08-01","p":123.45}, ...]
  sparkline jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (card_id, as_of_date)
);

create index if not exists card_analytics_grade_idx
  on public.card_analytics (as_of_date desc, investment_grade);
create index if not exists card_analytics_raw_premium_idx
  on public.card_analytics (as_of_date desc, raw_premium_pct);
create index if not exists card_analytics_arbitrage_idx
  on public.card_analytics (as_of_date desc, grading_arbitrage_net desc nulls last);

alter table public.card_analytics enable row level security;

drop policy if exists card_analytics_public_read on public.card_analytics;
create policy card_analytics_public_read on public.card_analytics for select using (true);

-- Latest snapshot per card, which is what the frontend reads.
create or replace view public.card_analytics_latest as
select distinct on (ca.card_id)
  ca.*,
  c.name as card_name,
  c.number as card_number,
  c.rarity,
  c.language,
  c.images,
  c.slug,
  s.id as set_id,
  s.name as set_name,
  s.release_date
from public.card_analytics ca
join public.cards c on c.id = ca.card_id
join public.sets s on s.id = c.set_id
order by ca.card_id, ca.as_of_date desc;

-- Score helpers -------------------------------------------------------------

create or replace function public.clamp_score(value numeric)
returns numeric language sql immutable as $$
  select greatest(0, least(100, coalesce(value, 0)));
$$;

create or replace function public.score_to_letter(score numeric)
returns text language sql immutable as $$
  select case
    when score is null then 'F'
    when score >= 92 then 'S+'
    when score >= 85 then 'S'
    when score >= 78 then 'A+'
    when score >= 70 then 'A'
    when score >= 62 then 'B+'
    when score >= 54 then 'B'
    when score >= 46 then 'C+'
    when score >= 38 then 'C'
    when score >= 25 then 'D'
    else 'F'
  end;
$$;

-- Daily rollup --------------------------------------------------------------

create or replace function public.refresh_card_analytics(
  p_as_of date default current_date,
  p_grading_fee numeric default 25.00,
  p_shipping_fee numeric default 12.00,
  p_sale_fee_pct numeric default 0.13
)
returns integer language plpgsql as $$
declare
  affected integer;
begin
  refresh materialized view public.card_price_rollup;

  with raw as (
    select * from public.card_price_rollup where grade = 'RAW'
  ), psa10 as (
    select * from public.card_price_rollup where grade = 'PSA10'
  ), pop as (
    select distinct on (card_id)
      card_id, total_graded, gem_rate
    from public.population_reports
    where grader = 'PSA'
    order by card_id, snapshot_date desc
  ), spark as (
    select
      ph.card_id,
      jsonb_agg(jsonb_build_object('d', ph.observed_date, 'p', ph.median_price)
                order by ph.observed_date) as series
    from public.price_history ph
    where ph.grade = 'RAW'
      and ph.observed_date > p_as_of - interval '30 days'
      and ph.median_price is not null
    group by ph.card_id
  ), scored as (
    select
      c.id as card_id,
      raw.latest_price as market_price_raw,
      psa10.latest_price as market_price_psa10,
      -- Fair value: recency-weighted blend of trailing medians, so a single
      -- outlier sale cannot drag the anchor price around.
      round((coalesce(raw.median_7d, raw.median_30d, raw.latest_price) * 0.5
           + coalesce(raw.median_30d, raw.median_7d, raw.latest_price) * 0.35
           + coalesce(raw.median_90d, raw.median_30d, raw.latest_price) * 0.15)::numeric, 2) as fair_value_raw,
      round((coalesce(psa10.median_7d, psa10.median_30d, psa10.latest_price) * 0.5
           + coalesce(psa10.median_30d, psa10.median_7d, psa10.latest_price) * 0.35
           + coalesce(psa10.median_90d, psa10.median_30d, psa10.latest_price) * 0.15)::numeric, 2) as fair_value_psa10,
      raw.median_30d as raw_median_30d,
      raw.median_prev_30d as raw_median_prev_30d,
      raw.stddev_90d as raw_stddev_90d,
      raw.sales_30d as raw_sales_30d,
      raw.active_days_30d as raw_active_days_30d,
      pop.total_graded as pop_total,
      pop.gem_rate as gem_rate,
      spark.series as sparkline
    from public.cards c
    join raw on raw.card_id = c.id
    left join psa10 on psa10.card_id = c.id
    left join pop on pop.card_id = c.id
    left join spark on spark.card_id = c.id
  ), metrics as (
    select
      s.*,
      case when s.raw_median_prev_30d > 0
        then round(((s.raw_median_30d - s.raw_median_prev_30d) / s.raw_median_prev_30d)::numeric, 4)
      end as momentum_30d,
      case when s.raw_median_30d > 0
        then round((coalesce(s.raw_stddev_90d, 0) / s.raw_median_30d)::numeric, 4)
      end as volatility_90d,
      -- Liquidity: sales volume plus how many of the last 30 days traded.
      public.clamp_score((
        ln(1 + coalesce(s.raw_sales_30d, 0)) * 18
        + coalesce(s.raw_active_days_30d, 0) * 1.2
      )::numeric) as liquidity_score,
      -- Scarcity: fewer gem copies in circulation scores higher.
      public.clamp_score((
        case when s.pop_total is null then 50
             else 100 - least(100, ln(1 + s.pop_total) * 11)
        end
      )::numeric) as scarcity_score
    from scored s
  ), graded as (
    select
      m.*,
      public.clamp_score(
        m.liquidity_score * 0.45
        + public.clamp_score((50 + coalesce(m.momentum_30d, 0) * 250)::numeric) * 0.35
        + public.clamp_score((100 - coalesce(m.volatility_90d, 0.4) * 200)::numeric) * 0.20
      ) as demand_score
    from metrics m
  )
  insert into public.card_analytics as ca (
    card_id, as_of_date, market_price_raw, market_price_psa10,
    fair_value_raw, fair_value_psa10, raw_premium_pct, psa10_premium_pct,
    momentum_30d, volatility_90d, liquidity_score, demand_score, scarcity_score,
    composite_score, investment_grade, pop_total, gem_rate, sales_30d,
    grading_arbitrage_net, sparkline, updated_at
  )
  select
    g.card_id,
    p_as_of,
    g.market_price_raw,
    g.market_price_psa10,
    g.fair_value_raw,
    g.fair_value_psa10,
    case when g.fair_value_raw > 0
      then round(((g.market_price_raw - g.fair_value_raw) / g.fair_value_raw)::numeric, 4) end,
    case when g.fair_value_psa10 > 0
      then round(((g.market_price_psa10 - g.fair_value_psa10) / g.fair_value_psa10)::numeric, 4) end,
    g.momentum_30d,
    g.volatility_90d,
    g.liquidity_score,
    g.demand_score,
    g.scarcity_score,
    composite.score,
    public.score_to_letter(composite.score),
    g.pop_total,
    g.gem_rate,
    coalesce(g.raw_sales_30d, 0),
    -- Expected net from grading: PSA 10 proceeds weighted by gem odds, less
    -- raw cost, grading and shipping fees and marketplace commission.
    case when g.fair_value_psa10 is not null and g.fair_value_raw is not null then
      round((
        g.fair_value_psa10 * (1 - p_sale_fee_pct) * coalesce(g.gem_rate, 0.35)
        - g.fair_value_raw - p_grading_fee - p_shipping_fee
      )::numeric, 2)
    end,
    coalesce(g.sparkline, '[]'::jsonb),
    now()
  from graded g
  cross join lateral (
    select public.clamp_score(
      (g.demand_score * 0.5 + g.scarcity_score * 0.25 + g.liquidity_score * 0.25)::numeric
    ) as score
  ) composite
  on conflict (card_id, as_of_date) do update set
    market_price_raw = excluded.market_price_raw,
    market_price_psa10 = excluded.market_price_psa10,
    fair_value_raw = excluded.fair_value_raw,
    fair_value_psa10 = excluded.fair_value_psa10,
    raw_premium_pct = excluded.raw_premium_pct,
    psa10_premium_pct = excluded.psa10_premium_pct,
    momentum_30d = excluded.momentum_30d,
    volatility_90d = excluded.volatility_90d,
    liquidity_score = excluded.liquidity_score,
    demand_score = excluded.demand_score,
    scarcity_score = excluded.scarcity_score,
    composite_score = excluded.composite_score,
    investment_grade = excluded.investment_grade,
    pop_total = excluded.pop_total,
    gem_rate = excluded.gem_rate,
    sales_30d = excluded.sales_30d,
    grading_arbitrage_net = excluded.grading_arbitrage_net,
    sparkline = excluded.sparkline,
    updated_at = now();

  get diagnostics affected = row_count;
  return affected;
end $$;
