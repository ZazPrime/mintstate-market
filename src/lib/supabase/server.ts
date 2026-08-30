import { cookies } from 'next/headers';

import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The Vercel↔Supabase integration publishes the project credentials under
 * unprefixed names, and a `NEXT_PUBLIC_` variable marked Sensitive is withheld
 * from the build that inlines it. Either source is enough to serve the site, so
 * every accepted spelling is tried before giving up.
 */
function firstEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing environment variable ${names[0]}`);
}

export function supabaseUrl(): string {
  return firstEnv(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']);
}

export function supabaseAnonKey(): string {
  // Supabase renamed anon keys to "publishable"; accept either name.
  return firstEnv([
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
  ]);
}

/** Request-scoped client that carries the user's session (respects RLS). */
export function createServerSupabase(): SupabaseClient {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — session refresh happens in middleware.
        }
      },
    },
  });
}

/** Anonymous read-only client for public market data. */
export function createPublicSupabase(): SupabaseClient {
  return createSupabaseClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false },
  });
}
