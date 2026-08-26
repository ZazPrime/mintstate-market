/**
 * Seeds `sets` and `cards` from bulk JSON exports instead of the Scrydex REST
 * API, so ingestion is never rate limited.
 *
 *   English: raw JSON from github.com/PokemonTCG/pokemon-tcg-data
 *   Japanese: TCGdex bulk locale endpoints (the GitHub export is English only)
 *
 *   npm run seed:metadata                     # English only
 *   npm run seed:metadata -- --japanese       # English + Japanese + linkage
 *   npm run seed:metadata -- --sets base1,sv1 # limit to specific sets
 */
import pLimit from 'p-limit';

import { bulkUpsert, closePool, getPool } from '../lib/db';
import { fetchJson, log } from '../lib/log';

const GITHUB_RAW = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master';
const TCGDEX = 'https://api.tcgdex.net/v2';

interface GithubSet {
  id: string;
  name: string;
  series?: string;
  printedTotal?: number;
  total?: number;
  ptcgoCode?: string;
  releaseDate?: string;
  images?: { symbol?: string; logo?: string };
}

interface GithubCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  supertype?: string;
  subtypes?: string[];
  types?: string[];
  artist?: string;
  nationalPokedexNumbers?: number[];
  images?: { small?: string; large?: string };
}

interface TcgdexSetBrief {
  id: string;
  name: string;
  cardCount?: { total?: number; official?: number };
  releaseDate?: string;
}

interface TcgdexSetDetail extends TcgdexSetBrief {
  serie?: { id: string; name: string };
  logo?: string;
  symbol?: string;
  cards?: Array<{ id: string; localId: string; name: string; image?: string; rarity?: string }>;
}

/** "1999/01/09" -> "1999-01-09"; anything unparseable becomes null. */
function toIsoDate(value?: string): string | null {
  if (!value) return null;
  const normalized = value.replace(/\//g, '-').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

const SET_COLUMNS = [
  'id', 'name', 'series', 'language', 'printed_total', 'total', 'ptcgo_code',
  'release_date', 'symbol_url', 'logo_url', 'source',
];

const CARD_COLUMNS = [
  'id', 'set_id', 'name', 'number', 'rarity', 'supertype', 'subtypes', 'types',
  'artist', 'language', 'national_pokedex_numbers', 'images', 'source',
];

async function seedEnglish(setFilter: Set<string> | null): Promise<number> {
  const sets = await fetchJson<GithubSet[]>(`${GITHUB_RAW}/sets/en.json`);
  const selected = setFilter ? sets.filter((s) => setFilter.has(s.id)) : sets;
  log.info(`fetched ${sets.length} English sets, seeding ${selected.length}`);

  await bulkUpsert({
    table: 'public.sets',
    columns: SET_COLUMNS,
    conflictTarget: '(id)',
    rows: selected.map((set) => [
      set.id, set.name, set.series ?? null, 'en', set.printedTotal ?? null,
      set.total ?? null, set.ptcgoCode ?? null, toIsoDate(set.releaseDate),
      set.images?.symbol ?? null, set.images?.logo ?? null, 'pokemon-tcg-data',
    ]),
  });

  // The export stores one JSON file per set; fetch them with bounded concurrency.
  const limit = pLimit(8);
  let cardCount = 0;
  await Promise.all(selected.map((set) => limit(async () => {
    let cards: GithubCard[];
    try {
      cards = await fetchJson<GithubCard[]>(`${GITHUB_RAW}/cards/en/${set.id}.json`);
    } catch (error) {
      log.warn(`no card export for set ${set.id}: ${(error as Error).message}`);
      return;
    }
    await bulkUpsert({
      table: 'public.cards',
      columns: CARD_COLUMNS,
      conflictTarget: '(id)',
      rows: cards.map((card) => [
        card.id, set.id, card.name, card.number, card.rarity ?? null,
        card.supertype ?? null, card.subtypes ?? [], card.types ?? [],
        card.artist ?? null, 'en', card.nationalPokedexNumbers ?? [],
        JSON.stringify(card.images ?? {}), 'pokemon-tcg-data',
      ]),
    });
    cardCount += cards.length;
    log.info(`seeded ${cards.length} cards for ${set.id}`);
  })));

  return cardCount;
}

async function seedJapanese(setFilter: Set<string> | null): Promise<number> {
  const sets = await fetchJson<TcgdexSetBrief[]>(`${TCGDEX}/ja/sets`);
  const selected = setFilter ? sets.filter((s) => setFilter.has(s.id)) : sets;
  log.info(`fetched ${sets.length} Japanese sets, seeding ${selected.length}`);

  const limit = pLimit(6);
  let cardCount = 0;

  await Promise.all(selected.map((brief) => limit(async () => {
    let detail: TcgdexSetDetail;
    try {
      detail = await fetchJson<TcgdexSetDetail>(`${TCGDEX}/ja/sets/${encodeURIComponent(brief.id)}`);
    } catch (error) {
      log.warn(`skipping Japanese set ${brief.id}: ${(error as Error).message}`);
      return;
    }

    await bulkUpsert({
      table: 'public.sets',
      columns: SET_COLUMNS,
      conflictTarget: '(id)',
      rows: [[
        `ja-${detail.id}`, detail.name, detail.serie?.name ?? null, 'ja',
        detail.cardCount?.official ?? null, detail.cardCount?.total ?? null, null,
        toIsoDate(detail.releaseDate), detail.symbol ?? null, detail.logo ?? null, 'tcgdex',
      ]],
    });

    const cards = detail.cards ?? [];
    await bulkUpsert({
      table: 'public.cards',
      columns: CARD_COLUMNS,
      conflictTarget: '(id)',
      rows: cards.map((card) => [
        `ja-${card.id}`, `ja-${detail.id}`, card.name, card.localId,
        card.rarity ?? null, null, [], [], null, 'ja', [],
        JSON.stringify(card.image ? { small: `${card.image}/low.png`, large: `${card.image}/high.png` } : {}),
        'tcgdex',
      ]),
    });
    cardCount += cards.length;
  })));

  return cardCount;
}

/**
 * Links Japanese cards to their English counterparts. TCGdex exposes the same
 * card ids across locales, so the English locale gives us a translated name to
 * match against the GitHub export, disambiguated by release date proximity.
 */
async function linkVariants(): Promise<number> {
  const { rows: jaSets } = await getPool().query<{ id: string }>(
    `select id from public.sets where language = 'ja' and source = 'tcgdex'`,
  );
  if (jaSets.length === 0) return 0;

  const limit = pLimit(6);
  const pairs: Array<[string, string]> = [];

  await Promise.all(jaSets.map((jaSet) => limit(async () => {
    const tcgdexId = jaSet.id.replace(/^ja-/, '');
    let english: TcgdexSetDetail;
    try {
      english = await fetchJson<TcgdexSetDetail>(`${TCGDEX}/en/sets/${encodeURIComponent(tcgdexId)}`);
    } catch {
      return;
    }
    const englishCards = english.cards ?? [];
    if (englishCards.length === 0) return;

    // One round trip per set: match every card name at once, preferring the
    // English printing released closest to the Japanese set.
    const { rows } = await getPool().query<{ ja_id: string; en_id: string }>(
      `with wanted as (
         select * from unnest($1::text[], $2::text[]) as t(ja_id, card_name)
       )
       select w.ja_id, m.id as en_id
         from wanted w
         cross join lateral (
           select c.id
             from public.cards c
             join public.sets s on s.id = c.set_id
            where c.language = 'en' and lower(c.name) = lower(w.card_name)
            order by abs(coalesce(s.release_date, current_date)
                       - coalesce((select release_date from public.sets where id = $3), current_date))
            limit 1
         ) m`,
      [
        englishCards.map((card) => `ja-${card.id}`),
        englishCards.map((card) => card.name),
        jaSet.id,
      ],
    );
    pairs.push(...rows.map((row): [string, string] => [row.ja_id, row.en_id]));
  })));

  if (pairs.length > 0) {
    await getPool().query(
      `update public.cards c set counterpart_card_id = t.en_id
         from unnest($1::text[], $2::text[]) as t(ja_id, en_id)
        where c.id = t.ja_id and exists (select 1 from public.cards e where e.id = t.en_id)`,
      [pairs.map(([ja]) => ja), pairs.map(([, en]) => en)],
    );
    await getPool().query(
      `update public.cards c set counterpart_card_id = t.ja_id
         from unnest($1::text[], $2::text[]) as t(ja_id, en_id)
        where c.id = t.en_id and c.counterpart_card_id is null
          and exists (select 1 from public.cards j where j.id = t.ja_id)`,
      [pairs.map(([ja]) => ja), pairs.map(([, en]) => en)],
    );
  }

  log.info(`linked ${pairs.length} Japanese cards to English counterparts`);
  return pairs.length;
}

async function main() {
  const args = process.argv.slice(2);
  const setsArg = args.find((a) => a.startsWith('--sets='));
  const setFilter = setsArg ? new Set(setsArg.replace('--sets=', '').split(',')) : null;
  const includeJapanese = args.includes('--japanese');

  const englishCards = await seedEnglish(setFilter);
  let japaneseCards = 0;
  if (includeJapanese) {
    japaneseCards = await seedJapanese(setFilter);
    await linkVariants();
  }

  log.info(`done: ${englishCards} English cards, ${japaneseCards} Japanese cards`);
}

main()
  .catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
