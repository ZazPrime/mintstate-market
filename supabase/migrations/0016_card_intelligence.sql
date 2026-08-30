-- Card Intelligence terminal, grading analytics and the per-set pack EV board.
-- Everything here is a view over price_history / population_reports so the
-- frontend keeps reading Supabase only.

-- Trailing price band, sold comps and supply depth per card (raw anchor).
create or replace view public.card_intelligence as
with raw_window as (
  select
    card_id,
    min(median_price) as low_6m,
    max(median_price) as high_6m,
    sum(sale_count) filter (where observed_date > current_date - 30) as sales_30d,
    sum(sale_count) filter (where observed_date > current_date - 7) as sales_7d,
    sum(sale_count) filter (
      where observed_date between current_date - 14 and current_date - 8
    ) as sales_prev_7d,
    count(*) filter (where observed_date > current_date - 30) as active_days_30d
  from public.price_history
  where grade = 'RAW'
    and observed_date > current_date - 183
    and median_price is not null
  group by card_id
), recent_comps as (
  select card_id, avg(median_price) as last3_comp_avg, max(observed_date) as last_sold_date
  from (
    select
      card_id,
      observed_date,
      median_price,
      row_number() over (partition by card_id order by observed_date desc) as rn
    from public.price_history
    where grade = 'RAW' and sale_count > 0 and median_price is not null
  ) ranked
  where rn <= 3
  group by card_id
), listings_now as (
  select distinct on (card_id) card_id, listing_count, observed_date
  from public.price_history
  where grade = 'RAW' and listing_count is not null
  order by card_id, observed_date desc
), listings_prior as (
  select distinct on (card_id) card_id, listing_count
  from public.price_history
  where grade = 'RAW'
    and listing_count is not null
    and observed_date <= current_date - 7
  order by card_id, observed_date desc
), graded as (
  select distinct on (card_id, grade) card_id, grade, median_price
  from public.price_history
  where grade in ('PSA9', 'PSA10') and median_price is not null
  order by card_id, grade, observed_date desc
), graded_pivot as (
  select
    card_id,
    max(median_price) filter (where grade = 'PSA9') as psa9_price,
    max(median_price) filter (where grade = 'PSA10') as psa10_price
  from graded
  group by card_id
)
select
  a.card_id,
  a.card_name,
  a.set_name,
  a.market_price_raw,
  a.fair_value_raw,
  a.momentum_30d,
  a.volatility_90d,
  a.demand_score,
  a.scarcity_score,
  a.liquidity_score,
  a.composite_score,
  a.investment_grade,
  a.gem_rate,
  a.pop_total,
  w.low_6m,
  w.high_6m,
  case when w.high_6m > w.low_6m
    then round(((a.market_price_raw - w.low_6m) / (w.high_6m - w.low_6m))::numeric, 4)
  end as range_position,
  c.last3_comp_avg,
  c.last_sold_date,
  coalesce(w.sales_30d, 0) as sales_30d,
  coalesce(w.sales_7d, 0) as sales_7d,
  coalesce(w.sales_prev_7d, 0) as sales_prev_7d,
  coalesce(w.active_days_30d, 0) as active_days_30d,
  ln.listing_count as active_listings,
  lp.listing_count as listings_prior_7d,
  g.psa9_price,
  g.psa10_price,
  case when g.psa9_price > 0 then round((g.psa10_price / g.psa9_price)::numeric, 3) end
    as grade_ladder_step
from public.card_analytics_latest a
left join raw_window w on w.card_id = a.card_id
left join recent_comps c on c.card_id = a.card_id
left join listings_now ln on ln.card_id = a.card_id
left join listings_prior lp on lp.card_id = a.card_id
left join graded_pivot g on g.card_id = a.card_id;

-- PSA histogram flattened into the buckets the grade matrix renders. Rows only
-- exist once the PSA population worker has run.
create or replace view public.card_grade_distribution as
select
  p.card_id,
  p.snapshot_date,
  p.total_graded,
  p.gem_rate,
  coalesce((p.grade_counts ->> '10')::int, 0) as psa10,
  coalesce((p.grade_counts ->> '9')::int, 0) as psa9,
  coalesce((p.grade_counts ->> '8')::int, 0) as psa8,
  coalesce((p.grade_counts ->> '7')::int, 0) as psa7,
  greatest(
    0,
    p.total_graded
      - coalesce((p.grade_counts ->> '10')::int, 0)
      - coalesce((p.grade_counts ->> '9')::int, 0)
      - coalesce((p.grade_counts ->> '8')::int, 0)
      - coalesce((p.grade_counts ->> '7')::int, 0)
  ) as psa6_and_below
from (
  select distinct on (card_id) *
  from public.population_reports
  where grader = 'PSA'
  order by card_id, snapshot_date desc
) p;

-- Per-set pack economics: what a pack costs on the open market against the
-- expected singles value inside it, plus how concentrated that value is in the
-- set's three biggest chase cards.
create or replace view public.set_pack_ev_board as
with contributions as (
  -- set_pack_ev prices a rarity by its average card, so one card contributes
  -- its price spread across the rarity's card count.
  select
    c.set_id,
    r.tier,
    a.market_price_raw / (r.packs_per_hit * count(*) over (
      partition by c.set_id, c.rarity
    )) as ev_contribution,
    a.gem_rate
  from public.cards c
  join public.rarity_pull_rates r on r.rarity = c.rarity
  left join public.card_analytics_latest a on a.card_id = c.id
  where c.language = 'en'
), top_chase as (
  select set_id, sum(ev_contribution) as top3_ev
  from (
    select
      set_id,
      ev_contribution,
      row_number() over (
        partition by set_id order by ev_contribution desc nulls last
      ) as rn
    from contributions
    where tier = 'chase' and ev_contribution is not null
  ) ranked
  where rn <= 3
  group by set_id
), chase_counts as (
  select
    set_id,
    count(*) filter (where tier = 'chase') as chase_cards,
    avg(gem_rate) as gem_rate
  from contributions
  group by set_id
), pack_price as (
  -- Cheapest per-pack cost across the sealed formats that are purely packs.
  select p.set_id, min(h.median_price / p.packs_per_product) as pack_price
  from public.sealed_products p
  join lateral (
    select median_price
    from public.sealed_price_history h
    where h.product_id = p.id and h.median_price is not null
    order by h.observed_date desc
    limit 1
  ) h on true
  where p.product_type in ('booster_box', 'collection_case', 'booster_bundle')
  group by p.set_id
)
select
  s.id as set_id,
  s.name as set_name,
  s.release_date,
  public.set_era(s.release_date) as era,
  ev.ev_per_pack,
  ev.priced_card_share,
  cc.chase_cards,
  cc.gem_rate,
  round(pp.pack_price::numeric, 2) as pack_price,
  round((ev.ev_per_pack * 0.78)::numeric, 2) as ev_net,
  round((ev.ev_per_pack * 0.78 - pp.pack_price)::numeric, 2) as per_pack_gap,
  case when pp.pack_price > 0
    then round(((ev.ev_per_pack * 0.78 - pp.pack_price) / pp.pack_price)::numeric, 4)
  end as roi_pct,
  case when ev.ev_per_pack > 0
    then round((tc.top3_ev / ev.ev_per_pack)::numeric, 4)
  end as top3_chase_share
from public.sets s
join public.set_pack_ev ev on ev.set_id = s.id
join pack_price pp on pp.set_id = s.id
left join top_chase tc on tc.set_id = s.id
left join chase_counts cc on cc.set_id = s.id;
