-- Grader population snapshots (PSA / BGS / CGC) with derived gem rates.

do $$ begin
  create type grading_company as enum ('PSA', 'BGS', 'CGC');
exception when duplicate_object then null; end $$;

create table if not exists public.population_reports (
  id bigserial primary key,
  card_id text not null references public.cards (id) on delete cascade,
  grader grading_company not null,
  snapshot_date date not null,
  total_graded integer not null check (total_graded >= 0),
  gem_count integer not null default 0 check (gem_count >= 0),
  -- Full histogram, e.g. {"10": 1200, "9": 3400, "8.5": 120}.
  grade_counts jsonb not null default '{}'::jsonb,
  gem_rate numeric(6, 4) generated always as (
    case when total_graded > 0
      then round(gem_count::numeric / total_graded::numeric, 4)
      else null end
  ) stored,
  -- Change vs. the previous snapshot, written by the scraper.
  total_graded_delta integer,
  gem_count_delta integer,
  source_url text,
  created_at timestamptz not null default now(),
  constraint population_reports_unique_snapshot
    unique (card_id, grader, snapshot_date)
);

create index if not exists population_reports_card_grader_date_idx
  on public.population_reports (card_id, grader, snapshot_date desc);

create index if not exists population_reports_date_idx
  on public.population_reports (snapshot_date desc);

alter table public.population_reports enable row level security;

drop policy if exists population_reports_public_read on public.population_reports;
create policy population_reports_public_read on public.population_reports for select using (true);
