-- Carrying each constituent's last price forward with a correlated subquery
-- re-scanned the whole smoothed price set once per (date, constituent) cell.
-- With the era-spread sweep deepening history the rebuild passed the statement
-- timeout. The carry-forward is now a window-function fill over the same grid,
-- which is linear in the number of cells.
create or replace function public.rebuild_market_index(p_index_id text default 'msm100')
returns integer language plpgsql as $$
declare
  affected integer;
  v_base_date date;
  v_base_value numeric;
  max_stale_days constant integer := 30;
  min_constituents constant integer := 5;
begin
  select base_date, base_value into v_base_date, v_base_value
  from public.market_indices where id = p_index_id;

  if v_base_date is null then
    raise exception 'unknown index %', p_index_id;
  end if;

  delete from public.market_index_history where index_id = p_index_id;

  with members as (
    select card_id, grade, weight
    from public.index_constituents
    where index_id = p_index_id and removed_on is null
  ), observations as (
    select ph.card_id, ph.grade, ph.observed_date, avg(ph.median_price) as median_price
    from public.price_history ph
    join members m on m.card_id = ph.card_id and m.grade = ph.grade
    where ph.median_price is not null and ph.median_price > 0
    group by ph.card_id, ph.grade, ph.observed_date
  ), smoothed as (
    select
      card_id,
      grade,
      observed_date,
      avg(median_price) over (
        partition by card_id, grade
        order by observed_date
        rows between 6 preceding and current row
      ) as price
    from observations
  ), dates as (
    select distinct observed_date from smoothed where observed_date >= v_base_date
  ), grid as (
    select
      d.observed_date,
      m.card_id,
      m.grade,
      m.weight,
      s.price as observed_price,
      s.observed_date as priced_date
    from dates d
    cross join members m
    left join smoothed s
      on s.card_id = m.card_id and s.grade = m.grade and s.observed_date = d.observed_date
  ), runs as (
    select
      grid.*,
      count(observed_price) over (
        partition by card_id, grade order by observed_date
      ) as run
    from grid
  ), filled as (
    select
      observed_date,
      card_id,
      grade,
      weight,
      max(observed_price) over (partition by card_id, grade, run) as price,
      max(priced_date) over (partition by card_id, grade, run) as priced_date
    from runs
  ), carried as (
    select observed_date, card_id, grade, weight, price
    from filled
    where price is not null
      and observed_date - priced_date < max_stale_days
  ), paired as (
    select
      observed_date,
      weight,
      price,
      lag(price) over (partition by card_id, grade order by observed_date) as prev_price
    from carried
  ), links as (
    select
      observed_date,
      sum(weight * price) / sum(weight * prev_price) - 1 as daily_return,
      count(*) as constituent_count
    from paired
    where prev_price is not null
    group by observed_date
    having count(*) >= min_constituents
  ), chained as (
    select
      observed_date,
      constituent_count,
      daily_return,
      v_base_value * exp(sum(ln(1 + daily_return)) over (order by observed_date)) as index_value
    from links
    where daily_return > -1
  )
  insert into public.market_index_history (index_id, observed_date, index_value, daily_return, constituent_count)
  select p_index_id, observed_date, round(index_value, 4), round(daily_return, 6), constituent_count
  from chained;

  get diagnostics affected = row_count;
  return affected;
end $$;
