-- Month-over-month performance of every tracked set's chase-card index, per
-- price series (raw, PSA 10, sealed) and per "top N chase cards" basket.
--
-- The month change is chain-linked on the intersection of cards priced in both
-- months, so a card entering or leaving coverage cannot masquerade as a move.

create table if not exists public.set_monthly_performance (
  set_id text not null references public.sets (id) on delete cascade,
  -- 'RAW' | 'PSA10' | 'SEALED'
  series_key text not null check (series_key in ('RAW', 'PSA10', 'SEALED')),
  -- Size of the chase basket; 0 means every priced card in the set.
  basket integer not null check (basket in (0, 5, 10, 20)),
  month date not null,
  index_value numeric(12, 3),
  change_pct numeric(10, 4),
  basket_size integer not null default 0,
  avg_price numeric(12, 2),
  updated_at timestamptz not null default now(),
  primary key (set_id, series_key, basket, month)
);

create index if not exists set_monthly_performance_series_idx
  on public.set_monthly_performance (series_key, basket, month);

alter table public.set_monthly_performance enable row level security;

drop policy if exists set_monthly_performance_public_read on public.set_monthly_performance;
create policy set_monthly_performance_public_read
  on public.set_monthly_performance for select using (true);

create or replace function public.refresh_set_monthly_performance()
returns void language plpgsql as $$
begin
  delete from public.set_monthly_performance;

  with monthly as (
    -- One price per card, series and month.
    select
      c.set_id,
      ph.card_id as member_id,
      case when ph.grade = 'RAW' then 'RAW' else 'PSA10' end as series_key,
      date_trunc('month', ph.observed_date)::date as month,
      avg(ph.median_price) as price
    from public.price_history ph
    join public.cards c on c.id = ph.card_id
    where ph.median_price is not null
      and ph.grade in ('RAW', 'PSA10')
    group by 1, 2, 3, 4
    union all
    select
      p.set_id,
      sph.product_id as member_id,
      'SEALED' as series_key,
      date_trunc('month', sph.observed_date)::date as month,
      avg(sph.median_price) as price
    from public.sealed_price_history sph
    join public.sealed_products p on p.id = sph.product_id
    where sph.median_price is not null
    group by 1, 2, 3, 4
  ), ranked as (
    -- Chase order: dearest members first, averaged over their whole history so
    -- the basket membership does not flip around month to month.
    select
      set_id,
      member_id,
      series_key,
      row_number() over (
        partition by set_id, series_key order by avg(price) desc, member_id
      ) as chase_rank
    from monthly
    group by set_id, member_id, series_key
  ), baskets as (
    select * from (values (0), (5), (10), (20)) as t (basket)
  ), members as (
    select m.*, b.basket
    from monthly m
    join ranked r
      on r.set_id = m.set_id and r.member_id = m.member_id and r.series_key = m.series_key
    join baskets b on b.basket = 0 or r.chase_rank <= b.basket
  ), paired as (
    -- Only members priced in both months contribute to the link.
    select
      cur.set_id,
      cur.series_key,
      cur.basket,
      cur.month,
      count(*) as basket_size,
      sum(cur.price) as cur_total,
      sum(prev.price) as prev_total
    from members cur
    join members prev
      on prev.set_id = cur.set_id
     and prev.series_key = cur.series_key
     and prev.basket = cur.basket
     and prev.member_id = cur.member_id
     and prev.month = cur.month - interval '1 month'
    group by 1, 2, 3, 4
  ), levels as (
    select
      m.set_id,
      m.series_key,
      m.basket,
      m.month,
      count(*) as month_members,
      avg(m.price) as avg_price,
      case when p.prev_total > 0 then p.cur_total / p.prev_total end as link
    from members m
    left join paired p
      on p.set_id = m.set_id and p.series_key = m.series_key
     and p.basket = m.basket and p.month = m.month
    group by m.set_id, m.series_key, m.basket, m.month, p.prev_total, p.cur_total
  )
  insert into public.set_monthly_performance (
    set_id, series_key, basket, month, index_value, change_pct, basket_size, avg_price, updated_at
  )
  select
    set_id,
    series_key,
    basket,
    month,
    -- Chain the monthly links into an index rebased to 100 at first coverage.
    round((100 * exp(sum(ln(coalesce(link, 1))) over (
      partition by set_id, series_key, basket order by month
    )))::numeric, 3),
    case when link is not null then round(((link - 1) * 100)::numeric, 4) end,
    month_members,
    round(avg_price::numeric, 2),
    now()
  from levels;
end $$;

select public.refresh_set_monthly_performance();
