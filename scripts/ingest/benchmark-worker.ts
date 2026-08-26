/**
 * Real S&P 500 daily closes for the market-index comparison chart.
 *
 *   npm run ingest:benchmark [-- --range=5y]
 *
 * Yahoo's chart endpoint is public and needs no credentials.
 */
import { bulkUpsert, closePool } from '../lib/db';
import { loadEnv } from '../lib/env';
import { fetchJson, log } from '../lib/log';

const SYMBOL = 'SPX';
const YAHOO_SYMBOL = '%5EGSPC';

interface YahooChart {
  chart: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: { description?: string } | null;
  };
}

async function main(): Promise<void> {
  loadEnv();
  const range =
    process.argv.find((value) => value.startsWith('--range='))?.split('=')[1] ?? '5y';

  const payload = await fetchJson<YahooChart>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${YAHOO_SYMBOL}?range=${range}&interval=1d`,
    { headers: { 'User-Agent': 'mintstate-market/1.0' } },
  );

  const result = payload.chart.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  if (timestamps.length === 0) {
    throw new Error(payload.chart.error?.description ?? 'no benchmark data returned');
  }

  const rows: unknown[][] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const close = closes[index];
    if (typeof close !== 'number') continue; // Holidays come back as nulls.
    rows.push([
      SYMBOL,
      new Date(timestamps[index] * 1000).toISOString().slice(0, 10),
      close.toFixed(4),
      'yahoo',
    ]);
  }

  const written = await bulkUpsert({
    table: 'public.benchmark_history',
    columns: ['symbol', 'observed_date', 'close_value', 'source'],
    rows,
    conflictTarget: '(symbol, observed_date)',
    updateColumns: ['close_value', 'source'],
  });
  log.info(`benchmark ${SYMBOL}: ${written} daily closes over ${range}`);
}

main()
  .catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
