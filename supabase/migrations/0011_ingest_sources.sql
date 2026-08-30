-- External provider linkage + resumable ingestion cursors.
--
-- The pricing providers (JustTCG, tcgapi.dev) have their own set/card/product
-- identifiers and daily request quotas, so we persist the id mapping once and
-- keep a cursor per source to resume the catalogue sweep on the next run
-- instead of paying for the same lookups again.

create table if not exists public.external_set_map (
  source text not null,
  external_id text not null,
  set_id text not null references public.sets (id) on delete cascade,
  external_name text,
  updated_at timestamptz not null default now(),
  primary key (source, external_id)
);

create index if not exists external_set_map_set_idx on public.external_set_map (set_id);

create table if not exists public.external_card_map (
  source text not null,
  external_id text not null,
  card_id text not null references public.cards (id) on delete cascade,
  external_name text,
  updated_at timestamptz not null default now(),
  primary key (source, external_id)
);

create index if not exists external_card_map_card_idx on public.external_card_map (card_id);

create table if not exists public.external_product_map (
  source text not null,
  external_id text not null,
  product_id text not null references public.sealed_products (id) on delete cascade,
  external_name text,
  updated_at timestamptz not null default now(),
  primary key (source, external_id)
);

create index if not exists external_product_map_product_idx
  on public.external_product_map (product_id);

-- One row per (source, cursor) so a quota-limited worker can pick up where the
-- previous run stopped.
create table if not exists public.ingest_cursor (
  source text not null,
  cursor_key text not null,
  cursor_value text,
  requests_used integer not null default 0,
  last_run_at timestamptz not null default now(),
  primary key (source, cursor_key)
);

-- Ingestion bookkeeping is internal: RLS on with no policy denies anon/authed
-- clients while the workers connect over the service role / direct Postgres.
alter table public.external_set_map enable row level security;
alter table public.external_card_map enable row level security;
alter table public.external_product_map enable row level security;
alter table public.ingest_cursor enable row level security;
