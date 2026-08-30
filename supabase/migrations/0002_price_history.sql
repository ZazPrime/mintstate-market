-- Daily market-clearing prices per card and grade, sourced from sold listings.

do $$ begin
  create type card_grade as enum ('RAW', 'PSA9', 'PSA10', 'BGS95', 'CGC10');
exception when duplicate_object then null; end $$;

create table if not exists public.price_history (
  id bigserial primary key,
  card_id text not null references public.cards (id) on delete cascade,
  grade card_grade not null,
  observed_date date not null,
  source text not null default 'ebay',
  currency char(3) not null default 'USD',
  sale_count integer not null default 0 check (sale_count >= 0),
  low_price numeric(12, 2),
  median_price numeric(12, 2),
  high_price numeric(12, 2),
  avg_price numeric(12, 2),
  created_at timestamptz not null default now(),
  constraint price_history_unique_observation
    unique (card_id, grade, observed_date, source)
);

-- Composite index driving the hot path: trailing window for one card/grade.
create index if not exists price_history_card_grade_date_idx
  on public.price_history (card_id, grade, observed_date desc);

-- Drives market-wide daily rollups.
create index if not exists price_history_date_grade_idx
  on public.price_history (observed_date desc, grade);

create index if not exists price_history_date_brin_idx
  on public.price_history using brin (observed_date);

alter table public.price_history enable row level security;

drop policy if exists price_history_public_read on public.price_history;
create policy price_history_public_read on public.price_history for select using (true);
