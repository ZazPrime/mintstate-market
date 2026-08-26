/**
 * Market pricing worker (singles): pulls real TCGplayer-derived clearing prices
 * from JustTCG and writes them into price_history.
 *
 *   npm run ingest:market -- --budget=60
 *   npm run ingest:market -- --sets=sv08-surging-sparks-pokemon
 *   npm run ingest:market -- --local --budget=10
 *
 * The provider's free tier is capped at 100 requests/day, so the sweep is
 * resumable: the set/offset reached is persisted in ingest_cursor and the next
 * run continues from there. Raw prices only — graded (PSA 10) clearing prices
 * come from the eBay worker, which needs its own credentials.
 */
import { bulkUpsert, closePool, getPool } from '../lib/db';
import { loadEnv, requireEnv } from '../lib/env';
import {
  JustTcgClient,
  dailyPoints,
  pickSingleVariant,
  type JustTcgCard,
} from '../lib/justtcg';
import { log } from '../lib/log';
import { cardNumberKey, normalizeKey, setKey } from '../lib/match';

const SOURCE = 'justtcg';
const CURSOR_KEY = 'set_sweep';

interface LocalSet {
  id: string;
  name: string;
}

interface LocalCard {
  id: string;
  name: string;
  number: string;
}

interface Cursor {
  setId: string | null;
  offset: number;
}

function arg(name: string): string | null {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match ? match.split('=').slice(1).join('=') : null;
}

/** Maps provider sets onto our English sets by normalised name. */
async function syncSetMap(client: JustTcgClient): Promise<void> {
  const providerSets = await client.listSets();
  const { rows } = await getPool().query<LocalSet>(
    "select id, name from public.sets where language = 'en'",
  );

  const byKey = new Map<string, string>();
  for (const row of rows) byKey.set(setKey(row.name), row.id);

  const mapRows: unknown[][] = [];
  for (const providerSet of providerSets) {
    const localId = byKey.get(setKey(providerSet.name));
    if (!localId) continue;
    mapRows.push([SOURCE, providerSet.id, localId, providerSet.name]);
  }

  await bulkUpsert({
    table: 'public.external_set_map',
    columns: ['source', 'external_id', 'set_id', 'external_name'],
    rows: mapRows,
    conflictTarget: '(source, external_id)',
    updateColumns: ['set_id', 'external_name'],
  });

  log.info(
    `set map: ${mapRows.length}/${providerSets.length} provider sets matched to local sets`,
  );
}

async function loadLocalCards(setId: string): Promise<LocalCard[]> {
  const { rows } = await getPool().query<LocalCard>(
    "select id, name, number from public.cards where set_id = $1 and language = 'en'",
    [setId],
  );
  return rows;
}

function indexCards(cards: LocalCard[]): {
  byNumber: Map<string, LocalCard>;
  byName: Map<string, LocalCard>;
} {
  const byNumber = new Map<string, LocalCard>();
  const byName = new Map<string, LocalCard>();
  for (const card of cards) {
    byNumber.set(cardNumberKey(card.number), card);
    const nameKey = normalizeKey(card.name);
    if (!byName.has(nameKey)) byName.set(nameKey, card);
  }
  return { byNumber, byName };
}

function matchCard(
  providerCard: JustTcgCard,
  index: { byNumber: Map<string, LocalCard>; byName: Map<string, LocalCard> },
): LocalCard | null {
  const byNumber = index.byNumber.get(cardNumberKey(providerCard.number));
  if (byNumber && normalizeKey(byNumber.name) === normalizeKey(providerCard.name)) return byNumber;
  return index.byName.get(normalizeKey(providerCard.name)) ?? byNumber ?? null;
}

async function readCursor(): Promise<Cursor> {
  const { rows } = await getPool().query<{ cursor_value: string | null }>(
    'select cursor_value from public.ingest_cursor where source = $1 and cursor_key = $2',
    [SOURCE, CURSOR_KEY],
  );
  if (!rows[0]?.cursor_value) return { setId: null, offset: 0 };
  try {
    const parsed = JSON.parse(rows[0].cursor_value) as Partial<Cursor>;
    return { setId: parsed.setId ?? null, offset: parsed.offset ?? 0 };
  } catch {
    return { setId: null, offset: 0 };
  }
}

async function writeCursor(cursor: Cursor, requestsUsed: number): Promise<void> {
  await getPool().query(
    `insert into public.ingest_cursor (source, cursor_key, cursor_value, requests_used, last_run_at)
     values ($1, $2, $3, $4, now())
     on conflict (source, cursor_key) do update
       set cursor_value = excluded.cursor_value,
           requests_used = excluded.requests_used,
           last_run_at = excluded.last_run_at`,
    [SOURCE, CURSOR_KEY, JSON.stringify(cursor), requestsUsed],
  );
}

async function main(): Promise<void> {
  loadEnv();
  const apiKey = requireEnv('JUSTTCG_API_KEY');
  const budget = Number(arg('budget') ?? 60);
  const onlySets = arg('sets')?.split(',').map((value) => value.trim()).filter(Boolean) ?? null;

  const client = new JustTcgClient(apiKey, budget);
  await syncSetMap(client);

  // Newest sets first: they carry the most price movement per request spent.
  const { rows: orderedSets } = await getPool().query<{ external_id: string; set_id: string }>(
    `select m.external_id, m.set_id
       from public.external_set_map m
       join public.sets s on s.id = m.set_id
      where m.source = $1
      order by s.release_date desc nulls last, m.external_id`,
    [SOURCE],
  );

  const queue = onlySets
    ? orderedSets.filter((row) => onlySets.includes(row.external_id))
    : orderedSets;

  const cursor = onlySets ? { setId: null, offset: 0 } : await readCursor();
  const resumeIndex = cursor.setId
    ? Math.max(0, queue.findIndex((row) => row.external_id === cursor.setId))
    : 0;

  const priceRows: unknown[][] = [];
  const cardMapRows: unknown[][] = [];
  let observedCards = 0;
  let unmatched = 0;
  let finalCursor: Cursor = { setId: queue[resumeIndex]?.external_id ?? null, offset: 0 };

  outer: for (let index = resumeIndex; index < queue.length; index += 1) {
    const { external_id: externalSetId, set_id: localSetId } = queue[index];
    const localCards = await loadLocalCards(localSetId);
    if (localCards.length === 0) continue;
    const cardIndex = indexCards(localCards);

    let offset = index === resumeIndex ? cursor.offset : 0;
    for (;;) {
      if (client.remaining <= 0) {
        finalCursor = { setId: externalSetId, offset };
        log.warn(`request budget exhausted at ${externalSetId} offset ${offset}`);
        break outer;
      }

      const page = await client.listSetCards(externalSetId, offset);
      for (const providerCard of page.cards) {
        const variant = pickSingleVariant(providerCard);
        if (!variant) continue;
        const local = matchCard(providerCard, cardIndex);
        if (!local) {
          unmatched += 1;
          continue;
        }

        cardMapRows.push([SOURCE, providerCard.id, local.id, providerCard.name]);
        const points = dailyPoints(variant);
        const latestDate = points.at(-1)?.date;
        for (const point of points) {
          const isLatest = point.date === latestDate;
          // sale_count stays 0: this feed reports market prices, not sold counts.
          priceRows.push([
            local.id,
            'RAW',
            point.date,
            SOURCE,
            'USD',
            0,
            isLatest ? variant.minPrice7d ?? null : null,
            point.price,
            isLatest ? variant.maxPrice7d ?? null : null,
            point.price,
          ]);
        }
        observedCards += 1;
      }

      offset += page.cards.length;
      if (!page.hasMore || page.cards.length === 0) {
        finalCursor = { setId: queue[index + 1]?.external_id ?? null, offset: 0 };
        break;
      }
    }
  }

  const writtenPrices = await bulkUpsert({
    table: 'public.price_history',
    columns: [
      'card_id', 'grade', 'observed_date', 'source', 'currency', 'sale_count',
      'low_price', 'median_price', 'high_price', 'avg_price',
    ],
    rows: priceRows,
    conflictTarget: '(card_id, grade, observed_date, source)',
    updateColumns: ['sale_count', 'low_price', 'median_price', 'high_price', 'avg_price'],
  });

  await bulkUpsert({
    table: 'public.external_card_map',
    columns: ['source', 'external_id', 'card_id', 'external_name'],
    rows: cardMapRows,
    conflictTarget: '(source, external_id)',
    updateColumns: ['card_id', 'external_name'],
  });

  if (!onlySets) await writeCursor(finalCursor, client.used);

  log.info(
    `priced ${observedCards} cards, wrote ${writtenPrices} price rows (${unmatched} provider cards unmatched)`,
  );
  log.info(`JustTCG usage: ${client.quotaSummary}`);
  log.info(
    finalCursor.setId
      ? `next run resumes at set ${finalCursor.setId} offset ${finalCursor.offset}`
      : 'catalogue sweep complete — next run restarts from the newest set',
  );
}

main()
  .catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
