-- The refresh functions upsert, so rollup rows survive after their underlying
-- observations are deleted (e.g. a retired price source). Pruning keeps the
-- dashboards from showing cards that no longer have any price data.
create or replace function public.prune_orphan_analytics()
returns integer language plpgsql as $$
declare
  removed integer := 0;
  n integer;
begin
  delete from public.card_window_metrics m
  where not exists (
    select 1 from public.price_history ph
    where ph.card_id = m.card_id
      and ph.grade = m.grade
      and ph.median_price is not null
  );
  get diagnostics n = row_count;
  removed := removed + n;

  delete from public.card_analytics a
  where not exists (
    select 1 from public.price_history ph
    where ph.card_id = a.card_id
      and ph.median_price is not null
  );
  get diagnostics n = row_count;
  removed := removed + n;

  delete from public.sealed_analytics s
  where not exists (
    select 1 from public.sealed_price_history sp
    where sp.product_id = s.product_id
      and sp.median_price is not null
  );
  get diagnostics n = row_count;
  removed := removed + n;

  return removed;
end;
$$;
