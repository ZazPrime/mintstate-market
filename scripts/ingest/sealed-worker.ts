/**
 * Sealed product worker: pulls the real TCGplayer sealed catalogue and its
 * current market/low/median prices from tcgapi.dev into sealed_products and
 * sealed_price_history.
 *
 *   npm run ingest:sealed -- --budget=40
 *   npm run ingest:sealed -- --local --queries=booster box
 *
 * The provider's free tier allows 100 requests/day at 50 results per page, so
 * the query sweep is resumable through ingest_cursor. Pack counts are not part
 * of the catalogue feed and are derived from the product type and release era
 * (see PACK_COUNTS) — they drive the pull-EV model, not the observed prices.
 */
import { bulkUpsert, closePool, getPool } from '../lib/db';
import { loadEnv, requireEnv } from '../lib/env';
import { log } from '../lib/log';
import { setKey } from '../lib/match';
import { TcgApiClient, type TcgApiProduct } from '../lib/tcgapi';

const SOURCE = 'tcgapi.dev';
const CURSOR_KEY = 'sealed_sweep';

const DEFAULT_QUERIES = [
  'booster box',
  'elite trainer box',
  'booster bundle',
  'build and battle box',
];

type ProductType =
  | 'booster_box'
  | 'elite_trainer_box'
  | 'booster_bundle'
  | 'collection_case'
  | 'blister';

interface LocalSet {
  id: string;
  name: string;
  release_date: string | null;
}

interface Observation {
  naturalKey: string;
  externalId: string;
  externalName: string;
  low: number | null;
  median: number | null;
  high: number | null;
  listings: number;
}

interface ClassifiedProduct {
  type: ProductType;
  packs: number;
  cardsPerPack: number;
}

/** Packs per product. Boxes and bundles are stable across eras; ETB pack counts
 *  moved from 8 to 9 with Scarlet & Violet; cases hold 6 boxes or 10 of the
 *  smaller products. */
function classify(name: string, releaseDate: string | null): ClassifiedProduct | null {
  const lower = name.toLowerCase();
  if (lower.includes('display')) return null; // Retailer display packaging, not a sealed unit we model.

  const modernEtb = (releaseDate ?? '') >= '2023-01-01';
  const etbPacks = modernEtb ? 9 : 8;
  const cardsPerPack = (releaseDate ?? '') >= '2020-01-01' ? 10 : 11;
  const isCase = lower.includes('case');

  if (lower.includes('elite trainer box')) {
    return isCase
      ? { type: 'collection_case', packs: etbPacks * 10, cardsPerPack }
      : { type: 'elite_trainer_box', packs: etbPacks, cardsPerPack };
  }
  if (lower.includes('booster bundle')) {
    return isCase
      ? { type: 'collection_case', packs: 6 * 10, cardsPerPack }
      : { type: 'booster_bundle', packs: 6, cardsPerPack };
  }
  if (lower.includes('booster box') || lower.includes('booster case')) {
    const boxPacks = lower.includes('half booster box') ? 18 : 36;
    return isCase
      ? { type: 'collection_case', packs: boxPacks * 6, cardsPerPack }
      : { type: 'booster_box', packs: boxPacks, cardsPerPack };
  }
  if (lower.includes('build and battle box') || lower.includes('build & battle')) {
    return isCase
      ? { type: 'collection_case', packs: 4 * 10, cardsPerPack }
      : { type: 'blister', packs: 4, cardsPerPack };
  }
  if (lower.includes('blister') || lower.includes('checklane')) {
    return { type: 'blister', packs: 3, cardsPerPack };
  }
  return null;
}

function arg(name: string): string | null {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match ? match.split('=').slice(1).join('=') : null;
}

function productId(setId: string, type: ProductType, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${setId}-${type}-${slug}`.slice(0, 200);
}

async function readCursorIndex(): Promise<number> {
  const { rows } = await getPool().query<{ cursor_value: string | null }>(
    'select cursor_value from public.ingest_cursor where source = $1 and cursor_key = $2',
    [SOURCE, CURSOR_KEY],
  );
  const parsed = Number(rows[0]?.cursor_value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

async function writeCursorIndex(index: number, requestsUsed: number): Promise<void> {
  await getPool().query(
    `insert into public.ingest_cursor (source, cursor_key, cursor_value, requests_used, last_run_at)
     values ($1, $2, $3, $4, now())
     on conflict (source, cursor_key) do update
       set cursor_value = excluded.cursor_value,
           requests_used = excluded.requests_used,
           last_run_at = excluded.last_run_at`,
    [SOURCE, CURSOR_KEY, String(index), requestsUsed],
  );
}

async function main(): Promise<void> {
  loadEnv();
  const apiKey = requireEnv('TCGAPI_KEY');
  const budget = Number(arg('budget') ?? 40);
  const queries = arg('queries')?.split(',').map((value) => value.trim()).filter(Boolean)
    ?? DEFAULT_QUERIES;

  const client = new TcgApiClient(apiKey, budget);

  const { rows: localSets } = await getPool().query<LocalSet>(
    "select id, name, release_date from public.sets where language = 'en'",
  );
  const setsByKey = new Map<string, LocalSet>();
  for (const set of localSets) setsByKey.set(setKey(set.name), set);

  const observedDate = new Date().toISOString().slice(0, 10);
  const productRows: unknown[][] = [];
  const observations: Observation[] = [];
  const seenProducts = new Set<string>();
  let unmatchedSets = 0;
  let unclassified = 0;

  // Each query is swept page by page; the cursor records which query index the
  // previous run stopped on so a 100/day quota still covers the catalogue.
  const startIndex = arg('queries') ? 0 : await readCursorIndex() % queries.length;
  let queryIndex = startIndex;
  let completed = 0;

  sweep: while (completed < queries.length) {
    const query = queries[queryIndex % queries.length];
    let page = 1;
    for (;;) {
      if (client.remaining <= 0) {
        log.warn(`request budget exhausted during "${query}" page ${page}`);
        break sweep;
      }

      const { products, hasMore } = await client.search(query, page);
      for (const product of products) {
        if (product.product_type !== 'Sealed Products') continue;
        const set = setsByKey.get(setKey(product.set_name));
        if (!set) {
          unmatchedSets += 1;
          continue;
        }
        const classified = classify(product.name, set.release_date);
        if (!classified) {
          unclassified += 1;
          continue;
        }

        const naturalKey = `${set.id}|${classified.type}|${product.name}`;
        if (!seenProducts.has(naturalKey)) {
          seenProducts.add(naturalKey);
          productRows.push([
            productId(set.id, classified.type, product.name), set.id, classified.type,
            product.name, classified.packs, classified.cardsPerPack, product.image_url, SOURCE,
          ]);
        }

        // market_price is the clearing price; median_price is the median active
        // listing, which sits at or above it.
        const median = product.market_price ?? product.median_price;
        const high = median === null || median === undefined
          ? null
          : Math.max(median, product.median_price ?? median);
        observations.push({
          naturalKey,
          externalId: String(product.id),
          externalName: product.name,
          low: product.low_price,
          median: median ?? null,
          high,
          listings: product.total_listings ?? 0,
        });
      }

      page += 1;
      if (!hasMore || products.length === 0) break;
    }
    completed += 1;
    queryIndex += 1;
  }

  // Conflict on the natural key: a product may already exist under a different
  // id (e.g. seeded before this provider was wired up).
  const writtenProducts = await bulkUpsert({
    table: 'public.sealed_products',
    columns: [
      'id', 'set_id', 'product_type', 'name', 'packs_per_product',
      'cards_per_pack', 'image_url', 'source',
    ],
    rows: productRows,
    conflictTarget: '(set_id, product_type, name)',
    updateColumns: ['packs_per_product', 'cards_per_pack', 'image_url', 'source'],
  });

  const { rows: storedProducts } = await getPool().query<{
    id: string; set_id: string; product_type: string; name: string;
  }>('select id, set_id, product_type, name from public.sealed_products');
  const idByNaturalKey = new Map(
    storedProducts.map((row) => [`${row.set_id}|${row.product_type}|${row.name}`, row.id]),
  );

  const mapRows: unknown[][] = [];
  const priceRows: unknown[][] = [];
  for (const observation of observations) {
    const id = idByNaturalKey.get(observation.naturalKey);
    if (!id) continue;
    mapRows.push([SOURCE, observation.externalId, id, observation.externalName]);
    if (observation.median === null) continue;
    priceRows.push([
      id, observedDate, SOURCE, 'USD', observation.listings,
      observation.low, observation.median, observation.high,
    ]);
  }

  await bulkUpsert({
    table: 'public.external_product_map',
    columns: ['source', 'external_id', 'product_id', 'external_name'],
    rows: mapRows,
    conflictTarget: '(source, external_id)',
    updateColumns: ['product_id', 'external_name'],
  });

  const writtenPrices = await bulkUpsert({
    table: 'public.sealed_price_history',
    columns: [
      'product_id', 'observed_date', 'source', 'currency', 'listing_count',
      'low_price', 'median_price', 'high_price',
    ],
    rows: priceRows,
    conflictTarget: '(product_id, observed_date, source)',
    updateColumns: ['listing_count', 'low_price', 'median_price', 'high_price'],
  });

  if (!arg('queries')) await writeCursorIndex(queryIndex, client.used);

  log.info(
    `sealed products upserted: ${writtenProducts}, price rows: ${writtenPrices} ` +
      `(${unmatchedSets} products in unmapped sets, ${unclassified} unclassified)`,
  );
  log.info(`tcgapi.dev usage: ${client.quotaSummary}`);
}

main()
  .catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
