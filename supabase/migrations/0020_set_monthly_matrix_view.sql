-- Set metadata joined onto the monthly performance rollup, so the heatmap can
-- group rows by era and label them without a second round trip.

create or replace view public.set_monthly_matrix as
select
  p.set_id,
  p.series_key,
  p.basket,
  p.month,
  p.index_value,
  p.change_pct,
  p.basket_size,
  p.avg_price,
  s.name as set_name,
  s.series,
  s.release_date,
  public.set_era(s.release_date) as era
from public.set_monthly_performance p
join public.sets s on s.id = p.set_id;
