-- Track where each benchmark close came from so synthetic series can be purged
-- independently of ingested market data.
alter table public.benchmark_history
  add column if not exists source text not null default 'synthetic';
