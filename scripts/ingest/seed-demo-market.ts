/**
 * Generates synthetic price and population history so the analytics layer and
 * frontend can be exercised before live eBay/PSA credentials are available.
 *
 * Every row is written with source `synthetic` / a synthetic source_url, so it
 * can be deleted in one statement once real ingestion takes over:
 *
 *   delete from price_history where source = 'synthetic';
 *
 *   npm run seed:demo -- --cards=120 --days=120
 */
import { bulkUpsert, closePool, getPool } from '../lib/db';
import { log } from '../lib/log';

/** Deterministic PRNG so repeated runs produce the same demo market. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const RARITY_BASE: Record<string, number> = {
  'Rare Holo': 45,
  'Rare Holo EX': 90,
  'Rare Holo GX': 80,
  'Rare Holo V': 25,
  'Rare Holo VMAX': 60,
  'Rare Secret': 140,
  'Rare Rainbow': 120,
  'Rare Ultra': 95,
  'Illustration Rare': 70,
  'Special Illustration Rare': 220,
  'Hyper Rare': 130,
  'Double Rare': 20,
  Promo: 30,
};

async function main() {
  const args = process.argv.slice(2);
  const cardCount = Number(args.find((a) => a.startsWith('--cards='))?.replace('--cards=', '') ?? 120);
  const days = Number(args.find((a) => a.startsWith('--days='))?.replace('--days=', '') ?? 120);

  const { rows: cards } = await getPool().query<{
    id: string; rarity: string | null; release_year: number | null;
  }>(
    `select c.id, c.rarity, extract(year from s.release_date)::int as release_year
       from public.cards c
       join public.sets s on s.id = c.set_id
      where c.language = 'en'
        and c.rarity is not null
        and c.rarity not in ('Common', 'Uncommon')
      -- Deterministic spread across sets and eras rather than newest-first.
      order by md5(c.id)
      limit $1`,
    [cardCount],
  );

  if (cards.length === 0) {
    log.error('no cards found — run `npm run seed:metadata` first');
    process.exitCode = 1;
    return;
  }

  const priceRows: unknown[][] = [];
  const popRows: unknown[][] = [];
  const today = new Date();

  for (const card of cards) {
    const rng = mulberry32(hashString(card.id));
    const vintageMultiplier = card.release_year && card.release_year < 2005 ? 6 : 1;
    let rawPrice = (RARITY_BASE[card.rarity ?? ''] ?? 15) * vintageMultiplier * (0.6 + rng() * 1.2);
    const psaMultiple = 3 + rng() * 6;
    const drift = (rng() - 0.45) * 0.004;
    const vol = 0.02 + rng() * 0.05;
    // Liquidity profile: how often the card actually trades, and how much of
    // the window it has been trading for. Drives the persistence tiers.
    const tradeOdds = 0.08 + rng() ** 1.6 * 0.92;
    const historyDays = rng() < 0.18 ? Math.floor(45 + rng() * 90) : days;
    // Recent flow can diverge from the baseline, producing accelerating and
    // cooling trajectories rather than one flat pace.
    const paceShift = 0.4 + rng() * 1.8;

    for (let offset = Math.min(days, historyDays); offset >= 0; offset -= 1) {
      const date = new Date(today.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
      rawPrice = Math.max(1, rawPrice * (1 + drift + (rng() - 0.5) * vol));
      const psa10Price = rawPrice * psaMultiple;
      const odds = Math.min(1, tradeOdds * (offset <= 45 ? paceShift : 1));
      if (rng() > odds) continue;

      for (const [grade, price] of [['RAW', rawPrice], ['PSA10', psa10Price]] as const) {
        const sales = 1 + Math.floor(rng() * (grade === 'RAW' ? 12 : 4));
        const spread = 0.08 + rng() * 0.12;
        priceRows.push([
          card.id, grade, date, 'synthetic', 'USD', sales,
          (price * (1 - spread)).toFixed(2),
          price.toFixed(2),
          (price * (1 + spread)).toFixed(2),
          price.toFixed(2),
        ]);
      }
    }

    // Population grows slowly; snapshots weekly.
    let total = 200 + Math.floor(rng() * 9000);
    const gemRate = 0.15 + rng() * 0.5;
    for (let offset = days; offset >= 0; offset -= 7) {
      const date = new Date(today.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
      const growth = Math.floor(total * (0.002 + rng() * 0.01));
      total += growth;
      const gem = Math.floor(total * gemRate);
      popRows.push([
        card.id, 'PSA', date, total, gem,
        JSON.stringify({ '10': gem, '9': Math.floor(total * 0.3), '8': Math.floor(total * 0.12) }),
        growth, Math.floor(growth * gemRate), 'synthetic',
      ]);
    }
  }

  const prices = await bulkUpsert({
    table: 'public.price_history',
    columns: [
      'card_id', 'grade', 'observed_date', 'source', 'currency',
      'sale_count', 'low_price', 'median_price', 'high_price', 'avg_price',
    ],
    conflictTarget: '(card_id, grade, observed_date, source)',
    rows: priceRows,
  });

  const pops = await bulkUpsert({
    table: 'public.population_reports',
    columns: [
      'card_id', 'grader', 'snapshot_date', 'total_graded', 'gem_count',
      'grade_counts', 'total_graded_delta', 'gem_count_delta', 'source_url',
    ],
    conflictTarget: '(card_id, grader, snapshot_date)',
    rows: popRows,
  });

  // S&P 500 benchmark series for the market index comparison.
  const benchRows: unknown[][] = [];
  const benchRng = mulberry32(500);
  let spx = 5200;
  for (let offset = days; offset >= 0; offset -= 1) {
    const date = new Date(today.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
    spx *= 1 + 0.0003 + (benchRng() - 0.5) * 0.012;
    benchRows.push(['SPX', date, spx.toFixed(4)]);
  }
  await bulkUpsert({
    table: 'public.benchmark_history',
    columns: ['symbol', 'observed_date', 'close_value'],
    conflictTarget: '(symbol, observed_date)',
    rows: benchRows,
  });

  log.info(`seeded ${prices} price rows, ${pops} population rows, ${benchRows.length} benchmark rows for ${cards.length} cards`);
}

main()
  .catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
