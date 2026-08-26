/**
 * Pricing worker: pulls eBay sold listings for raw and PSA 10 copies and writes
 * daily median/low/high clearing prices into price_history.
 *
 *   npm run ingest:prices -- --limit=250
 *   npm run ingest:prices -- --cards=base1-4,swsh4-188
 *
 * Intended to run as a daily cron (see vercel.json / README).
 */
import pLimit from 'p-limit';

import { bulkUpsert, closePool, getPool } from '../lib/db';
import { EbayClient, isLikelySingleCard, median, rejectOutliers, type EbaySale } from '../lib/ebay';
import { log } from '../lib/log';

type Grade = 'RAW' | 'PSA10';

interface TargetCard {
  id: string;
  name: string;
  number: string;
  set_name: string;
  release_year: number | null;
}

/**
 * Cards worth spending API calls on: those already tracked, then the newest
 * high-rarity cards. Keeps the daily job inside eBay's call quota.
 */
async function selectTargets(limit: number, cardIds: string[] | null): Promise<TargetCard[]> {
  if (cardIds?.length) {
    const { rows } = await getPool().query<TargetCard>(
      `select c.id, c.name, c.number, s.name as set_name,
              extract(year from s.release_date)::int as release_year
         from public.cards c join public.sets s on s.id = c.set_id
        where c.id = any($1)`,
      [cardIds],
    );
    return rows;
  }

  const { rows } = await getPool().query<TargetCard>(
    `select c.id, c.name, c.number, s.name as set_name,
            extract(year from s.release_date)::int as release_year
       from public.cards c
       join public.sets s on s.id = c.set_id
       left join lateral (
         select max(observed_date) as last_seen
           from public.price_history ph where ph.card_id = c.id
       ) ph on true
      where c.language = 'en'
        and (c.rarity is null or c.rarity not in ('Common', 'Uncommon'))
      order by ph.last_seen asc nulls first, s.release_date desc nulls last
      limit $1`,
    [limit],
  );
  return rows;
}

function buildQuery(card: TargetCard, grade: Grade): string {
  const base = [card.name, card.set_name, card.number].filter(Boolean).join(' ');
  return grade === 'PSA10' ? `${base} PSA 10` : `${base} -PSA -BGS -CGC -graded`;
}

/** Groups sales by day and reduces each day to low/median/high/count. */
function toDailyRows(cardId: string, grade: Grade, source: string, sales: EbaySale[]) {
  const byDay = new Map<string, number[]>();
  for (const sale of sales) {
    if (!isLikelySingleCard(sale.title)) continue;
    if (grade === 'PSA10' && !/psa\s*10/i.test(sale.title)) continue;
    if (grade === 'RAW' && /(psa|bgs|cgc|sgc)\s*\d/i.test(sale.title)) continue;
    const bucket = byDay.get(sale.soldDate) ?? [];
    bucket.push(sale.price);
    byDay.set(sale.soldDate, bucket);
  }

  return Array.from(byDay.entries()).flatMap(([day, rawPrices]) => {
    const prices = rejectOutliers(rawPrices);
    if (prices.length === 0) return [];
    return [[
      cardId,
      grade,
      day,
      source,
      'USD',
      prices.length,
      Math.min(...prices).toFixed(2),
      median(prices)!.toFixed(2),
      Math.max(...prices).toFixed(2),
      (prices.reduce((sum, p) => sum + p, 0) / prices.length).toFixed(2),
    ]];
  });
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const cardsArg = args.find((a) => a.startsWith('--cards='));
  const targetLimit = limitArg ? Number(limitArg.replace('--limit=', '')) : 200;
  const cardIds = cardsArg ? cardsArg.replace('--cards=', '').split(',') : null;

  const client = new EbayClient();
  if (!client.configured) {
    log.error(
      'eBay credentials missing. Set EBAY_CLIENT_ID / EBAY_CLIENT_SECRET, or run ' +
      '`npm run seed:demo` to populate a synthetic price history for local development.',
    );
    process.exitCode = 1;
    return;
  }

  const targets = await selectTargets(targetLimit, cardIds);
  log.info(`pricing ${targets.length} cards`);

  const concurrency = pLimit(Number(process.env.EBAY_CONCURRENCY ?? 3));
  const rows: unknown[][] = [];
  let failures = 0;

  await Promise.all(targets.map((card) => concurrency(async () => {
    for (const grade of ['RAW', 'PSA10'] as Grade[]) {
      try {
        const { sales, source } = await client.soldListings(buildQuery(card, grade), { days: 30 });
        rows.push(...toDailyRows(card.id, grade, source, sales));
      } catch (error) {
        failures += 1;
        log.warn(`${card.id} ${grade}: ${(error as Error).message}`);
      }
    }
  })));

  const written = await bulkUpsert({
    table: 'public.price_history',
    columns: [
      'card_id', 'grade', 'observed_date', 'source', 'currency',
      'sale_count', 'low_price', 'median_price', 'high_price', 'avg_price',
    ],
    conflictTarget: '(card_id, grade, observed_date, source)',
    rows,
  });

  log.info(`wrote ${written} price rows (${failures} query failures)`);
}

main()
  .catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
