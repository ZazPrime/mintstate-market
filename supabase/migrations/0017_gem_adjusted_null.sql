-- Gem economics has no value without a population snapshot: the coalesced
-- zeros rendered as a fabricated $0.00 gem-adjusted value on every card while
-- population_reports is empty. Null propagates through to an em dash instead.

create or replace view public.card_valuation_drivers as
with base as (
  select
    a.card_id,
    a.card_name,
    a.rarity,
    a.set_id,
    a.set_name,
    a.market_price_raw,
    a.market_price_psa10,
    a.fair_value_raw,
    a.gem_rate,
    a.pop_total,
    a.sales_30d,
    a.composite_score,
    public.set_era(a.release_date) as era,
    public.character_name(a.card_name) as character
  from public.card_analytics_latest a
  where a.market_price_raw is not null
), peers as (
  -- Median price for cards of the same rarity in the same era: the baseline a
  -- character premium is measured against.
  select
    era,
    rarity,
    percentile_cont(0.5) within group (order by market_price_raw) as peer_median_price,
    count(*) as peer_count
  from base
  where rarity is not null
  group by era, rarity
), character_equity as (
  select
    character,
    percentile_cont(0.5) within group (order by market_price_raw) as character_median_price,
    count(*) as character_card_count
  from base
  group by character
), pack_cost as (
  -- Cheapest observed pack price per set, from booster boxes/bundles.
  select
    p.set_id,
    min(coalesce(sph.median_price, p.msrp) / p.packs_per_product) as pack_price
  from public.sealed_products p
  left join lateral (
    select median_price
    from public.sealed_price_history h
    where h.product_id = p.id
    order by h.observed_date desc
    limit 1
  ) sph on true
  where p.product_type in ('booster_box', 'booster_bundle', 'collection_case')
  group by p.set_id
), paced as (
  select
    b.card_id,
    cume_dist() over (partition by b.era order by coalesce(b.sales_30d, 0)) as trade_pace_pct
  from base b
)
select
  b.card_id,
  b.card_name,
  b.character,
  b.era,
  b.rarity,
  b.set_id,
  b.set_name,
  b.market_price_raw,
  b.market_price_psa10,
  b.gem_rate,
  b.pop_total,
  b.sales_30d,
  -- Pull cost: pack price multiplied by the packs needed for one copy.
  round((pc.pack_price * r.packs_per_hit)::numeric, 2) as pull_cost,
  round(pc.pack_price::numeric, 2) as pack_price,
  r.packs_per_hit,
  round(pr.peer_median_price::numeric, 2) as peer_median_price,
  pr.peer_count,
  -- Character demand: how much more (or less) the card fetches than same-era,
  -- same-rarity peers.
  case when pr.peer_median_price > 0
    then round((b.market_price_raw / pr.peer_median_price)::numeric, 3) end as character_multiplier,
  round(ce.character_median_price::numeric, 2) as character_median_price,
  ce.character_card_count,
  -- Gem economics: expected PSA 10 value of one raw copy at the observed gem
  -- rate, and the multiple that represents over the raw price.
  case when b.market_price_psa10 is not null and b.gem_rate is not null
    then round((b.market_price_psa10 * b.gem_rate)::numeric, 2) end as gem_adjusted_value,
  case when b.market_price_raw > 0 and b.market_price_psa10 is not null
    then round((b.market_price_psa10 / b.market_price_raw)::numeric, 2) end as psa10_multiple,
  round((paced.trade_pace_pct * 100)::numeric, 1) as trade_pace_score,
  b.composite_score
from base b
left join peers pr on pr.era = b.era and pr.rarity is not distinct from b.rarity
left join character_equity ce on ce.character = b.character
left join pack_cost pc on pc.set_id = b.set_id
left join public.rarity_pull_rates r on r.rarity = b.rarity
left join paced on paced.card_id = b.card_id;
