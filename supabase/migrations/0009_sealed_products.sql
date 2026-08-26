-- Sealed product tracking: market prices for boxes/ETBs/cases against the
-- expected value of the singles inside them ("pull cost").

do $$ begin
  create type sealed_product_type as enum (
    'booster_box', 'elite_trainer_box', 'booster_bundle', 'collection_case', 'blister'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.sealed_products (
  id text primary key,
  set_id text not null references public.sets (id) on delete cascade,
  product_type sealed_product_type not null,
  name text not null,
  packs_per_product integer not null check (packs_per_product > 0),
  cards_per_pack integer not null default 10 check (cards_per_pack > 0),
  msrp numeric(12, 2),
  image_url text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sealed_products_unique_per_set unique (set_id, product_type, name)
);

create index if not exists sealed_products_set_idx on public.sealed_products (set_id);

drop trigger if exists sealed_products_touch_updated_at on public.sealed_products;
create trigger sealed_products_touch_updated_at before update on public.sealed_products
  for each row execute function public.touch_updated_at();

create table if not exists public.sealed_price_history (
  id bigserial primary key,
  product_id text not null references public.sealed_products (id) on delete cascade,
  observed_date date not null,
  source text not null default 'ebay',
  currency char(3) not null default 'USD',
  sale_count integer not null default 0 check (sale_count >= 0),
  low_price numeric(12, 2),
  median_price numeric(12, 2),
  high_price numeric(12, 2),
  created_at timestamptz not null default now(),
  constraint sealed_price_history_unique_observation
    unique (product_id, observed_date, source)
);

create index if not exists sealed_price_history_product_date_idx
  on public.sealed_price_history (product_id, observed_date desc);

-- Pull odds per rarity, expressed as "one hit every N packs". Values are the
-- commonly published modern-era rates and can be tuned per era later.
create table if not exists public.rarity_pull_rates (
  rarity text primary key,
  packs_per_hit numeric(10, 3) not null check (packs_per_hit > 0),
  tier text not null default 'hit'
);

insert into public.rarity_pull_rates (rarity, packs_per_hit, tier) values
  ('Rare', 1.0, 'base'),
  ('Rare Holo', 3.0, 'holo'),
  ('Double Rare', 6.0, 'hit'),
  ('Rare Holo V', 6.0, 'hit'),
  ('Rare Holo VMAX', 17.0, 'hit'),
  ('Rare Holo VSTAR', 20.0, 'hit'),
  ('Rare Holo EX', 12.0, 'hit'),
  ('Rare Holo GX', 12.0, 'hit'),
  ('Ultra Rare', 25.0, 'chase'),
  ('Rare Ultra', 25.0, 'chase'),
  ('Illustration Rare', 12.0, 'chase'),
  ('Special Illustration Rare', 60.0, 'chase'),
  ('Rare Rainbow', 60.0, 'chase'),
  ('Rare Secret', 70.0, 'chase'),
  ('Hyper Rare', 90.0, 'chase'),
  ('Rare Shiny', 30.0, 'chase'),
  ('ACE SPEC Rare', 20.0, 'hit'),
  ('Promo', 200.0, 'chase')
on conflict (rarity) do update set
  packs_per_hit = excluded.packs_per_hit,
  tier = excluded.tier;

-- Cached sealed valuation, one row per product per day.
create table if not exists public.sealed_analytics (
  product_id text not null references public.sealed_products (id) on delete cascade,
  as_of_date date not null default current_date,
  market_price numeric(12, 2),
  -- Expected singles value of one pack and of the whole product.
  ev_per_pack numeric(12, 2),
  pull_ev numeric(12, 2),
  -- Pull EV discounted for the friction of actually liquidating the singles.
  fair_value numeric(12, 2),
  -- Positive => sealed trades above the singles it contains.
  gap_pct numeric(10, 4),
  -- Share of the set's hit-rarity cards that have a live market price.
  priced_card_share numeric(6, 4),
  chase_card_count integer,
  confidence text check (confidence in ('high', 'medium', 'low')),
  sparkline jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (product_id, as_of_date)
);

create index if not exists sealed_analytics_gap_idx
  on public.sealed_analytics (as_of_date desc, gap_pct);

alter table public.sealed_products enable row level security;
alter table public.sealed_price_history enable row level security;
alter table public.rarity_pull_rates enable row level security;
alter table public.sealed_analytics enable row level security;

drop policy if exists sealed_products_public_read on public.sealed_products;
create policy sealed_products_public_read on public.sealed_products for select using (true);
drop policy if exists sealed_price_history_public_read on public.sealed_price_history;
create policy sealed_price_history_public_read on public.sealed_price_history for select using (true);
drop policy if exists rarity_pull_rates_public_read on public.rarity_pull_rates;
create policy rarity_pull_rates_public_read on public.rarity_pull_rates for select using (true);
drop policy if exists sealed_analytics_public_read on public.sealed_analytics;
create policy sealed_analytics_public_read on public.sealed_analytics for select using (true);

-- Expected singles value of one pack of a set: for every priced rarity, the
-- average market price of that rarity divided by how many packs it takes to
-- pull one. Cards without a price are excluded and reported via coverage.
create or replace view public.set_pack_ev as
with priced as (
  select
    c.set_id,
    c.rarity,
    r.packs_per_hit,
    r.tier,
    count(*) filter (where a.market_price_raw is not null) as priced_cards,
    count(*) as total_cards,
    avg(a.market_price_raw) as avg_price
  from public.cards c
  join public.rarity_pull_rates r on r.rarity = c.rarity
  left join public.card_analytics_latest a on a.card_id = c.id
  where c.language = 'en'
  group by c.set_id, c.rarity, r.packs_per_hit, r.tier
)
select
  set_id,
  round(sum(coalesce(avg_price, 0) / packs_per_hit)::numeric, 2) as ev_per_pack,
  sum(priced_cards)::int as priced_cards,
  sum(total_cards)::int as hit_cards,
  sum(priced_cards) filter (where tier = 'chase')::int as priced_chase_cards,
  case when sum(total_cards) > 0
    then round((sum(priced_cards)::numeric / sum(total_cards)), 4) end as priced_card_share
from priced
group by set_id;

-- Rebuilds sealed valuations. p_realization_pct models the friction of
-- liquidating singles (fees, shipping, time), so fair value is always below
-- the raw pull EV.
create or replace function public.refresh_sealed_analytics(
  p_as_of date default current_date,
  p_realization_pct numeric default 0.78
)
returns integer language plpgsql as $$
declare
  affected integer;
begin
  with latest_price as (
    select distinct on (product_id)
      product_id, median_price
    from public.sealed_price_history
    where observed_date <= p_as_of
    order by product_id, observed_date desc
  ), spark as (
    select
      product_id,
      jsonb_agg(jsonb_build_object('d', observed_date, 'p', median_price)
                order by observed_date) as series
    from public.sealed_price_history
    where observed_date > p_as_of - interval '90 days'
      and median_price is not null
    group by product_id
  ), valued as (
    select
      p.id as product_id,
      lp.median_price as market_price,
      ev.ev_per_pack,
      round((ev.ev_per_pack * p.packs_per_product)::numeric, 2) as pull_ev,
      round((ev.ev_per_pack * p.packs_per_product * p_realization_pct)::numeric, 2) as fair_value,
      ev.priced_card_share,
      ev.priced_chase_cards,
      spark.series as sparkline
    from public.sealed_products p
    join public.set_pack_ev ev on ev.set_id = p.set_id
    left join latest_price lp on lp.product_id = p.id
    left join spark on spark.product_id = p.id
  )
  insert into public.sealed_analytics as sa (
    product_id, as_of_date, market_price, ev_per_pack, pull_ev, fair_value,
    gap_pct, priced_card_share, chase_card_count, confidence, sparkline, updated_at
  )
  select
    v.product_id,
    p_as_of,
    v.market_price,
    v.ev_per_pack,
    v.pull_ev,
    v.fair_value,
    case when v.fair_value > 0 and v.market_price is not null
      then round(((v.market_price - v.fair_value) / v.fair_value)::numeric, 4) end,
    v.priced_card_share,
    v.priced_chase_cards,
    case
      when coalesce(v.priced_card_share, 0) >= 0.60 and coalesce(v.priced_chase_cards, 0) >= 5 then 'high'
      when coalesce(v.priced_card_share, 0) >= 0.30 then 'medium'
      else 'low'
    end,
    coalesce(v.sparkline, '[]'::jsonb),
    now()
  from valued v
  on conflict (product_id, as_of_date) do update set
    market_price = excluded.market_price,
    ev_per_pack = excluded.ev_per_pack,
    pull_ev = excluded.pull_ev,
    fair_value = excluded.fair_value,
    gap_pct = excluded.gap_pct,
    priced_card_share = excluded.priced_card_share,
    chase_card_count = excluded.chase_card_count,
    confidence = excluded.confidence,
    sparkline = excluded.sparkline,
    updated_at = now();

  get diagnostics affected = row_count;
  return affected;
end $$;

-- What the Sealed Value Gap page reads.
create or replace view public.sealed_value_gap as
select distinct on (sa.product_id)
  sa.*,
  p.name as product_name,
  p.product_type,
  p.packs_per_product,
  p.msrp,
  p.image_url,
  s.id as set_id,
  s.name as set_name,
  s.release_date,
  public.set_era(s.release_date) as era
from public.sealed_analytics sa
join public.sealed_products p on p.id = sa.product_id
join public.sets s on s.id = p.set_id
order by sa.product_id, sa.as_of_date desc;
