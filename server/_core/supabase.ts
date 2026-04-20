import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';

/**
 * Server-side Supabase clients.
 *
 * We make RLS + org features stop fighting each other by always
 * authenticating server queries *as the current user*. The path:
 *
 *   1. Clerk verifies the incoming request and gives us user.id.
 *   2. We sign a short-lived Supabase-compatible JWT with that id in
 *      the `sub` claim, using SUPABASE_JWT_SECRET (the same secret
 *      that backs the Clerk → Supabase JWT template).
 *   3. A Supabase client attached to that JWT is created per request
 *      and passed down as `ctx.supabase`.
 *
 * Consequences:
 *   - RLS evaluates correctly: `current_user_id()` returns the
 *     Clerk user id, so policies like `user_id = current_user_id()`
 *     and `check (current_user_id() = created_by)` work out of the
 *     box. Creating an organization stops violating RLS.
 *   - No SUPABASE_SERVICE_ROLE_KEY required. One less secret to
 *     leak, and the server can't accidentally bypass access rules.
 *   - Defense in depth: the tRPC layer still does ownership checks,
 *     and RLS enforces the same rules one layer down.
 *
 * For admin scripts (seeding, migrations from CSV, etc.) we still
 * expose `adminSupabase` which uses the service role key and
 * bypasses RLS. That's the ONLY place it's used.
 */

// Accept both the Vite-prefixed names (client convention) and the
// plain names (Python backend convention). Whatever the deploy
// platform already has set, the Node server picks up — one less
// round of "add the env var, then restart".
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
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
if (!SUPABASE_JWT_SECRET) {
  console.error(
    '[supabase] SUPABASE_JWT_SECRET is not set. Per-user JWT signing ' +
    "is disabled, which means every authenticated query will be treated " +
    'as anonymous by Supabase and RLS will deny it. Copy the JWT Secret ' +
    'from Supabase → Project Settings → API → JWT Secret into the ' +
    'SUPABASE_JWT_SECRET env var and restart.',
  );
}

// JWT lifetime is deliberately tiny: each request re-signs, so we
// don't care about expiry drift across long-running processes.
const JWT_LIFETIME_SECONDS = 60;
const jwtSecretBytes = new TextEncoder().encode(SUPABASE_JWT_SECRET);

/**
 * Create a Supabase client impersonating the given Clerk user.
 * Requests made with this client evaluate RLS as that user.
 */
export async function supabaseAsUser(
  userId: string,
): Promise<SupabaseClient> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    sub: userId,
    aud: 'authenticated',
    role: 'authenticated',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_LIFETIME_SECONDS)
    .sign(jwtSecretBytes);

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
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
