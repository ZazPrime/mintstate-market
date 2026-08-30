-- User portfolios (collection logging) with row level security.

create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'My Collection',
  base_currency char(3) not null default 'USD',
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolios_user_name_key unique (user_id, name)
);

create index if not exists portfolios_user_id_idx on public.portfolios (user_id);

create table if not exists public.portfolio_holdings (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  card_id text not null references public.cards (id) on delete restrict,
  grade card_grade not null default 'RAW',
  quantity integer not null default 1 check (quantity > 0),
  cost_basis numeric(12, 2) check (cost_basis >= 0),
  acquired_on date,
  cert_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portfolio_holdings_portfolio_idx
  on public.portfolio_holdings (portfolio_id);
create index if not exists portfolio_holdings_card_idx
  on public.portfolio_holdings (card_id, grade);

drop trigger if exists portfolios_touch_updated_at on public.portfolios;
create trigger portfolios_touch_updated_at before update on public.portfolios
  for each row execute function public.touch_updated_at();

drop trigger if exists portfolio_holdings_touch_updated_at on public.portfolio_holdings;
create trigger portfolio_holdings_touch_updated_at before update on public.portfolio_holdings
  for each row execute function public.touch_updated_at();

alter table public.portfolios enable row level security;
alter table public.portfolio_holdings enable row level security;

drop policy if exists portfolios_select_own on public.portfolios;
create policy portfolios_select_own on public.portfolios for select
  using (auth.uid() = user_id or is_public);

drop policy if exists portfolios_insert_own on public.portfolios;
create policy portfolios_insert_own on public.portfolios for insert
  with check (auth.uid() = user_id);

drop policy if exists portfolios_update_own on public.portfolios;
create policy portfolios_update_own on public.portfolios for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists portfolios_delete_own on public.portfolios;
create policy portfolios_delete_own on public.portfolios for delete
  using (auth.uid() = user_id);

drop policy if exists holdings_select_own on public.portfolio_holdings;
create policy holdings_select_own on public.portfolio_holdings for select
  using (exists (
    select 1 from public.portfolios p
    where p.id = portfolio_id and (p.user_id = auth.uid() or p.is_public)
  ));

drop policy if exists holdings_insert_own on public.portfolio_holdings;
create policy holdings_insert_own on public.portfolio_holdings for insert
  with check (exists (
    select 1 from public.portfolios p
    where p.id = portfolio_id and p.user_id = auth.uid()
  ));

drop policy if exists holdings_update_own on public.portfolio_holdings;
create policy holdings_update_own on public.portfolio_holdings for update
  using (exists (
    select 1 from public.portfolios p
    where p.id = portfolio_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.portfolios p
    where p.id = portfolio_id and p.user_id = auth.uid()
  ));

drop policy if exists holdings_delete_own on public.portfolio_holdings;
create policy holdings_delete_own on public.portfolio_holdings for delete
  using (exists (
    select 1 from public.portfolios p
    where p.id = portfolio_id and p.user_id = auth.uid()
  ));

-- Portfolio valuation against the latest cached analytics.
create or replace view public.portfolio_valuations as
select
  h.portfolio_id,
  h.id as holding_id,
  h.card_id,
  h.grade,
  h.quantity,
  h.cost_basis,
  case h.grade
    when 'PSA10' then ca.market_price_psa10
    else ca.market_price_raw
  end as unit_market_price,
  case h.grade
    when 'PSA10' then ca.market_price_psa10
    else ca.market_price_raw
  end * h.quantity as market_value,
  ca.investment_grade,
  ca.as_of_date
from public.portfolio_holdings h
left join public.card_analytics_latest ca on ca.card_id = h.card_id;
