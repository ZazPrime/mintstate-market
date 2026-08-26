/**
 * Deletes every row produced by the synthetic seeders (`seed:demo`,
 * `seed:sealed-demo`) and by the retired pricing providers, so the app renders
 * live PokemonPriceTracker data only.
 *
 *   npm run db:purge-synthetic
 *
 * Set and card metadata is left alone: it comes from the pokemon-tcg-data bulk
 * export, not from a seeder. Analytics rollups are rebuilt afterwards.
 */
import { closePool, getPool } from '../lib/db';
import { loadEnv } from '../lib/env';
import { log } from '../lib/log';

const SYNTHETIC = 'synthetic';
/** Providers replaced by PokemonPriceTracker; their rows are no longer refreshed. */
const RETIRED_SOURCES = ['justtcg', 'tcgapi.dev', 'ebay'];

async function purge(table: string, predicate: string, params: unknown[]): Promise<void> {
  const result = await getPool().query(`delete from public.${table} where ${predicate}`, params);
  log.info(`${table}: deleted ${result.rowCount ?? 0} rows`);
}

async function main(): Promise<void> {
  loadEnv();

  const stale = [SYNTHETIC, ...RETIRED_SOURCES];
  await purge('price_history', 'source = any($1)', [stale]);
  await purge('sealed_price_history', 'source = any($1)', [stale]);
  await purge('sealed_products', 'source = any($1)', [stale]);
  await purge('benchmark_history', 'source = $1', [SYNTHETIC]);
  // Scraped population rows record the PSA page they came from.
  await purge('population_reports', "source_url is null or source_url = $1", [SYNTHETIC]);
  for (const fn of [
    // Rollups keyed to deleted observations would otherwise linger as stale rows.
    'prune_orphan_analytics',
    'refresh_card_analytics',
    'refresh_window_metrics',
    'refresh_sealed_analytics',
  ]) {
    await getPool().query(`select public.${fn}()`);
  }
  log.info('analytics rollups rebuilt from remaining live data');
}

main()
  .catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
