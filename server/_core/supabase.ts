import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase clients.
 *
 * Every tRPC request carries the user's Supabase access token
 * (set by the browser after supabase.auth.signIn). We attach that
 * same token to the server-side Supabase client so that RLS policies
 * evaluate as that user — `auth.uid()` returns the caller's id.
 *
 * No JWT signing, no service role by default: the token is already
 * valid, Supabase already verifies it, and RLS does the rest.
 */

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — ' +
    'every request will fail. Set them and restart the server.',
  );
}

/**
 * Create a Supabase client impersonating the current user.
 * The request's access token is attached so RLS evaluates correctly.
 */
export function supabaseAsUser(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Admin client — bypasses RLS via the service role key. Reserved
 * for scripts and operations that genuinely need to act with no
 * user context (seeding, cross-tenant reports). Returns null when
 * the service key isn't configured so callers can fail fast.
 */
export const adminSupabase: SupabaseClient | null =
  SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : null;

/**
 * Anonymous client — no auth, subject to RLS. Only useful for
 * genuinely public queries. Prefer supabaseAsUser() inside tRPC.
 */
export const anonSupabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);
