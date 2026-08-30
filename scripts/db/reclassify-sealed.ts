/**
 * Recomputes pack counts for stored sealed products from their names, so a
 * change to the classifier takes effect without re-fetching the provider feed.
 *
 *   npm run db:reclassify-sealed
 */
import { closePool, getPool } from '../lib/db';
import { loadEnv } from '../lib/env';
import { log } from '../lib/log';
import { classifySealedProduct } from '../lib/sealed-classify';

interface ProductRow {
  id: string;
  name: string;
  packs_per_product: number;
  cards_per_pack: number;
  release_date: string | null;
}

async function main(): Promise<void> {
  loadEnv();

  const { rows } = await getPool().query<ProductRow>(`
    select p.id, p.name, p.packs_per_product, p.cards_per_pack,
           to_char(s.release_date, 'YYYY-MM-DD') as release_date
      from public.sealed_products p
      join public.sets s on s.id = p.set_id
  `);

  let updated = 0;
  for (const row of rows) {
    const classified = classifySealedProduct(row.name, row.release_date);
    if (!classified) continue;
    if (
      classified.packs === row.packs_per_product &&
      classified.cardsPerPack === row.cards_per_pack
    ) {
      continue;
    }
    await getPool().query(
      `update public.sealed_products
          set product_type = $2, packs_per_product = $3, cards_per_pack = $4
        where id = $1`,
      [row.id, classified.type, classified.packs, classified.cardsPerPack],
    );
    updated += 1;
  }

  log.info(`sealed_products: ${updated}/${rows.length} pack counts updated`);
}

main()
  .catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
