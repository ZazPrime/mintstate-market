import { Pool, type PoolClient } from 'pg';

import { loadEnv, requireEnv } from './env';

let pool: Pool | null = null;

/** Shared pool for ingestion workers. Uses LOCAL_DATABASE_URL when --local. */
export function getPool(): Pool {
  if (pool) return pool;
  loadEnv();
  const local = process.argv.includes('--local');
  const connectionString = local
    ? process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55432/postgres'
    : requireEnv('DATABASE_URL');
  pool = new Pool({
    connectionString,
    ssl: local ? undefined : { rejectUnauthorized: false },
    max: 4,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Bulk upsert built as a single multi-row INSERT ... ON CONFLICT statement.
 * Rows are chunked so the 65535 bind-parameter limit is never hit.
 */
export async function bulkUpsert(options: {
  table: string;
  columns: string[];
  rows: unknown[][];
  conflictTarget: string;
  updateColumns?: string[];
  chunkSize?: number;
}): Promise<number> {
  const { table, columns, rows, conflictTarget } = options;
  if (rows.length === 0) return 0;

  const updateColumns = options.updateColumns ?? columns.filter((c) => !conflictTarget.includes(c));
  const maxRowsPerChunk = Math.max(1, Math.floor(60000 / columns.length));
  const chunkSize = Math.min(options.chunkSize ?? 500, maxRowsPerChunk);

  const setClause = updateColumns.length
    ? `do update set ${updateColumns.map((c) => `${c} = excluded.${c}`).join(', ')}`
    : 'do nothing';

  let written = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values: unknown[] = [];
    const placeholders = chunk
      .map((row) => `(${row.map((value) => {
        values.push(value);
        return `$${values.length}`;
      }).join(', ')})`)
      .join(', ');

    const sql = `insert into ${table} (${columns.join(', ')}) values ${placeholders}
      on conflict ${conflictTarget} ${setClause}`;
    const result = await getPool().query(sql, values);
    written += result.rowCount ?? 0;
  }
  return written;
}
