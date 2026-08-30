# MintState Market

TCG data, portfolio and valuation analytics for the Pokémon TCG market. Fair value modelling,
grading arbitrage, population-adjusted investment grades and a chain-linked market index —
no retail, POS or inventory features.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Shadcn UI · Recharts · Supabase (PostgreSQL) ·
Playwright.

## Architecture

All market data is precomputed by background workers and cached in `card_analytics`, so page loads
never hit a third-party pricing API. The frontend reads only from Supabase.

```
pokemon-tcg-data (GitHub bulk JSON) ─┐
TCGdex (Japanese sets)               ├─> sets / cards              ─┐
PokemonPriceTracker v2 (raw + PSA    ├─> price_history, sealed_*    ├─> refresh_card_analytics()
  10/9 comps, sealed products)       │                              │   card_analytics ─> Next.js
PSA population pages (Playwright)    ┴─> population_reports        ─┘   market_index_history
```

### Schema (`supabase/migrations`)

| Migration | Contents |
| --- | --- |
| `0001_core_metadata` | `sets`, `cards`, EN↔JA variant linkage, language/grade enums |
| `0002_price_history` | daily sales time series, composite + BRIN indexes |
| `0003_population_reports` | PSA/BGS/CGC populations, generated gem rate, deltas |
| `0004_card_analytics` | daily rollup + `refresh_card_analytics()` (fair value, investment grade) |
| `0005_portfolios_rls` | `portfolios`, `portfolio_holdings`, RLS policies, valuation view |
| `0006_market_index` | `market_indices`, constituents, chain-linked `rebuild_market_index()` |
| `0007_relax_card_number_uniqueness` | printed numbers repeat across some sets |

Fair value is a recency-weighted blend of the trailing 7/30/90-day median clearing prices
(50/35/15). The investment grade (S+ → F) is a composite of demand, liquidity, scarcity and
volatility scores.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase + PokemonPriceTracker credentials
npm run db:migrate           # apply migrations to DATABASE_URL
npm run seed:metadata        # English sets/cards from pokemon-tcg-data
npm run seed:metadata -- --japanese
npm run ingest:market        # singles + sealed market data (one sweep)
npm run ingest:population    # Playwright, no credentials needed
npm run analytics:refresh    # rebuild card_analytics + the MSM 100 index
npm run dev
```

Without any credentials, `npm run seed:demo` and `npm run seed:sealed-demo` generate deterministic
synthetic price, population and benchmark data (rows are tagged `synthetic`) so the UI can be
exercised end to end.

### Pricing source

`npm run ingest:market` is the single ingestion service, backed by PokemonPriceTracker v2:

| Feed | Table | Semantics |
| --- | --- | --- |
| TCGplayer Near Mint market series | `price_history` (`RAW`) | daily market price + sales volume |
| eBay sold comps by grade | `price_history` (`PSA10`, `PSA9`) | daily average of completed sales, `sale_count` = sales |
| Sealed catalogue + unopened price series | `sealed_products`, `sealed_price_history` | booster boxes, ETBs, bundles, cases |

Quota is measured in API calls, not HTTP requests: a card costs 3 calls with history and eBay data,
and the plan allows 20,000/day. Pages are fetched 200 at a time, the client tracks the spend the
API reports, and the sweep position is persisted in `ingest_cursor` so consecutive runs continue
through the catalogue. Provider ids are mapped onto local sets/cards/products in the
`external_*_map` tables.

Pack counts are not part of the sealed feed and are derived from the product name and release era
(`scripts/lib/sealed-classify.ts`); they drive the pull-EV model, not the observed prices.

### Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public/publishable key used by the frontend (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is accepted too) |
| `DATABASE_URL` | Postgres connection used by migrations and workers |
| `POKEMON_PRICE_TRACKER_API_KEY` | PokemonPriceTracker v2 key used by the ingestion service |

Only the two `NEXT_PUBLIC_SUPABASE_*` values are needed to build and serve the site; `DATABASE_URL`
and `POKEMON_PRICE_TRACKER_API_KEY` are used exclusively by the migration and ingestion scripts,
which never run in the request path.

### Scheduling

The workers are plain Node entrypoints, so any scheduler works (cron, GitHub Actions, Vercel Cron):

```
0 5 * * *   npm run ingest:market
0 7 * * 0   npm run ingest:population
30 7 * * *  npm run analytics:refresh
```

## Frontend modules

- **Overview** (`/`) — market-wide stats, deepest discounts, top grading edges, index vs. S&P 500.
- **Fair Value Engine** (`/fair-value`) — dense sortable table of cards trading below/above fair
  value with a 30-day trailing sparkline per row.
- **Grading Arbitrage** (`/arbitrage`) — raw price + service-tier fees + shipping vs. gem-rate
  weighted PSA 10 proceeds, with adjustable assumptions.
- **Card Intelligence** (`/cards/[cardId]`) — 6-month price band, last-3 comp average, 0–100
  investment score with demand/scarcity/stability drivers, supply & demand radar with a 30-day
  volume histogram, PSA grade distribution and grading edge, price/volume history.
- **Pack & Sealed EV** (`/sealed-ev`) — set-level pack price vs. expected singles value, per-pack
  gap, ROI and top-3 chase concentration.
- **Market Index** (`/market-index`) — chain-linked MintState 100 rebased against the S&P 500.

## Scripts

| Command | Description |
| --- | --- |
| `npm run db:migrate [-- --local]` | Apply migrations (checksummed, transactional) |
| `npm run seed:metadata [-- --japanese] [-- --sets=a,b]` | Seed sets and cards |
| `npm run ingest:market [-- --budget=15000] [-- --days=90] [-- --sets=a,b] [-- --refresh]` | Singles + sealed ingestion (resumable) |
| `npm run ingest:sealed` | Same worker, sealed products only |
| `npm run ingest:population [-- --limit=50] [-- --headed]` | PSA population scraper |
| `npm run analytics:refresh` | Recompute analytics and the index |
| `npm run seed:demo` / `npm run seed:sealed-demo` | Synthetic market data for local development |
| `npm run lint` / `npm run typecheck` | Static checks |
