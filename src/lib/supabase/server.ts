import { cookies } from 'next/headers';

import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function supabaseUrl(): string {
  return requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
}

export function supabaseAnonKey(): string {
  // Supabase renamed anon keys to "publishable"; accept either name.
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  );
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
