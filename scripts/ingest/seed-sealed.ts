/**
 * Builds the sealed product catalogue for sets that have live singles pricing,
 * and (absent a sealed price feed) generates synthetic sealed market history so
 * the value-gap module is exercisable.
 *
 * Synthetic rows are written with source `synthetic` and can be removed with:
 *
 *   delete from sealed_price_history where source = 'synthetic';
 *
 *   npm run seed:sealed -- --sets=40 --days=400
 */
import { bulkUpsert, closePool, getPool } from '../lib/db';
import { log } from '../lib/log';

/** Deterministic PRNG so repeated runs produce the same sealed market. */
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

interface Configuration {
  type: 'booster_box' | 'elite_trainer_box' | 'booster_bundle' | 'collection_case';
  label: string;
  packs: number;
  msrp: number;
}

const PRODUCTS: Configuration[] = [
  { type: 'booster_box', label: 'Booster Box', packs: 36, msrp: 143.64 },
  { type: 'elite_trainer_box', label: 'Elite Trainer Box', packs: 9, msrp: 49.99 },
  { type: 'booster_bundle', label: 'Booster Bundle', packs: 6, msrp: 26.94 },
  { type: 'collection_case', label: 'Booster Case (6 boxes)', packs: 216, msrp: 719.0 },
];

async function main() {
  const args = process.argv.slice(2);
  const setLimit = Number(args.find((a) => a.startsWith('--sets='))?.replace('--sets=', '') ?? 40);
  const days = Number(args.find((a) => a.startsWith('--days='))?.replace('--days=', '') ?? 400);

  const { rows: sets } = await getPool().query<{
    set_id: string; set_name: string; ev_per_pack: string | null;
  }>(
    `select ev.set_id, s.name as set_name, ev.ev_per_pack
       from public.set_pack_ev ev
       join public.sets s on s.id = ev.set_id
      where ev.ev_per_pack > 0
      order by ev.priced_cards desc
      limit $1`,
    [setLimit],
  );

  if (sets.length === 0) {
    log.error('no sets with priced singles — run `npm run seed:demo` and `npm run analytics:refresh` first');
    process.exitCode = 1;
    return;
  }

  const productRows: unknown[][] = [];
  const priceRows: unknown[][] = [];
  const today = new Date();

  for (const set of sets) {
    const evPerPack = Number(set.ev_per_pack ?? 0);

    for (const product of PRODUCTS) {
      const productId = `${set.set_id}-${product.type}`;
      productRows.push([
        productId, set.set_id, product.type, `${set.set_name} ${product.label}`,
        product.packs, 10, product.msrp.toFixed(2), 'synthetic',
      ]);

      const rng = mulberry32(hashString(productId));
      // Sealed usually trades between a discount and a premium to pull EV;
      // spread products across that range so both sides of the gap appear.
      const pullEv = evPerPack * product.packs;
      const anchor = Math.max(product.msrp * 0.8, pullEv * (0.55 + rng() * 0.75));
      let price = anchor;
      const drift = (rng() - 0.4) * 0.0025;
      const vol = 0.008 + rng() * 0.02;

      // Sealed trades thinly: weekly observations rather than daily.
      for (let offset = days; offset >= 0; offset -= 7) {
        const date = new Date(today.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
        price = Math.max(product.msrp * 0.5, price * (1 + drift * 7 + (rng() - 0.5) * vol));
        const spread = 0.05 + rng() * 0.08;
        priceRows.push([
          productId, date, 'synthetic', 'USD', 1 + Math.floor(rng() * 6),
          (price * (1 - spread)).toFixed(2),
          price.toFixed(2),
          (price * (1 + spread)).toFixed(2),
        ]);
      }
    }
  }

  const products = await bulkUpsert({
    table: 'public.sealed_products',
    columns: [
      'id', 'set_id', 'product_type', 'name',
      'packs_per_product', 'cards_per_pack', 'msrp', 'source',
    ],
    conflictTarget: '(id)',
    rows: productRows,
  });

  const prices = await bulkUpsert({
    table: 'public.sealed_price_history',
    columns: [
      'product_id', 'observed_date', 'source', 'currency',
      'sale_count', 'low_price', 'median_price', 'high_price',
    ],
    conflictTarget: '(product_id, observed_date, source)',
    rows: priceRows,
  });

  log.info(`seeded ${products} sealed products and ${prices} sealed price rows across ${sets.length} sets`);
}

main()
  .catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
