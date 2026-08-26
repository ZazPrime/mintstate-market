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
TCGdex (Japanese sets)               ├─> sets / cards
eBay Browse + Marketplace Insights  ─┼─> price_history ─┐
PSA population pages (Playwright)   ─┴─> population_reports ─┼─> refresh_card_analytics()
                                                              └─> card_analytics ─> Next.js
                                                                  market_index_history
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
cp .env.example .env.local   # fill in Supabase + eBay credentials
npm run db:migrate           # apply migrations to DATABASE_URL
npm run seed:metadata        # English sets/cards from pokemon-tcg-data
npm run seed:metadata -- --japanese
npm run ingest:market        # real singles prices from JustTCG
npm run ingest:sealed        # sealed catalogue + prices from tcgapi.dev
npm run ingest:prices        # eBay sold listings (requires eBay credentials)
npm run ingest:population    # Playwright, no credentials needed
npm run analytics:refresh    # rebuild card_analytics + the MSM 100 index
npm run dev
```

Without any credentials, `npm run seed:demo` and `npm run seed:sealed-demo` generate deterministic
synthetic price, population and benchmark data (rows are tagged `synthetic`) so the UI can be
exercised end to end.

### Pricing sources

| Source | Feeds | Semantics |
| --- | --- | --- |
| JustTCG (`ingest:market`) | `price_history` raw singles, with the provider's rolling daily history | TCGplayer-derived market prices — `sale_count` stays 0 |
| tcgapi.dev (`ingest:sealed`) | `sealed_products`, `sealed_price_history` (booster boxes, ETBs, bundles, cases) | market/low/median price plus `listing_count` |
| eBay (`ingest:prices`) | `price_history` raw + PSA 10 | actual sold listings, so it populates `sale_count` |

Both catalogue providers cap the free tier at 100 requests/day, so each worker takes a `--budget`
and persists its position in `ingest_cursor`; consecutive daily runs sweep the whole catalogue.
Provider ids are mapped onto local sets/cards/products in the `external_*_map` tables.

### Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public/publishable key used by the frontend |
| `DATABASE_URL` | Postgres connection used by migrations and workers |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | eBay OAuth client credentials |
| `EBAY_ENV` | `production` or `sandbox` |
| `JUSTTCG_API_KEY` | JustTCG key for singles pricing |
| `TCGAPI_KEY` | tcgapi.dev key for the sealed catalogue |

### Scheduling

The workers are plain Node entrypoints, so any scheduler works (cron, GitHub Actions, Vercel Cron):

```
0 5 * * *   npm run ingest:market
15 5 * * *  npm run ingest:sealed
0 6 * * *   npm run ingest:prices
0 7 * * 0   npm run ingest:population
30 7 * * *  npm run analytics:refresh
```

## Frontend modules

- **Overview** (`/`) — market-wide stats, deepest discounts, top grading edges, index vs. S&P 500.
- **Fair Value Engine** (`/fair-value`) — dense sortable table of cards trading below/above fair
  value with a 30-day trailing sparkline per row.
- **Grading Arbitrage** (`/arbitrage`) — raw price + service-tier fees + shipping vs. gem-rate
  weighted PSA 10 proceeds, with adjustable assumptions.
- **Card Intelligence** (`/cards/[cardId]`) — demand durability grade, price/volume history,
  PSA population trend, component scores.
- **Market Index** (`/market-index`) — chain-linked MintState 100 rebased against the S&P 500.

## Scripts

| Command | Description |
| --- | --- |
| `npm run db:migrate [-- --local]` | Apply migrations (checksummed, transactional) |
| `npm run seed:metadata [-- --japanese] [-- --sets=a,b]` | Seed sets and cards |
| `npm run ingest:market [-- --budget=60] [-- --sets=a,b]` | JustTCG singles pricing (resumable) |
| `npm run ingest:sealed [-- --budget=40]` | tcgapi.dev sealed catalogue + pricing (resumable) |
| `npm run ingest:prices [-- --limit=250]` | eBay sold-listing ingestion |
| `npm run ingest:population [-- --limit=50] [-- --headed]` | PSA population scraper |
| `npm run analytics:refresh` | Recompute analytics and the index |
| `npm run seed:demo` / `npm run seed:sealed-demo` | Synthetic market data for local development |
| `npm run lint` / `npm run typecheck` | Static checks |
