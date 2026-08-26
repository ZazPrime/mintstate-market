-- Chain-linked market indices for a basket of cards, plus benchmark series
-- (e.g. the S&P 500) so the two can be charted on a common base of 100.

create table if not exists public.market_indices (
  id text primary key,
  name text not null,
  description text,
  base_date date not null,
  base_value numeric(12, 4) not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.index_constituents (
  index_id text not null references public.market_indices (id) on delete cascade,
  card_id text not null references public.cards (id) on delete cascade,
  grade card_grade not null default 'PSA10',
  weight numeric(6, 4) not null default 1 check (weight > 0),
  added_on date not null default current_date,
  removed_on date,
  primary key (index_id, card_id, grade)
);

create index if not exists index_constituents_index_idx
  on public.index_constituents (index_id) where removed_on is null;

-- Chain-linked index level: level_t = level_{t-1} * (1 + weighted daily return).
create table if not exists public.market_index_history (
  index_id text not null references public.market_indices (id) on delete cascade,
  observed_date date not null,
  index_value numeric(14, 4) not null,
  daily_return numeric(10, 6),
  constituent_count integer not null default 0,
  primary key (index_id, observed_date)
);

create index if not exists market_index_history_date_idx
  on public.market_index_history (observed_date desc);

create table if not exists public.benchmark_history (
  symbol text not null,
  observed_date date not null,
  close_value numeric(14, 4) not null,
  primary key (symbol, observed_date)
);

alter table public.market_indices enable row level security;
alter table public.index_constituents enable row level security;
alter table public.market_index_history enable row level security;
alter table public.benchmark_history enable row level security;

drop policy if exists market_indices_public_read on public.market_indices;
create policy market_indices_public_read on public.market_indices for select using (true);
drop policy if exists index_constituents_public_read on public.index_constituents;
create policy index_constituents_public_read on public.index_constituents for select using (true);
drop policy if exists market_index_history_public_read on public.market_index_history;
create policy market_index_history_public_read on public.market_index_history for select using (true);
drop policy if exists benchmark_history_public_read on public.benchmark_history;
create policy benchmark_history_public_read on public.benchmark_history for select using (true);

insert into public.market_indices (id, name, description, base_date)
values (
  'msm100',
  'MintState 100',
  'Weighted basket of the 100 most liquid graded Pokemon TCG cards, chain-linked daily.',
  current_date - interval '365 days'
)
on conflict (id) do nothing;

-- Rebuilds the chain-linked series for an index from price_history.
create or replace function public.rebuild_market_index(p_index_id text default 'msm100')
returns integer language plpgsql as $$
declare
  affected integer;
  v_base_date date;
  v_base_value numeric;
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
  ), series as (
    select
      ph.observed_date,
      m.card_id,
      m.weight,
      ph.median_price,
      lag(ph.median_price) over (
        partition by ph.card_id, ph.grade order by ph.observed_date
      ) as prev_price
    from public.price_history ph
    join members m on m.card_id = ph.card_id and m.grade = ph.grade
    where ph.observed_date >= v_base_date and ph.median_price is not null
  ), daily as (
    select
      observed_date,
      sum(weight * (median_price / prev_price - 1)) / sum(weight) as daily_return,
      count(*) as constituent_count
    from series
    where prev_price is not null and prev_price > 0
    group by observed_date
  ), chained as (
    select
      observed_date,
      daily_return,
      constituent_count,
      v_base_value * exp(sum(ln(1 + daily_return)) over (order by observed_date)) as index_value
    from daily
    where daily_return > -1
  )
  insert into public.market_index_history (index_id, observed_date, index_value, daily_return, constituent_count)
  select p_index_id, observed_date, round(index_value, 4), round(daily_return, 6), constituent_count
  from chained;

  get diagnostics affected = row_count;
  return affected;
end $$;
