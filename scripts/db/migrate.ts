/**
 * Applies every SQL file in supabase/migrations in filename order and records
 * them in public.schema_migrations so re-runs are no-ops.
 *
 *   npm run db:migrate                 # against $DATABASE_URL
 *   npm run db:migrate -- --local      # against $LOCAL_DATABASE_URL + auth shim
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';

import { loadEnv } from '../lib/env';

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const SHIM_PATH = path.join(process.cwd(), 'scripts', 'db', 'local-shim.sql');

async function main() {
  loadEnv();
  const local = process.argv.includes('--local');
  const connectionString = local
    ? process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55432/postgres'
    : process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set (use --local for a local PostgreSQL instance)');
  }

  const client = new Client({
    connectionString,
    ssl: local ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    if (local) {
      await client.query('create extension if not exists "pgcrypto"');
      await client.query(readFileSync(SHIM_PATH, 'utf8'));
    }

    await client.query(`
      create table if not exists public.schema_migrations (
        filename text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = new Map<string, string>(
      (await client.query<{ filename: string; checksum: string }>(
        'select filename, checksum from public.schema_migrations',
      )).rows.map((row) => [row.filename, row.checksum]),
    );

    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

    for (const filename of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(filename);

      if (previous === checksum) {
        console.log(`= ${filename} (already applied)`);
        continue;
      }
      if (previous && previous !== checksum) {
        console.warn(`! ${filename} changed since it was applied — re-running`);
      }

      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          `insert into public.schema_migrations (filename, checksum) values ($1, $2)
             on conflict (filename) do update set checksum = excluded.checksum, applied_at = now()`,
          [filename, checksum],
        );
        await client.query('commit');
        console.log(`+ ${filename}`);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`migration ${filename} failed: ${(error as Error).message}`);
      }
    }

    console.log(`\n${files.length} migration(s) processed.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
