-- Multi-window rollups (30D / 90D / 1Y / ALL) over price_history, plus the
-- demand persistence + trajectory classification that drives the heatmap.

-- Era buckets used as a filter dimension across the movers and heatmap views.
create or replace function public.set_era(release_date date)
returns text language sql immutable as $$
  select case
    when release_date is null then 'Unknown'
    when release_date < date '2003-07-01' then 'Vintage (WOTC)'
    when release_date < date '2007-01-01' then 'e-Card / EX'
    when release_date < date '2011-01-01' then 'DP / HGSS'
    when release_date < date '2017-01-01' then 'BW / XY'
    when release_date < date '2020-01-01' then 'Sun & Moon'
    when release_date < date '2023-01-01' then 'Sword & Shield'
    else 'Scarlet & Violet'
  end;
$$;

-- One row per card/grade/window. Refreshed by refresh_window_metrics().
create table if not exists public.card_window_metrics (
  card_id text not null references public.cards (id) on delete cascade,
  grade card_grade not null,
  -- '30d' | '90d' | '365d' | 'all'
  window_key text not null check (window_key in ('30d', '90d', '365d', 'all')),
  as_of_date date not null default current_date,
  start_price numeric(12, 2),
  end_price numeric(12, 2),
  change_pct numeric(10, 4),
  low_price numeric(12, 2),
  high_price numeric(12, 2),
  median_price numeric(12, 2),
  -- Sales in the window and sales per day, so windows stay comparable.
  sales_total integer not null default 0,
  velocity numeric(10, 3),
  -- Share of days in the window with at least one observed sale.
  coverage numeric(6, 4),
  volatility numeric(8, 4),
  observation_days integer not null default 0,
  -- Downsampled series for the window, [{"d":"2026-01-02","p":12.34}, ...].
  sparkline jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (card_id, grade, window_key)
);

create index if not exists card_window_metrics_change_idx
  on public.card_window_metrics (window_key, grade, change_pct desc nulls last);
create index if not exists card_window_metrics_velocity_idx
  on public.card_window_metrics (window_key, grade, velocity desc nulls last);

alter table public.card_window_metrics enable row level security;

drop policy if exists card_window_metrics_public_read on public.card_window_metrics;
create policy card_window_metrics_public_read
  on public.card_window_metrics for select using (true);

-- Rebuilds every window for every card/grade with observed prices.
create or replace function public.refresh_window_metrics(p_as_of date default current_date)
returns integer language plpgsql as $$
declare
  affected integer;
begin
  with windows(window_key, window_days) as (
    values ('30d', 30), ('90d', 90), ('365d', 365), ('all', null)
  ), observations as (
    select
      w.window_key,
      w.window_days,
      ph.card_id,
      ph.grade,
      ph.observed_date,
      ph.median_price,
      ph.sale_count
    from windows w
    join public.price_history ph
      on ph.median_price is not null
     and ph.observed_date <= p_as_of
     and (w.window_days is null
          or ph.observed_date > p_as_of - make_interval(days => w.window_days))
  ), bounded as (
    select
      o.*,
      min(o.observed_date) over card_window as first_date,
      max(o.observed_date) over card_window as last_date
    from observations o
    window card_window as (partition by o.card_id, o.grade, o.window_key)
  ), bucketed as (
    -- Cap each series at ~60 evenly spaced points so wide windows stay cheap
    -- to render; keep the most recent observation in each time bucket.
    select
      b.*,
      row_number() over (
        partition by b.card_id, b.grade, b.window_key,
          width_bucket(
            (b.observed_date - b.first_date)::numeric,
            0,
            greatest(b.last_date - b.first_date, 1)::numeric + 1,
            60)
        order by b.observed_date desc
      ) as bucket_rank
    from bounded b
  ), aggregated as (
    select
      o.card_id,
      o.grade,
      o.window_key,
      min(o.window_days) as window_days,
      (array_agg(o.median_price order by o.observed_date))[1] as start_price,
      (array_agg(o.median_price order by o.observed_date desc))[1] as end_price,
      min(o.median_price) as low_price,
      max(o.median_price) as high_price,
      percentile_cont(0.5) within group (order by o.median_price) as median_price,
      sum(o.sale_count)::int as sales_total,
      stddev_samp(o.median_price) as stddev_price,
      avg(o.median_price) as avg_price,
      count(distinct o.observed_date)::int as observation_days,
      min(o.observed_date) as first_date,
      max(o.observed_date) as last_date,
      jsonb_agg(jsonb_build_object('d', o.observed_date, 'p', o.median_price)
                order by o.observed_date)
        filter (where o.bucket_rank = 1) as sparkline
    from bucketed o
    group by o.card_id, o.grade, o.window_key
  )
  insert into public.card_window_metrics as m (
    card_id, grade, window_key, as_of_date, start_price, end_price, change_pct,
    low_price, high_price, median_price, sales_total, velocity, coverage,
    volatility, observation_days, sparkline, updated_at
  )
  select
    a.card_id,
    a.grade,
    a.window_key,
    p_as_of,
    round(a.start_price, 2),
    round(a.end_price, 2),
    case when a.start_price > 0
      then round(((a.end_price - a.start_price) / a.start_price)::numeric, 4) end,
    round(a.low_price, 2),
    round(a.high_price, 2),
    round(a.median_price::numeric, 2),
    coalesce(a.sales_total, 0),
    round((a.sales_total::numeric / greatest(span.days, 1))::numeric, 3),
    round((a.observation_days::numeric / greatest(span.days, 1))::numeric, 4),
    case when a.avg_price > 0
      then round((coalesce(a.stddev_price, 0) / a.avg_price)::numeric, 4) end,
    a.observation_days,
    coalesce(a.sparkline, '[]'::jsonb),
    now()
  from aggregated a
  cross join lateral (
    select coalesce(a.window_days, (a.last_date - a.first_date) + 1) as days
  ) span
  on conflict (card_id, grade, window_key) do update set
    as_of_date = excluded.as_of_date,
    start_price = excluded.start_price,
    end_price = excluded.end_price,
    change_pct = excluded.change_pct,
    low_price = excluded.low_price,
    high_price = excluded.high_price,
    median_price = excluded.median_price,
    sales_total = excluded.sales_total,
    velocity = excluded.velocity,
    coverage = excluded.coverage,
    volatility = excluded.volatility,
    observation_days = excluded.observation_days,
    sparkline = excluded.sparkline,
    updated_at = now();

  get diagnostics affected = row_count;
  return affected;
end $$;

-- Movers feed: window metrics decorated with the metadata the UI filters on.
create or replace view public.card_movers as
select
  m.card_id,
  m.grade,
  m.window_key,
  m.as_of_date,
  m.start_price,
  m.end_price,
  m.change_pct,
  m.low_price,
  m.high_price,
  m.median_price,
  m.sales_total,
  m.velocity,
  m.coverage,
  m.volatility,
  m.observation_days,
  m.sparkline,
  c.name as card_name,
  c.number as card_number,
  c.rarity,
  c.images,
  s.id as set_id,
  s.name as set_name,
  s.release_date,
  public.set_era(s.release_date) as era
from public.card_window_metrics m
join public.cards c on c.id = m.card_id
join public.sets s on s.id = c.set_id;

-- Demand tracker: persistence tier from how consistently a card trades over a
-- year, trajectory from short-window velocity against the longer baseline.
create or replace view public.card_demand_profile as
with pivoted as (
  select
    m.card_id,
    m.grade,
    max(m.as_of_date) as as_of_date,
    max(m.velocity)   filter (where m.window_key = '30d')  as velocity_30d,
    max(m.velocity)   filter (where m.window_key = '90d')  as velocity_90d,
    max(m.velocity)   filter (where m.window_key = '365d') as velocity_365d,
    max(m.coverage)   filter (where m.window_key = '365d') as coverage_365d,
    max(m.coverage)   filter (where m.window_key = '90d')  as coverage_90d,
    max(m.sales_total) filter (where m.window_key = '365d') as sales_365d,
    max(m.sales_total) filter (where m.window_key = '30d')  as sales_30d,
    max(m.change_pct) filter (where m.window_key = '30d')  as change_30d,
    max(m.change_pct) filter (where m.window_key = '90d')  as change_90d,
    max(m.change_pct) filter (where m.window_key = '365d') as change_365d,
    max(m.change_pct) filter (where m.window_key = 'all')  as change_all,
    max(m.end_price)  filter (where m.window_key = '30d')  as end_price,
    max(m.observation_days) filter (where m.window_key = 'all') as history_days
  from public.card_window_metrics m
  group by m.card_id, m.grade
), classified as (
  select
    p.*,
    case
      when coalesce(p.velocity_90d, 0) = 0 then null
      else round((coalesce(p.velocity_30d, 0) / p.velocity_90d)::numeric, 3)
    end as pace_ratio
  from pivoted p
)
select
  c.card_id,
  c.grade,
  c.as_of_date,
  c.velocity_30d,
  c.velocity_90d,
  c.velocity_365d,
  c.coverage_365d,
  c.coverage_90d,
  c.sales_365d,
  c.sales_30d,
  c.change_30d,
  c.change_90d,
  c.change_365d,
  c.change_all,
  c.end_price,
  c.pace_ratio,
  case
    when coalesce(c.coverage_365d, 0) >= 0.60 and coalesce(c.sales_365d, 0) >= 250 then 'Core'
    when coalesce(c.coverage_365d, 0) >= 0.35 then 'Mainstay'
    when coalesce(c.history_days, 0) <= 120 and coalesce(c.coverage_90d, 0) >= 0.30 then 'Emerging'
    when coalesce(c.pace_ratio, 0) >= 1.5 and coalesce(c.coverage_365d, 0) < 0.35 then 'Emerging'
    else 'Recurring'
  end as persistence_tier,
  case
    when c.pace_ratio is null then 'Dormant'
    when c.pace_ratio >= 1.25 then 'Accelerating'
    when c.pace_ratio >= 0.85 then 'Steady'
    when c.pace_ratio >= 0.50 then 'Cooling'
    else 'Dormant'
  end as trajectory,
  cards.name as card_name,
  cards.number as card_number,
  cards.rarity,
  cards.images,
  s.id as set_id,
  s.name as set_name,
  s.release_date,
  public.set_era(s.release_date) as era
from classified c
join public.cards cards on cards.id = c.card_id
join public.sets s on s.id = cards.set_id;
