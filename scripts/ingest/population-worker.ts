/**
 * Population worker: scrapes PSA population report pages with Playwright and
 * upserts daily snapshots (plus deltas vs. the previous snapshot) into
 * population_reports.
 *
 *   npm run ingest:population -- --limit=50
 *   npm run ingest:population -- --cards=base1-4 --headed
 *
 * PSA publishes population data per set; each row is a card with a grade
 * histogram. The scraper is defensive about markup changes: it reads the table
 * by header names rather than by fixed column positions, and skips (rather than
 * fails) any page whose structure it no longer recognises.
 */
import { chromium, type Browser, type Page } from 'playwright';

import { bulkUpsert, closePool, getPool } from '../lib/db';
import { log, retry } from '../lib/log';

const PSA_SEARCH = 'https://www.psacard.com/pop/search?q=';

interface TargetCard {
  id: string;
  name: string;
  number: string;
  set_name: string;
  release_year: number | null;
  last_total: number | null;
  last_gem: number | null;
}

interface ScrapedPopulation {
  totalGraded: number;
  gemCount: number;
  gradeCounts: Record<string, number>;
  sourceUrl: string;
}

async function selectTargets(limit: number, cardIds: string[] | null): Promise<TargetCard[]> {
  const filterClause = cardIds?.length ? 'and c.id = any($2)' : '';
  const params: unknown[] = cardIds?.length ? [limit, cardIds] : [limit];

  const { rows } = await getPool().query<TargetCard>(
    `select c.id, c.name, c.number, s.name as set_name,
            extract(year from s.release_date)::int as release_year,
            prev.total_graded as last_total, prev.gem_count as last_gem
       from public.cards c
       join public.sets s on s.id = c.set_id
       left join lateral (
         select total_graded, gem_count, snapshot_date
           from public.population_reports pr
          where pr.card_id = c.id and pr.grader = 'PSA'
          order by pr.snapshot_date desc limit 1
       ) prev on true
      where c.language = 'en'
        and (c.rarity is null or c.rarity not in ('Common', 'Uncommon'))
        ${filterClause}
      order by prev.snapshot_date asc nulls first, s.release_date desc nulls last
      limit $1`,
    params,
  );
  return rows;
}

function parseCount(text: string | null | undefined): number {
  if (!text) return 0;
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

/** Reads the PSA population table for a card, keyed by column header text. */
async function scrapeCard(page: Page, card: TargetCard): Promise<ScrapedPopulation | null> {
  const query = [card.name, card.set_name, card.number].filter(Boolean).join(' ');
  const url = `${PSA_SEARCH}${encodeURIComponent(query)}`;

  await retry(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }), {
    label: `psa ${card.id}`,
    attempts: 3,
  });

  const table = page.locator('table').first();
  if ((await table.count()) === 0) return null;
  await table.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);

  const headers = (await table.locator('thead th').allInnerTexts())
    .map((header) => header.trim().toUpperCase());
  if (headers.length === 0) return null;

  const firstRow = table.locator('tbody tr').first();
  if ((await firstRow.count()) === 0) return null;
  const cells = (await firstRow.locator('td').allInnerTexts()).map((cell) => cell.trim());

  const gradeCounts: Record<string, number> = {};
  let totalGraded = 0;
  let gemCount = 0;

  headers.forEach((header, index) => {
    const value = parseCount(cells[index]);
    if (/^(PSA\s*)?10$/.test(header) || header === 'GEM MT 10') {
      gemCount = value;
      gradeCounts['10'] = value;
    } else if (/^(PSA\s*)?(\d(\.5)?)$/.test(header)) {
      gradeCounts[header.replace(/[^0-9.]/g, '')] = value;
    } else if (header.includes('TOTAL')) {
      totalGraded = value;
    }
  });

  if (totalGraded === 0) {
    totalGraded = Object.values(gradeCounts).reduce((sum, count) => sum + count, 0);
  }
  if (totalGraded === 0) return null;

  return { totalGraded, gemCount, gradeCounts, sourceUrl: url };
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const cardsArg = args.find((a) => a.startsWith('--cards='));
  const limit = limitArg ? Number(limitArg.replace('--limit=', '')) : 50;
  const cardIds = cardsArg ? cardsArg.replace('--cards=', '').split(',') : null;

  const targets = await selectTargets(limit, cardIds);
  log.info(`scraping PSA population for ${targets.length} cards`);

  const browser: Browser = await chromium.launch({ headless: !args.includes('--headed') });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const today = new Date().toISOString().slice(0, 10);
  const rows: unknown[][] = [];
  let missed = 0;

  try {
    for (const card of targets) {
      try {
        const scraped = await scrapeCard(page, card);
        if (!scraped) {
          missed += 1;
          log.warn(`no population table for ${card.id}`);
          continue;
        }
        rows.push([
          card.id,
          'PSA',
          today,
          scraped.totalGraded,
          scraped.gemCount,
          JSON.stringify(scraped.gradeCounts),
          card.last_total === null ? null : scraped.totalGraded - card.last_total,
          card.last_gem === null ? null : scraped.gemCount - card.last_gem,
          scraped.sourceUrl,
        ]);
        log.info(`${card.id}: total=${scraped.totalGraded} gem=${scraped.gemCount}`);
      } catch (error) {
        missed += 1;
        log.warn(`${card.id}: ${(error as Error).message}`);
      }
      // Stay well under PSA's rate limiting.
      await page.waitForTimeout(1_500);
    }
  } finally {
    await browser.close();
  }

  const written = await bulkUpsert({
    table: 'public.population_reports',
    columns: [
      'card_id', 'grader', 'snapshot_date', 'total_graded', 'gem_count',
      'grade_counts', 'total_graded_delta', 'gem_count_delta', 'source_url',
    ],
    conflictTarget: '(card_id, grader, snapshot_date)',
    rows,
  });

  log.info(`wrote ${written} population snapshots (${missed} skipped)`);
}

main()
  .catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
