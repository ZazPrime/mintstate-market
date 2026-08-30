-- Core TCG metadata: sets and cards, with English <-> Japanese variant linkage.

create extension if not exists "pgcrypto";

do $$ begin
  create type card_language as enum ('en', 'ja');
exception when duplicate_object then null; end $$;

create table if not exists public.sets (
  id text primary key,
  name text not null,
  series text,
  language card_language not null default 'en',
  printed_total integer,
  total integer,
  ptcgo_code text,
  release_date date,
  symbol_url text,
  logo_url text,
  -- Points at the same set in the other language, when a counterpart exists.
  counterpart_set_id text references public.sets (id) on delete set null,
  source text not null default 'pokemon-tcg-data',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sets_language_release_date_idx
  on public.sets (language, release_date desc nulls last);
create index if not exists sets_series_idx on public.sets (series);

create table if not exists public.cards (
  id text primary key,
  set_id text not null references public.sets (id) on delete cascade,
  name text not null,
  number text not null,
  rarity text,
  supertype text,
  subtypes text[] not null default '{}',
  types text[] not null default '{}',
  artist text,
  language card_language not null default 'en',
  national_pokedex_numbers integer[] not null default '{}',
  images jsonb not null default '{}'::jsonb,
  -- Points at the same card in the other language, when a counterpart exists.
  counterpart_card_id text references public.cards (id) on delete set null,
  -- Human/URL friendly identifier, e.g. "base1-4-charizard".
  slug text generated always as (
    id || '-' || lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
  ) stored,
  source text not null default 'pokemon-tcg-data',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cards_set_number_language_key unique (set_id, number, language)
);

create index if not exists cards_set_id_idx on public.cards (set_id);
create index if not exists cards_name_trgm_idx on public.cards (lower(name));
create index if not exists cards_rarity_idx on public.cards (rarity);
create index if not exists cards_slug_idx on public.cards (slug);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists sets_touch_updated_at on public.sets;
create trigger sets_touch_updated_at before update on public.sets
  for each row execute function public.touch_updated_at();

drop trigger if exists cards_touch_updated_at on public.cards;
create trigger cards_touch_updated_at before update on public.cards
  for each row execute function public.touch_updated_at();

-- Metadata is public read-only reference data.
alter table public.sets enable row level security;
alter table public.cards enable row level security;

drop policy if exists sets_public_read on public.sets;
create policy sets_public_read on public.sets for select using (true);

drop policy if exists cards_public_read on public.cards;
create policy cards_public_read on public.cards for select using (true);
