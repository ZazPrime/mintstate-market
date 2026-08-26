/**
 * Recomputes the daily analytics rollup, the multi-window (30D/90D/1Y/ALL)
 * metrics, sealed valuations and the chain-linked market index. Runs after the
 * pricing and population workers.
 *
 *   npm run analytics:refresh
 */
import { closePool, getPool } from '../lib/db';
import { log } from '../lib/log';

async function main() {
  const analytics = await getPool().query<{ refresh_card_analytics: number }>(
    'select public.refresh_card_analytics() as refresh_card_analytics',
  );
  log.info(`card_analytics rows written: ${analytics.rows[0].refresh_card_analytics}`);

  const windows = await getPool().query<{ refresh_window_metrics: number }>(
    'select public.refresh_window_metrics() as refresh_window_metrics',
  );
  log.info(`card_window_metrics rows written: ${windows.rows[0].refresh_window_metrics}`);

  const sealed = await getPool().query<{ refresh_sealed_analytics: number }>(
    'select public.refresh_sealed_analytics() as refresh_sealed_analytics',
  );
  log.info(`sealed_analytics rows written: ${sealed.rows[0].refresh_sealed_analytics}`);

  // Keep the index basket at the 100 most liquid cards with PSA 10 pricing.
  await getPool().query(`
    with ranked as (
      select ph.card_id,
             sum(ph.sale_count) as sales,
             row_number() over (order by sum(ph.sale_count) desc) as rank
        from public.price_history ph
       where ph.grade = 'PSA10'
         and ph.observed_date >= current_date - interval '90 days'
       group by ph.card_id
       limit 100
    )
    insert into public.index_constituents (index_id, card_id, grade, weight)
    select 'msm100', card_id, 'PSA10', round(1 + ln(1 + sales)::numeric, 4) from ranked
    on conflict (index_id, card_id, grade)
      do update set weight = excluded.weight, removed_on = null
  `);

  const index = await getPool().query<{ rebuild_market_index: number }>(
    `select public.rebuild_market_index('msm100') as rebuild_market_index`,
  );
  log.info(`market_index_history rows written: ${index.rows[0].rebuild_market_index}`);
}

main()
  .catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
