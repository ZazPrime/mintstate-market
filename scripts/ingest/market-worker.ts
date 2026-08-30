/**
 * Unified market ingestion: PokemonPriceTracker v2 feeds both singles and
 * sealed products in one sweep.
 *
 *   npm run ingest:market                          # resume the catalogue sweep
 *   npm run ingest:market -- --sets=sv08,sv3pt5    # specific provider sets
 *   npm run ingest:market -- --budget=5000 --days=180 --refresh
 *
 * Singles land in price_history as RAW (TCGplayer Near Mint market series, with
 * the provider's daily sales volume) plus PSA10/PSA9 rows built from eBay sold
 * comps, so graded rows carry genuine sale counts. Sealed products land in
 * sealed_products / sealed_price_history.
 *
 * The plan allows 20,000 API calls/day and a card costs 3 calls with history +
 * eBay data, so pages are fetched 200 at a time and the sweep position is
 * persisted in ingest_cursor to resume across days.
 */
import { bulkUpsert, closePool, getPool } from '../lib/db';
import { loadEnv, requireEnv } from '../lib/env';
import { log } from '../lib/log';
import { cardNumberKey, normalizeKey, setKey, setKeyCandidates } from '../lib/match';
import {
  PokemonPriceTrackerClient,
  gradedSeries,
  rawSeries,
  type PptCard,
} from '../lib/pokemonpricetracker';
import { classifySealedProduct, sealedProductId } from '../lib/sealed-classify';

const SOURCE = 'pokemonpricetracker';
const CURSOR_KEY = 'set_sweep';
const PAGE_SIZE = 50;
const GRADES: Array<{ column: 'PSA10' | 'PSA9' | 'BGS95' | 'CGC10'; providerKey: string }> = [
  { column: 'PSA10', providerKey: 'psa10' },
  { column: 'PSA9', providerKey: 'psa9' },
  { column: 'BGS95', providerKey: 'bgs9_5' },
  { column: 'CGC10', providerKey: 'cgc10' },
];

interface LocalSet {
  id: string;
  name: string;
  release_date: string | null;
}

interface LocalCard {
  id: string;
  name: string;
  number: string;
}

interface QueuedSet {
  external_id: string;
  external_name: string | null;
  set_id: string;
  release_date: string | null;
}

interface CardIndex {
  byNumber: Map<string, LocalCard>;
  byName: Map<string, LocalCard>;
}

function arg(name: string): string | null {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match ? match.split('=').slice(1).join('=') : null;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Maps provider sets onto our English sets by normalised name. */
async function syncSetMap(client: PokemonPriceTrackerClient): Promise<void> {
  const { rows } = await getPool().query<LocalSet>(
    "select id, name, release_date from public.sets where language = 'en'",
  );
  const byKey = new Map<string, string>();
  for (const row of rows) byKey.set(setKey(row.name), row.id);

  const mapRows: unknown[][] = [];
  let offset = 0;
  let total = 0;
  for (;;) {
    const page = await client.listSets(offset);
    total += page.items.length;
    for (const providerSet of page.items) {
      const localId = setKeyCandidates(providerSet.name)
        .map((key) => byKey.get(key))
        .find((id): id is string => Boolean(id));
      if (!localId || providerSet.tcgPlayerNumericId === null) continue;
      mapRows.push([
        SOURCE, String(providerSet.tcgPlayerNumericId), localId, providerSet.name,
      ]);
    }
    offset += page.items.length;
    if (!page.hasMore || page.items.length === 0) break;
  }

  await bulkUpsert({
    table: 'public.external_set_map',
    columns: ['source', 'external_id', 'set_id', 'external_name'],
    rows: mapRows,
    conflictTarget: '(source, external_id)',
    updateColumns: ['set_id', 'external_name'],
  });

  // Drop identifiers left behind by earlier id schemes so the sweep queue holds
  // exactly one entry per set.
  await getPool().query(
    'delete from public.external_set_map where source = $1 and external_id <> all($2)',
    [SOURCE, mapRows.map((row) => row[1])],
  );

  log.info(`set map: ${mapRows.length}/${total} provider sets matched to local sets`);
}

async function indexLocalCards(setId: string): Promise<CardIndex> {
  const { rows } = await getPool().query<LocalCard>(
    "select id, name, number from public.cards where set_id = $1 and language = 'en'",
    [setId],
  );
  const byNumber = new Map<string, LocalCard>();
  const byName = new Map<string, LocalCard>();
  for (const card of rows) {
    byNumber.set(cardNumberKey(card.number), card);
    const nameKey = normalizeKey(card.name);
    if (!byName.has(nameKey)) byName.set(nameKey, card);
  }
  return { byNumber, byName };
}

/** Provider names sometimes append the collector number ("Pikachu - 025/165"). */
function providerCardName(providerCard: PptCard): string {
  return normalizeKey(providerCard.name.replace(/\s+-\s+[\w/]+$/, ''));
}

function matchCard(providerCard: PptCard, index: CardIndex): LocalCard | null {
  const cleanName = providerCardName(providerCard);
  const byNumber = index.byNumber.get(cardNumberKey(providerCard.cardNumber));
  if (byNumber && normalizeKey(byNumber.name) === cleanName) return byNumber;
  return index.byName.get(cleanName) ?? byNumber ?? null;
}

/**
 * A single collector number can have several provider printings — the base card
 * plus pattern variants ("Houndoom (Master Ball Pattern)") that trade at wildly
 * different prices. Only one may feed a local card, otherwise its series flips
 * between printings and reads as a 99% crash. The base printing wins: its name
 * matches the local card exactly, and variants carry a parenthetical suffix.
 */
function preferredPrinting(a: PptCard, b: PptCard, local: LocalCard): PptCard {
  const localName = normalizeKey(local.name);
  const scoreOf = (card: PptCard): number =>
    (providerCardName(card) === localName ? 2 : 0) + (/\(/.test(card.name) ? 0 : 1);
  const scoreA = scoreOf(a);
  const scoreB = scoreOf(b);
  if (scoreA !== scoreB) return scoreA > scoreB ? a : b;
  return (a.prices?.listings ?? 0) >= (b.prices?.listings ?? 0) ? a : b;
}

/** Collapses rows to one per conflict key, keeping the first: several provider
 *  printings can resolve to the same local card, and today's snapshot row (which
 *  carries listing depth) outranks the same day inside a history series. */
function dedupe(rows: unknown[][], keyIndexes: number[]): unknown[][] {
  const byKey = new Map<string, unknown[]>();
  for (const row of rows) {
    const key = keyIndexes.map((i) => String(row[i])).join('|');
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

/**
 * Snapshot rows and Near Mint series rows measure the same card differently and
 * routinely disagree by an order of magnitude. A card enriched by an earlier
 * sweep already owns a series, so laying a fresh snapshot on top of it reads as
 * a one-day crash on the chart; it keeps the series and waits for the next
 * enrichment pass instead. Series rows are the ones without listing depth.
 */
async function dropSnapshotsForSeriesCards(snapshots: Map<string, unknown[]>): Promise<void> {
  if (snapshots.size === 0) return;
  const { rows } = await getPool().query<{ card_id: string }>(
    `select distinct card_id from public.price_history
      where grade = 'RAW' and source = $1 and listing_count is null
        and card_id = any($2::text[])`,
    [SOURCE, Array.from(snapshots.keys())],
  );
  for (const row of rows) snapshots.delete(row.card_id);
}

async function readCursor(): Promise<string | null> {
  const { rows } = await getPool().query<{ cursor_value: string | null }>(
    'select cursor_value from public.ingest_cursor where source = $1 and cursor_key = $2',
    [SOURCE, CURSOR_KEY],
  );
  return rows[0]?.cursor_value ?? null;
}

async function writeCursor(value: string | null, callsUsed: number): Promise<void> {
  await getPool().query(
    `insert into public.ingest_cursor (source, cursor_key, cursor_value, requests_used, last_run_at)
     values ($1, $2, $3, $4, now())
     on conflict (source, cursor_key) do update
       set cursor_value = excluded.cursor_value,
           requests_used = excluded.requests_used,
           last_run_at = excluded.last_run_at`,
    [SOURCE, CURSOR_KEY, value, callsUsed],
  );
}

/**
 * Two tiers per set, because history + graded comps cost 3 calls per card
 * against a 1-call snapshot: every card gets today's market price, and only the
 * most valuable cards get the deep enrichment that feeds the timeline engine.
 */
async function ingestSingles(
  client: PokemonPriceTrackerClient,
  set: QueuedSet,
  days: number,
  enrichLimit: number,
): Promise<{ cards: number; enriched: number; rows: number; unmatched: number }> {
  const index = await indexLocalCards(set.set_id);
  if (index.byNumber.size === 0) return { cards: 0, enriched: 0, rows: 0, unmatched: 0 };

  const priceRows: unknown[][] = [];
  const mapRows: unknown[][] = [];
  const snapshots = new Map<string, unknown[]>();
  const candidates: Array<{ cardId: string; tcgPlayerId: string; market: number }> = [];
  const chosen = new Map<string, { local: LocalCard; card: PptCard }>();
  const today = new Date().toISOString().slice(0, 10);
  let unmatched = 0;
  let offset = 0;

  for (;;) {
    const page = await client.listSetCards(set.external_id, offset, PAGE_SIZE);
    for (const providerCard of page.items) {
      const local = matchCard(providerCard, index);
      if (!local) {
        unmatched += 1;
        continue;
      }
      const current = chosen.get(local.id);
      chosen.set(local.id, {
        local,
        card: current ? preferredPrinting(current.card, providerCard, local) : providerCard,
      });
    }

    offset += page.items.length;
    if (!page.hasMore || page.items.length === 0) break;
    if (client.remaining <= PAGE_SIZE) break;
  }

  for (const { local, card: providerCard } of Array.from(chosen.values())) {
    mapRows.push([SOURCE, providerCard.tcgPlayerId, local.id, providerCard.name]);

    const market = providerCard.prices?.market;
    if (typeof market !== 'number' || market <= 0) continue;
    snapshots.set(local.id, [
      local.id, 'RAW', today, SOURCE, 'USD', 0,
      providerCard.prices?.low ?? null, market, null, market,
      providerCard.prices?.listings ?? providerCard.prices?.sellers ?? null,
    ]);
    candidates.push({ cardId: local.id, tcgPlayerId: providerCard.tcgPlayerId, market });
  }
  const cards = chosen.size;

  const enrichTargets = candidates
    .sort((a, b) => b.market - a.market)
    .slice(0, enrichLimit);

  let enriched = 0;
  for (const target of enrichTargets) {
    if (client.remaining <= 3) break;
    const card = await client.getEnrichedCard(target.tcgPlayerId, days);
    if (!card) continue;
    enriched += 1;

    // The Near Mint series and the snapshot are two different measures of the
    // same card and occasionally disagree by an order of magnitude, which reads
    // as a one-day crash. The series wins so a card's history stays internally
    // consistent; the snapshot only covers cards that were never enriched.
    const series = rawSeries(card);
    if (series.length > 0) snapshots.delete(target.cardId);
    for (const point of series) {
      priceRows.push([
        target.cardId, 'RAW', point.date, SOURCE, 'USD', point.volume,
        null, point.price, null, point.price, null,
      ]);
    }
    for (const grade of GRADES) {
      for (const point of gradedSeries(card, grade.providerKey)) {
        priceRows.push([
          target.cardId, grade.column, point.date, SOURCE, 'USD', point.sales,
          null, point.price, null, point.price, null,
        ]);
      }
    }
  }

  await dropSnapshotsForSeriesCards(snapshots);

  const rows = await bulkUpsert({
    table: 'public.price_history',
    columns: [
      'card_id', 'grade', 'observed_date', 'source', 'currency', 'sale_count',
      'low_price', 'median_price', 'high_price', 'avg_price', 'listing_count',
    ],
    rows: dedupe([...priceRows, ...Array.from(snapshots.values())], [0, 1, 2, 3]),
    conflictTarget: '(card_id, grade, observed_date, source)',
    updateColumns: [
      'sale_count', 'low_price', 'median_price', 'high_price', 'avg_price', 'listing_count',
    ],
  });

  await bulkUpsert({
    table: 'public.external_card_map',
    columns: ['source', 'external_id', 'card_id', 'external_name'],
    rows: dedupe(mapRows, [0, 1]),
    conflictTarget: '(source, external_id)',
    updateColumns: ['card_id', 'external_name'],
  });

  return { cards, enriched, rows, unmatched };
}

async function ingestSealed(
  client: PokemonPriceTrackerClient,
  set: QueuedSet,
  days: number,
): Promise<{ products: number; rows: number; unclassified: number }> {
  interface PendingProduct {
    naturalKey: string;
    externalId: string;
    externalName: string;
    points: Array<{ date: string; price: number }>;
  }

  const productRows: unknown[][] = [];
  const pending: PendingProduct[] = [];
  let unclassified = 0;
  let offset = 0;

  for (;;) {
    const page = await client.listSealedProducts(set.external_id, offset, days, PAGE_SIZE);
    for (const product of page.items) {
      const classified = classifySealedProduct(product.name, set.release_date);
      if (!classified) {
        unclassified += 1;
        continue;
      }

      const naturalKey = `${set.set_id}|${classified.type}|${product.name}`;
      productRows.push([
        sealedProductId(set.set_id, classified.type, product.name), set.set_id, classified.type,
        product.name, classified.packs, classified.cardsPerPack, product.imageCdnUrl400, SOURCE,
      ]);

      const points = (product.priceHistory ?? [])
        .filter((point): point is { date: string; unopenedPrice: number } =>
          typeof point.unopenedPrice === 'number' && point.unopenedPrice > 0)
        .map((point) => ({ date: point.date.slice(0, 10), price: point.unopenedPrice }));
      if (points.length === 0 && typeof product.unopenedPrice === 'number') {
        points.push({
          date: new Date().toISOString().slice(0, 10),
          price: product.unopenedPrice,
        });
      }
      pending.push({
        naturalKey,
        externalId: product.tcgPlayerId,
        externalName: product.name,
        points,
      });
    }

    offset += page.items.length;
    if (!page.hasMore || page.items.length === 0) break;
    if (client.remaining <= PAGE_SIZE * 2) break;
  }

  if (productRows.length === 0) return { products: 0, rows: 0, unclassified };

  // Conflict on the natural key: a product may already exist under a different
  // id (e.g. seeded before this provider was wired up).
  const products = await bulkUpsert({
    table: 'public.sealed_products',
    columns: [
      'id', 'set_id', 'product_type', 'name', 'packs_per_product',
      'cards_per_pack', 'image_url', 'source',
    ],
    rows: dedupe(productRows, [1, 2, 3]),
    conflictTarget: '(set_id, product_type, name)',
    updateColumns: ['packs_per_product', 'cards_per_pack', 'image_url', 'source'],
  });

  const { rows: stored } = await getPool().query<{
    id: string; set_id: string; product_type: string; name: string;
  }>('select id, set_id, product_type, name from public.sealed_products where set_id = $1', [
    set.set_id,
  ]);
  const idByNaturalKey = new Map(
    stored.map((row) => [`${row.set_id}|${row.product_type}|${row.name}`, row.id]),
  );

  const mapRows: unknown[][] = [];
  const priceRows: unknown[][] = [];
  for (const item of pending) {
    const id = idByNaturalKey.get(item.naturalKey);
    if (!id) continue;
    mapRows.push([SOURCE, item.externalId, id, item.externalName]);
    for (const point of item.points) {
      priceRows.push([id, point.date, SOURCE, 'USD', point.price]);
    }
  }

  await bulkUpsert({
    table: 'public.external_product_map',
    columns: ['source', 'external_id', 'product_id', 'external_name'],
    rows: dedupe(mapRows, [0, 1]),
    conflictTarget: '(source, external_id)',
    updateColumns: ['product_id', 'external_name'],
  });

  const rows = await bulkUpsert({
    table: 'public.sealed_price_history',
    columns: ['product_id', 'observed_date', 'source', 'currency', 'median_price'],
    rows: dedupe(priceRows, [0, 1, 2]),
    conflictTarget: '(product_id, observed_date, source)',
    updateColumns: ['median_price'],
  });

  return { products, rows, unclassified };
}

async function refreshAnalytics(): Promise<void> {
  for (const fn of [
    'prune_orphan_analytics',
    'refresh_card_analytics',
    'refresh_window_metrics',
    'refresh_sealed_analytics',
    'refresh_set_monthly_performance',
  ]) {
    await getPool().query(`select public.${fn}()`);
  }
  log.info('analytics rollups refreshed');
}

async function main(): Promise<void> {
  loadEnv();
  const apiKey = requireEnv('POKEMON_PRICE_TRACKER_API_KEY');
  const budget = Number(arg('budget') ?? 15_000);
  const days = Number(arg('days') ?? 90);
  const enrichLimit = Number(arg('enrich') ?? 40);
  const onlySets = arg('sets')?.split(',').map((value) => value.trim()).filter(Boolean) ?? null;
  const doSingles = !flag('sealed-only');
  const doSealed = !flag('singles-only');

  const client = new PokemonPriceTrackerClient(apiKey, budget);
  await syncSetMap(client);

  // Newest sets first: they carry the most price movement per call spent.
  const { rows: mappedSets } = await getPool().query<QueuedSet>(
    `select m.external_id, m.external_name, m.set_id, s.release_date::text as release_date
       from public.external_set_map m
       join public.sets s on s.id = m.set_id
      where m.source = $1
      order by s.release_date desc nulls last, m.external_id`,
    [SOURCE],
  );

  // --sets accepts provider ids, local set ids or set names ("151,twilight masquerade").
  const wanted = onlySets?.map((value) => setKey(value));
  const queue = wanted
    ? mappedSets.filter(
        (row) =>
          wanted.includes(row.external_id) ||
          wanted.includes(setKey(row.set_id)) ||
          setKeyCandidates(row.external_name ?? '').some((key) => wanted.includes(key)),
      )
    : mappedSets;
  if (queue.length === 0) {
    log.warn('no mapped sets to ingest');
    return;
  }

  const cursor = onlySets ? null : await readCursor();
  const resumeIndex = cursor
    ? Math.max(0, queue.findIndex((row) => row.external_id === cursor))
    : 0;

  const totals = {
    cards: 0, enriched: 0, priceRows: 0, unmatched: 0, products: 0, sealedRows: 0,
  };
  let nextCursor: string | null = queue[resumeIndex]?.external_id ?? null;

  for (let index = resumeIndex; index < queue.length; index += 1) {
    const set = queue[index];
    if (client.remaining <= PAGE_SIZE * 3) {
      nextCursor = set.external_id;
      log.warn(`call budget exhausted before ${set.external_id}`);
      break;
    }

    if (doSingles) {
      const result = await ingestSingles(client, set, days, enrichLimit);
      totals.cards += result.cards;
      totals.enriched += result.enriched;
      totals.priceRows += result.rows;
      totals.unmatched += result.unmatched;
    }
    if (doSealed) {
      const result = await ingestSealed(client, set, days);
      totals.products += result.products;
      totals.sealedRows += result.rows;
    }

    log.info(
      `${set.external_id}: ${totals.cards} cards / ${totals.priceRows} price rows, ` +
        `${totals.products} sealed products (${client.used} calls used)`,
    );
    nextCursor = queue[index + 1]?.external_id ?? null;
  }

  if (!onlySets) await writeCursor(nextCursor, client.used);
  if (flag('refresh')) await refreshAnalytics();

  log.info(
    `singles: ${totals.cards} cards (${totals.enriched} enriched with history + graded comps), ` +
      `${totals.priceRows} price rows, ${totals.unmatched} unmatched · ` +
      `sealed: ${totals.products} products, ${totals.sealedRows} price rows`,
  );
  log.info(`PokemonPriceTracker calls consumed: ${client.used}/${budget}`);
  log.info(
    nextCursor
      ? `next run resumes at set ${nextCursor}`
      : 'catalogue sweep complete — next run restarts from the newest set',
  );
}

main()
  .catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
