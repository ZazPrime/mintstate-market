-- Movers ranked purely on percent move are dominated by bulk: a $0.40 common
-- doubling outranks a $300 chase card adding $45. Expose the dollar move so the
-- feed can rank on it, and so the UI can show what a move is actually worth.
-- Adding a column mid-list means the view has to be dropped, not replaced.
drop view if exists public.card_movers;

create view public.card_movers as
select
  m.card_id,
  m.grade,
  m.window_key,
  m.as_of_date,
  m.start_price,
  m.end_price,
  m.change_pct,
  m.end_price - m.start_price as change_abs,
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
