import { existsSync } from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

/** Loads .env.local then .env, without overriding real process env. */
export function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    const filePath = path.join(process.cwd(), file);
    if (existsSync(filePath)) dotenv.config({ path: filePath });
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
