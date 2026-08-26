-- Graded comps are sparse and noisy: a constituent can go weeks without a sale
-- and a single cheap copy swings the daily print by tens of percent. Chain
-- linking those raw day-over-day returns compounded the index far past the
-- basket's actual move (and overflowed numeric(14,4)).
--
-- The index is instead chain-linked from a value-weighted basket: each
-- constituent carries its trailing 7-observation average price forward for up
-- to a month, and each day's link compares only the cards priced on both that
-- day and the previous one, so constituents entering or leaving coverage cannot
-- shift the level.
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
  ), smoothed as (
    select
      ph.card_id,
      ph.grade,
      ph.observed_date,
      avg(ph.median_price) over (
        partition by ph.card_id, ph.grade
        order by ph.observed_date
        rows between 6 preceding and current row
      ) as price
    from public.price_history ph
    join members m on m.card_id = ph.card_id and m.grade = ph.grade
    where ph.median_price is not null and ph.median_price > 0
  ), dates as (
    select distinct observed_date from smoothed where observed_date >= v_base_date
  ), grid as (
    select
      d.observed_date,
      m.card_id,
      m.grade,
      m.weight,
      (select s.price
         from smoothed s
        where s.card_id = m.card_id
          and s.grade = m.grade
          and s.observed_date <= d.observed_date
          and s.observed_date > d.observed_date - max_stale_days
        order by s.observed_date desc
        limit 1) as price
    from dates d
    cross join members m
  ), paired as (
    select
      observed_date,
      weight,
      price,
      lag(price) over (partition by card_id, grade order by observed_date) as prev_price
    from grid
    where price is not null
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
